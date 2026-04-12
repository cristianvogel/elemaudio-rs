//! CLAP plugin implementation: audio processor, main thread, GUI.

use clack_extensions::audio_ports::{
    AudioPortFlags, AudioPortInfo, AudioPortInfoWriter, AudioPortType, PluginAudioPorts,
    PluginAudioPortsImpl,
};
#[cfg(target_os = "macos")]
use clack_extensions::gui::{GuiApiType, GuiConfiguration, GuiSize, PluginGui, PluginGuiImpl};
use clack_plugin::prelude::*;
use std::sync::Arc;

use stride_delay_dsp::{DspParameters, StrideDelayEngine};

#[cfg(target_os = "macos")]
use crate::editor::{self, Editor};
use crate::params::{PluginParamsLocal, PluginParamsShared};

#[derive(Debug, Clone, Default)]
pub struct PluginCore;

pub struct PluginSharedState {
    pub(crate) params: Arc<PluginParamsShared>,
}

pub struct MainThread<'a> {
    pub(crate) shared: &'a PluginSharedState,
    pub(crate) params: PluginParamsLocal,
    #[cfg(target_os = "macos")]
    pub(crate) gui: Option<Editor>,
}

pub struct AudioProcessor<'a> {
    pub(crate) engine: StrideDelayEngine,
    pub(crate) shared: &'a PluginSharedState,
    pub(crate) params: PluginParamsLocal,
    pub(crate) host: HostAudioProcessorHandle<'a>,
    in_l: Vec<f64>,
    in_r: Vec<f64>,
    out_l: Vec<f64>,
    out_r: Vec<f64>,
}

impl<'a> PluginShared<'a> for PluginSharedState {}

impl Plugin for PluginCore {
    type AudioProcessor<'a> = AudioProcessor<'a>;
    type Shared<'a> = PluginSharedState;
    type MainThread<'a> = MainThread<'a>;

    fn declare_extensions(
        builder: &mut PluginExtensions<Self>,
        _shared: Option<&Self::Shared<'_>>,
    ) {
        builder
            .register::<PluginAudioPorts>()
            .register::<clack_extensions::params::PluginParams>()
            .register::<clack_extensions::state::PluginState>();

        #[cfg(target_os = "macos")]
        {
            builder.register::<PluginGui>();
        }
    }
}

impl DefaultPluginFactory for PluginCore {
    fn get_descriptor() -> PluginDescriptor {
        use clack_plugin::plugin::features::*;
        PluginDescriptor::new(
            "com.elemaudio-rs.stride-delay-example",
            "Stride Delay (elemaudio-rs)",
        )
        .with_vendor("elemaudio-rs")
        .with_features([AUDIO_EFFECT, DELAY, STEREO])
    }

    fn new_shared(host: HostSharedHandle<'_>) -> Result<Self::Shared<'_>, PluginError> {
        let host_raw = host.as_raw() as *const _ as usize;
        let request_callback = host.as_raw().request_callback;
        let host_callback = Arc::new(move || {
            if let Some(callback) = request_callback {
                unsafe { callback(host_raw as *const _) };
            }
        });

        Ok(PluginSharedState {
            params: Arc::new(PluginParamsShared::new(Some(host_callback))),
        })
    }

    fn new_main_thread<'a>(
        _host: HostMainThreadHandle<'a>,
        shared: &'a Self::Shared<'a>,
    ) -> Result<Self::MainThread<'a>, PluginError> {
        Ok(MainThread {
            shared,
            params: PluginParamsLocal::new(&shared.params),
            #[cfg(target_os = "macos")]
            gui: None,
        })
    }
}

// ---- Audio processor --------------------------------------------------

impl<'a> PluginAudioProcessor<'a, PluginSharedState, MainThread<'a>> for AudioProcessor<'a> {
    fn activate(
        host: HostAudioProcessorHandle<'a>,
        _main_thread: &mut MainThread<'a>,
        shared: &'a PluginSharedState,
        audio_config: PluginAudioConfiguration,
    ) -> Result<Self, PluginError> {
        let max_frames = audio_config.max_frames_count as usize;

        let engine = StrideDelayEngine::new(audio_config.sample_rate, max_frames)
            .map_err(|_| PluginError::Message("failed to create DSP engine"))?;

        Ok(Self {
            engine,
            shared,
            params: PluginParamsLocal::new(&shared.params),
            host,
            in_l: vec![0.0_f64; max_frames],
            in_r: vec![0.0_f64; max_frames],
            out_l: vec![0.0_f64; max_frames],
            out_r: vec![0.0_f64; max_frames],
        })
    }

    fn process(
        &mut self,
        _process: Process,
        mut audio: Audio,
        mut events: Events,
    ) -> Result<ProcessStatus, PluginError> {
        let mut port_pair = audio
            .port_pair(0)
            .ok_or(PluginError::Message("missing audio port"))?;
        let mut channels = port_pair
            .channels()?
            .into_f32()
            .ok_or(PluginError::Message("expected f32 channels"))?;

        // Pull UI-initiated changes from the shared store.
        let ui_changed = self.params.fetch_updates(&self.shared.params);

        // Process host parameter events.
        for event_batch in events.input.batch() {
            for event in event_batch.events() {
                self.params.handle_event(event);
            }
        }

        // Notify host of UI-initiated changes.
        if ui_changed {
            self.params.send_param_events(&mut events.output);
        }

        let dsp_params = DspParameters {
            delay_ms: self.params.delay_ms(),
            feedback: self.params.feedback(),
            transition_ms: self.params.transition_ms(),
            mix: self.params.mix(),
        };
        self.engine.set_params(dsp_params);

        // Single-pass channel buffer abstraction.
        enum ChannelBuffer<'a> {
            InputOnly(&'a [f32]),
            OutputOnly(&'a mut [f32]),
            InPlace(&'a mut [f32]),
            InputOutput(&'a [f32], &'a mut [f32]),
        }

        impl ChannelBuffer<'_> {
            fn read(&self, i: usize) -> f32 {
                match self {
                    Self::InputOnly(b) => b[i],
                    Self::OutputOnly(_) => 0.0,
                    Self::InPlace(b) => b[i],
                    Self::InputOutput(b, _) => b[i],
                }
            }
            fn write(&mut self, i: usize, v: f32) {
                match self {
                    Self::InputOnly(_) => {}
                    Self::OutputOnly(b) => b[i] = v,
                    Self::InPlace(b) => b[i] = v,
                    Self::InputOutput(_, b) => b[i] = v,
                }
            }
            fn len(&self) -> usize {
                match self {
                    Self::InputOnly(b) => b.len(),
                    Self::OutputOnly(b) => b.len(),
                    Self::InPlace(b) => b.len(),
                    Self::InputOutput(a, b) => a.len().min(b.len()),
                }
            }
        }

        let mut iter = channels.iter_mut();
        let left_pair = iter
            .next()
            .ok_or(PluginError::Message("expected left channel"))?;
        let right_pair = iter.next();

        let mut left = match left_pair {
            ChannelPair::InputOnly(i) => ChannelBuffer::InputOnly(i),
            ChannelPair::OutputOnly(o) => ChannelBuffer::OutputOnly(o),
            ChannelPair::InPlace(b) => ChannelBuffer::InPlace(b),
            ChannelPair::InputOutput(i, o) => ChannelBuffer::InputOutput(i, o),
        };
        let mut right = right_pair.map(|p| match p {
            ChannelPair::InputOnly(i) => ChannelBuffer::InputOnly(i),
            ChannelPair::OutputOnly(o) => ChannelBuffer::OutputOnly(o),
            ChannelPair::InPlace(b) => ChannelBuffer::InPlace(b),
            ChannelPair::InputOutput(i, o) => ChannelBuffer::InputOutput(i, o),
        });

        let frames = right
            .as_ref()
            .map_or(left.len(), |r| left.len().min(r.len()));
        if frames == 0 {
            return Ok(ProcessStatus::ContinueIfNotQuiet);
        }

        let max_block = self.in_l.len();
        let mut start = 0usize;

        while start < frames {
            let end = (start + max_block).min(frames);
            let block = end - start;

            for j in 0..block {
                let src = start + j;
                self.in_l[j] = left.read(src) as f64;
                self.in_r[j] = right.as_ref().map_or(0.0, |r| r.read(src) as f64);
            }

            {
                let inputs: [&[f64]; 2] = [&self.in_l[..block], &self.in_r[..block]];
                let mut outputs: [&mut [f64]; 2] =
                    [&mut self.out_l[..block], &mut self.out_r[..block]];
                self.engine.process(block, &inputs, &mut outputs);
            }

            for j in 0..block {
                let dst = start + j;
                left.write(dst, self.out_l[j] as f32);
                if let Some(r) = right.as_mut() {
                    r.write(dst, self.out_r[j] as f32);
                }
            }

            start = end;
        }

        if self.params.push_updates(&self.shared.params) {
            self.host.request_callback();
        }

        Ok(ProcessStatus::ContinueIfNotQuiet)
    }
}

// ---- Main thread ------------------------------------------------------

impl<'a> PluginMainThread<'a, PluginSharedState> for MainThread<'a> {
    fn on_main_thread(&mut self) {
        #[cfg(target_os = "macos")]
        if let Some(gui) = &self.gui {
            gui.pump(&self.shared.params);
        }

        if self.params.fetch_updates(&self.shared.params) {
            #[cfg(target_os = "macos")]
            if let Some(gui) = &self.gui {
                for update in self.params.updates() {
                    gui.emit_parameter_changed(update);
                }
            }
        }
    }
}

// ---- Audio ports -------------------------------------------------------

impl<'a> PluginAudioPortsImpl for MainThread<'a> {
    fn count(&mut self, _is_input: bool) -> u32 {
        1
    }

    fn get(&mut self, index: u32, is_input: bool, writer: &mut AudioPortInfoWriter) {
        if index != 0 {
            return;
        }
        writer.set(&AudioPortInfo {
            id: ClapId::new(0),
            name: if is_input {
                b"main input"
            } else {
                b"main output"
            },
            channel_count: 2,
            flags: AudioPortFlags::IS_MAIN,
            port_type: Some(AudioPortType::STEREO),
            in_place_pair: Some(ClapId::new(0)),
        });
    }
}

// ---- GUI (macOS only) -------------------------------------------------

#[cfg(target_os = "macos")]
impl<'a> PluginGuiImpl for MainThread<'a> {
    fn is_api_supported(&mut self, configuration: GuiConfiguration) -> bool {
        configuration.api_type
            == GuiApiType::default_for_current_platform().expect("unsupported platform")
            && !configuration.is_floating
    }

    fn get_preferred_api(&mut self) -> Option<GuiConfiguration<'_>> {
        Some(GuiConfiguration {
            api_type: GuiApiType::default_for_current_platform().expect("unsupported platform"),
            is_floating: false,
        })
    }

    fn create(&mut self, configuration: GuiConfiguration) -> Result<(), PluginError> {
        if configuration.is_floating {
            return Err(PluginError::Message("floating GUI not supported"));
        }
        let supported = GuiApiType::default_for_current_platform().expect("unsupported platform");
        if configuration.api_type != supported {
            return Err(PluginError::Message("unsupported GUI API"));
        }
        Ok(())
    }

    fn destroy(&mut self) {
        self.gui.take();
    }

    fn set_scale(&mut self, _scale: f64) -> Result<(), PluginError> {
        Ok(())
    }

    fn get_size(&mut self) -> Option<GuiSize> {
        Some(GuiSize {
            width: editor::EDITOR_WIDTH,
            height: editor::EDITOR_HEIGHT,
        })
    }

    fn can_resize(&mut self) -> bool {
        true
    }

    fn set_size(&mut self, size: GuiSize) -> Result<(), PluginError> {
        if let Some(gui) = &self.gui {
            gui.set_size(size.width, size.height);
        }
        Ok(())
    }

    fn set_parent(&mut self, window: clack_extensions::gui::Window<'_>) -> Result<(), PluginError> {
        self.gui = Some(Editor::attach(window, Arc::clone(&self.shared.params))?);
        Ok(())
    }

    fn set_transient(
        &mut self,
        _window: clack_extensions::gui::Window<'_>,
    ) -> Result<(), PluginError> {
        Ok(())
    }

    fn show(&mut self) -> Result<(), PluginError> {
        if let Some(gui) = &self.gui {
            gui.set_visible(true);
            gui.focus();
            for update in self.params.updates() {
                gui.emit_parameter_changed(update);
            }
        }
        Ok(())
    }

    fn hide(&mut self) -> Result<(), PluginError> {
        if let Some(gui) = &self.gui {
            gui.set_visible(false);
        }
        Ok(())
    }
}
