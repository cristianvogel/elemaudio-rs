//! Framework-level file logger.
//!
//! Writes to `~/Library/Logs/elemaudio-rs-plugin.log` on macOS,
//! `$XDG_DATA_HOME/elemaudio-rs-plugin.log` on Linux, or
//! `%APPDATA%/elemaudio-rs-plugin.log` on Windows.
//!
//! Call [`init`] once early in the plugin lifecycle (e.g., in the CLAP
//! `new_shared` callback). Subsequent calls are no-ops.
//!
//! Uses the [`log`] facade — all `log::info!`, `log::error!`, etc. macros
//! write to the file after init.
//!
//! **Realtime safety:** The logger acquires a `Mutex` on every log call.
//! Do NOT use `log::*` macros on the audio thread.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, Once};
use std::time::SystemTime;

use log::{LevelFilter, Log, Metadata, Record};

static INIT: Once = Once::new();

/// Initialize the file logger. Safe to call multiple times — only the
/// first call has any effect.
///
/// Log file location:
/// - macOS: `~/Library/Logs/elemaudio-rs-plugin.log`
/// - Linux: `$XDG_DATA_HOME/elemaudio-rs-plugin.log` (or `~/.local/share/`)
/// - Windows: `%APPDATA%/elemaudio-rs-plugin.log`
pub fn init() {
    INIT.call_once(|| {
        if let Some(path) = log_file_path() {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }

            let file = OpenOptions::new().create(true).append(true).open(&path);

            match file {
                Ok(f) => {
                    let logger = FileLogger(Mutex::new(f));
                    // Box::leak is intentional — the logger must live for
                    // the entire process lifetime (log crate requirement).
                    let leaked = Box::leak(Box::new(logger));
                    let _ = log::set_logger(leaked);
                    log::set_max_level(LevelFilter::Debug);
                    log::info!("elemaudio-rs logger initialized: {}", path.display());
                }
                Err(e) => {
                    eprintln!(
                        "elemaudio-rs: failed to open log file {}: {e}",
                        path.display()
                    );
                }
            }
        }
    });
}

fn log_file_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|h| h.join("Library/Logs/elemaudio-rs-plugin.log"))
    }
    #[cfg(target_os = "linux")]
    {
        dirs::data_dir()
            .or_else(dirs::home_dir)
            .map(|d| d.join("elemaudio-rs-plugin.log"))
    }
    #[cfg(target_os = "windows")]
    {
        dirs::data_dir().map(|d| d.join("elemaudio-rs-plugin.log"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        dirs::home_dir().map(|h| h.join("elemaudio-rs-plugin.log"))
    }
}

struct FileLogger(Mutex<File>);

impl Log for FileLogger {
    fn enabled(&self, _metadata: &Metadata) -> bool {
        true
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        if let Ok(mut file) = self.0.lock() {
            let timestamp = format_timestamp();
            let _ = writeln!(
                file,
                "[{timestamp}] [{level}] {msg}",
                level = record.level(),
                msg = record.args(),
            );
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.0.lock() {
            let _ = file.flush();
        }
    }
}

fn format_timestamp() -> String {
    match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(d) => {
            let secs = d.as_secs();
            let millis = d.subsec_millis();
            format!("{secs}.{millis:03}")
        }
        Err(_) => "0.000".to_string(),
    }
}
