//! Tamlul desktop shell.
//!
//! The UI (app/static) is served by Tauri; the transcription engine is the
//! Python FastAPI server (app/server.py) on 127.0.0.1. On startup we pick a
//! free port and a random per-launch token, launch the engine from the
//! project's .venv with both, and hand them to the UI through the
//! `engine_info` command. On Windows the engine is tied to a job object so it
//! dies with the app, even on a crash.
//!
//! Development: set TAMLUL_PORT (and TAMLUL_TOKEN if that engine has one)
//! before starting the exe to attach to an engine you started yourself.

use std::fs::{self, OpenOptions};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::Manager;

/// What the UI needs to reach the engine. `error` is set when the engine could
/// not be launched at all, so the window can say why right away.
#[derive(Clone, Serialize)]
struct EngineInfo {
    port: u16,
    token: String,
    error: Option<String>,
}

#[tauri::command]
fn engine_info(state: tauri::State<'_, EngineInfo>) -> EngineInfo {
    state.inner().clone()
}

fn random_token() -> String {
    let mut buf = [0u8; 24];
    getrandom::fill(&mut buf).expect("OS random number generator unavailable");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Ask the OS for a free port. The listener is dropped right before the engine
/// binds it; the window for another program to grab it in between is tiny.
fn free_port() -> Result<u16, String> {
    let l = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("no free port: {e}"))?;
    l.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
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

fn start_engine(port: u16, token: &str) -> Result<(), String> {
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
        .env("TAMLUL_PORT", port.to_string())
        .env("TAMLUL_TOKEN", token)
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
    log::info!("engine started on port {port}, pid {}", child.id());
    Ok(())
}

/// Attach to an engine started by hand (TAMLUL_PORT set), or launch our own.
fn prepare_engine() -> EngineInfo {
    if let Some(port) = std::env::var("TAMLUL_PORT").ok().and_then(|p| p.parse().ok()) {
        log::info!("attaching to the engine on port {port} (TAMLUL_PORT)");
        return EngineInfo { port, token: std::env::var("TAMLUL_TOKEN").unwrap_or_default(), error: None };
    }
    let token = random_token();
    let port = match free_port() {
        Ok(p) => p,
        Err(e) => return EngineInfo { port: 0, token, error: Some(e) },
    };
    let error = start_engine(port, &token).err();
    if let Some(e) = &error {
        log::error!("{e}");
    }
    EngineInfo { port, token, error }
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
    // Join the job object before spawning, so the engine inherits it. The engine
    // info is managed on the builder, so it exists before the window can ask.
    kill_children_on_exit();
    let engine = prepare_engine();
    tauri::Builder::default()
        .manage(engine)
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
            let engine = app.state::<EngineInfo>();
            match &engine.error {
                Some(e) => log::error!("engine not started: {e}"),
                None => log::info!("engine on 127.0.0.1:{}", engine.port),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![engine_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
