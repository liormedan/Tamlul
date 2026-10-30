//! Tamlul desktop shell.
//!
//! The UI (app/static) is served by Tauri; the transcription engine is the
//! Python FastAPI server (app/server.py) on 127.0.0.1:8765. On startup we
//! launch it from the project's .venv unless it is already running, and on
//! Windows we tie it to a job object so it dies with the app, even on a crash.

use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

const PORT: u16 = 8765;

fn engine_running() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// Folder that holds app/server.py: next to the exe (installed layout) or,
/// in development, the repo root above src-tauri.
fn project_root() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("TAMLUL_HOME") {
        return Some(PathBuf::from(dir));
    }
    let exe = std::env::current_exe().ok()?;
    let dev_root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf);
    exe.ancestors()
        .map(Path::to_path_buf)
        .chain(dev_root)
        .find(|d| d.join("app").join("server.py").is_file())
}

fn start_engine() -> Result<(), String> {
    if engine_running() {
        log::info!("engine already running on port {PORT}");
        return Ok(());
    }
    let root = project_root().ok_or("app/server.py not found")?;
    let python = root.join(".venv").join("Scripts").join("python.exe");
    if !python.is_file() {
        return Err(format!("{} not found - run install.bat first", python.display()));
    }
    fs::create_dir_all(root.join("data")).map_err(|e| e.to_string())?;
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join("data").join("engine.log"))
        .map_err(|e| e.to_string())?;
    let log_err = log_file.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&python);
    cmd.arg(root.join("app").join("server.py"))
        .current_dir(&root)
        .env("TAMLUL_NO_BROWSER", "1")
        .env("TAMLUL_PORT", PORT.to_string())
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd.spawn().map_err(|e| format!("failed to start {}: {e}", python.display()))?;
    log::info!("engine started, pid {}", child.id());
    Ok(())
}

/// Put this process in a job that kills every member when its last handle
/// closes. Children (the venv launcher and the real python.exe it spawns)
/// inherit the job, so the engine never outlives the window.
#[cfg(windows)]
fn kill_children_on_exit() {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            log::warn!("CreateJobObjectW failed");
            return;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 || AssignProcessToJobObject(job, GetCurrentProcess()) == 0 {
            log::warn!("could not set up the job object; the engine may outlive the window");
        }
        // The handle is intentionally leaked: it closes when this process exits.
    }
}

#[cfg(not(windows))]
fn kill_children_on_exit() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            kill_children_on_exit();
            // The UI waits for the engine itself and shows the error if it never comes up.
            if let Err(e) = start_engine() {
                log::error!("{e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
