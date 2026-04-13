//! Wry webview editor for the CLAP plugin (macOS only).
//!
//! Embeds ui/index.html via include_str! and handles bidirectional
//! parameter IPC via window.ipc.postMessage / CustomEvent.

use std::sync::{
    mpsc::{channel, Receiver},
    Arc,
};

use clack_extensions::gui::Window;
use clack_plugin::prelude::*;
#[allow(deprecated)]
use raw_window_handle::{
    HandleError, HasRawWindowHandle, HasWindowHandle, RawWindowHandle, WindowHandle,
};
use wry::dpi::{LogicalPosition, LogicalSize};
use wry::{Rect, WebView, WebViewBuilder};

use crate::params::PluginParamsShared;
use crate::shared::ParameterUpdate;

/// The editor HTML is embedded at compile time.
const EDITOR_HTML: &str = include_str!("../../../ui/index.html");

pub const EDITOR_WIDTH: u32 = 500;
pub const EDITOR_HEIGHT: u32 = 400;

pub struct Editor {
    webview: WebView,
    ipc_messages: Receiver<String>,
}

struct ClackParentWindow<'a>(Window<'a>);

impl HasWindowHandle for ClackParentWindow<'_> {
    #[allow(deprecated)]
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let raw: RawWindowHandle = HasRawWindowHandle::raw_window_handle(&self.0)?;
        Ok(unsafe { WindowHandle::borrow_raw(raw) })
    }
}

impl Editor {
    pub fn attach(
        window: Window<'_>,
        shared: Arc<PluginParamsShared>,
    ) -> Result<Self, PluginError> {
        let (sender, receiver) = channel::<String>();
        let parent = ClackParentWindow(window);
        let ipc_shared = Arc::clone(&shared);

        let webview = WebViewBuilder::new()
            .with_bounds(Rect {
                position: LogicalPosition::new(0, 0).into(),
                size: LogicalSize::new(EDITOR_WIDTH, EDITOR_HEIGHT).into(),
            })
            .with_visible(true)
            .with_ipc_handler(move |request: wry::http::Request<String>| {
                let _ = sender.send(request.body().to_string());
                ipc_shared.request_host_callback();
            })
            .with_html(EDITOR_HTML)
            .build_as_child(&parent)
            .map_err(PluginError::from)?;

        let gui = Self {
            webview,
            ipc_messages: receiver,
        };

        // Send initial snapshot so the UI starts with current values.
        for update in shared.snapshot_all() {
            gui.emit_parameter_changed(update);
        }
        Ok(gui)
    }

    /// Drain pending IPC messages from the webview and dispatch them.
    pub fn pump(&self, shared: &Arc<PluginParamsShared>) {
        while let Ok(raw) = self.ipc_messages.try_recv() {
            // Parse the JSON command envelope.
            let Ok(envelope) = serde_json::from_str::<serde_json::Value>(&raw) else {
                continue;
            };
            let request_id = envelope
                .get("request_id")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let Some(command) = envelope.get("command") else {
                continue;
            };
            let cmd_type = command.get("type").and_then(|v| v.as_str()).unwrap_or("");

            match cmd_type {
                "set_parameter" => {
                    if let Some(update) = command.get("update") {
                        let param_id = update
                            .get("parameter_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let value =
                            update.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
                        let sequence = update.get("sequence").and_then(|v| v.as_u64()).unwrap_or(0);
                        let accepted = shared.set_parameter_from_ui(param_id, value, sequence);
                        self.emit_command_response(request_id, accepted);
                    }
                }
                "request_snapshot" => {
                    self.emit_command_response(request_id, true);
                    self.emit_snapshot(shared);
                }
                _ => {
                    self.emit_command_response(request_id, false);
                }
            }
        }
    }

    pub fn set_visible(&self, visible: bool) {
        let _ = self.webview.set_visible(visible);
    }
    pub fn set_size(&self, width: u32, height: u32) {
        let _ = self.webview.set_bounds(Rect {
            position: LogicalPosition::new(0, 0).into(),
            size: LogicalSize::new(width, height).into(),
        });
    }
    pub fn focus(&self) {
        let _ = self.webview.focus();
    }

    pub fn emit_parameter_changed(&self, update: ParameterUpdate) {
        let json = serde_json::json!({
            "event": {
                "type": "parameter_changed",
                "update": {
                    "parameter_id": update.parameter_id,
                    "value": update.value,
                    "source": update.source,
                    "sequence": update.sequence,
                }
            }
        });
        self.emit_custom_event("event:engine-event", &json.to_string());
    }

    fn emit_snapshot(&self, shared: &Arc<PluginParamsShared>) {
        let params: Vec<serde_json::Value> = shared
            .snapshot_all()
            .iter()
            .map(|u| {
                serde_json::json!({
                    "parameter_id": u.parameter_id,
                    "value": u.value,
                    "source": u.source,
                    "sequence": u.sequence,
                })
            })
            .collect();
        let json = serde_json::json!({
            "event": {
                "type": "snapshot",
                "parameters": params,
            }
        });
        self.emit_custom_event("event:engine-event", &json.to_string());
    }

    fn emit_command_response(&self, request_id: u64, accepted: bool) {
        let json = serde_json::json!({
            "request_id": request_id,
            "accepted": accepted,
            "error": null,
        });
        self.emit_custom_event("event:command-response", &json.to_string());
    }

    fn emit_custom_event(&self, event_name: &str, payload_json: &str) {
        let script = format!(
            "window.dispatchEvent(new CustomEvent('{event_name}', {{ detail: {payload_json} }}));"
        );
        let _ = self.webview.evaluate_script(&script);
    }
}
