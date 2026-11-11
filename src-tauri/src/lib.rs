//! Tamlul desktop shell.
//!
//! The UI (app/static) is served by Tauri; the transcription engine is the
//! Python FastAPI server (app/server.py) on 127.0.0.1. On startup we pick a
//! free port and a random per-launch token, launch the engine from the
//! project's .venv with both, and hand them to the UI through the
//! `engine_info` command. On Windows the engine is tied to a job object so it
//! dies with the app, even on a crash.
//!
//! The shell keeps the engine's process handle: a watcher thread emits
//! `engine-exited` to the window when it stops on its own, `restart_engine`
//! replaces it, and `engine_log` returns the tail of engine.log so the
//! window can show what happened. Only one copy of the app runs at a time; a
//! second launch brings the existing window to the front.
//!
//! User data: a release build keeps projects, settings and engine.log in
//! %LOCALAPPDATA%\<identifier> (passed to the engine as TAMLUL_DATA), apart
//! from the program, which the per-user installer puts in %LOCALAPPDATA%\Tamlul.
//! Updating never touches it; the uninstaller removes it only when the user
//! ticks "delete app data". A debug build keeps the repo's data folder.
//! Setting TAMLUL_DATA overrides both.
//!
//! Python runtime: next to the code when a .venv is there (development, or an
//! install.bat setup). Otherwise in <data>\runtime, built on the first launch
//! by the setup wizard (setup.rs, setup.html); until it is ready the engine is
//! not started and engine_info says `setup_needed`.
//!
//! Development: set TAMLUL_PORT (and TAMLUL_TOKEN if that engine has one)
//! before starting the exe to attach to an engine you started yourself.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

mod setup;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};

/// What the UI needs to reach the engine. `error` is set when the engine could
/// not be launched at all, so the window can say why right away.
#[derive(Clone, Serialize)]
struct EngineInfo {
    port: u16,
    token: String,
    error: Option<String>,
    /// Bumped on every (re)start, so the window can ignore news about an old engine.
    generation: u64,
    /// True when the shell attached to an engine started by hand (TAMLUL_PORT).
    attached: bool,
    /// The Python runtime is not built yet; the window shows setup.html instead.
    setup_needed: bool,
    /// The bundled requirements.txt or PyTorch pin changed since this runtime's packages were installed.
    dependency_update_needed: bool,
}

#[derive(Clone, Serialize)]
struct EngineExited {
    generation: u64,
    code: Option<i32>,
}

struct EngineState {
    info: EngineInfo,
    child: Option<Child>,
    root: Option<PathBuf>,
    data: Option<DataDir>,
    /// Managed runtime folder (venv, models). None: the code folder's own .venv.
    runtime: Option<PathBuf>,
    setup_running: bool,
}

/// Where user data and engine.log go.
#[derive(Clone)]
struct DataDir {
    path: PathBuf,
    /// Passed to the engine as TAMLUL_DATA. False in development, where the
    /// engine keeps its old layout next to the code (data/, exports/, .env).
    pass_to_engine: bool,
}

/// TAMLUL_DATA wins. Otherwise a release build keeps user data in
/// %LOCALAPPDATA%\<identifier> (the folder the uninstaller offers to delete),
/// and a debug build keeps the repo's data folder so development data stays
/// where it was.
fn data_dir(root: Option<&Path>, identifier: &str) -> Option<DataDir> {
    if let Some(d) = std::env::var_os("TAMLUL_DATA").filter(|d| !d.is_empty()) {
        return Some(DataDir { path: PathBuf::from(d), pass_to_engine: true });
    }
    if !cfg!(debug_assertions) {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            return Some(DataDir { path: PathBuf::from(local).join(identifier), pass_to_engine: true });
        }
    }
    root.map(|r| DataDir { path: r.join("data"), pass_to_engine: false })
}

/// TAMLUL_RUNTIME wins. A .venv next to the code means a development or
/// install.bat layout: use it as it is. Otherwise <data>\runtime.
fn runtime_dir(root: Option<&Path>, data: Option<&DataDir>) -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("TAMLUL_RUNTIME").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(d));
    }
    if root.is_some_and(|r| r.join(".venv").join("Scripts").join("python.exe").is_file()) {
        return None;
    }
    data.map(|d| d.path.join("runtime"))
}

fn python_path(root: &Path, runtime: Option<&Path>) -> PathBuf {
    match runtime {
        Some(r) => setup::venv_python(r),
        None => root.join(".venv").join("Scripts").join("python.exe"),
    }
}

struct Engine(Mutex<EngineState>);

impl Engine {
    fn new() -> Self {
        Engine(Mutex::new(EngineState {
            info: EngineInfo { port: 0, token: String::new(), error: None, generation: 0, attached: false, setup_needed: false, dependency_update_needed: false },
            child: None,
            root: None,
            data: None,
            runtime: None,
            setup_running: false,
        }))
    }

    /// Find the code, data and runtime folders. Needs the app's identifier, so it runs in setup().
    fn configure(&self, identifier: &str) {
        let mut st = self.0.lock().unwrap();
        st.root = project_root();
        st.data = data_dir(st.root.as_deref(), identifier);
        st.runtime = runtime_dir(st.root.as_deref(), st.data.as_ref());
        log::info!("root {:?}, data {:?}, runtime {:?}", st.root, st.data.as_ref().map(|d| &d.path), st.runtime);
    }
}

fn needs_setup(st: &EngineState) -> bool {
    st.runtime.as_deref().is_some_and(|r| !setup::is_ready(r))
}

fn needs_dependency_update(st: &EngineState) -> bool {
    st.root.as_deref().zip(st.runtime.as_deref())
        .is_some_and(|(root, runtime)| setup::dependency_update_needed(root, runtime))
}

#[tauri::command]
fn engine_info(engine: tauri::State<'_, Engine>) -> EngineInfo {
    engine.0.lock().unwrap().info.clone()
}

/// Stop the current engine (if it is ours) and start a fresh one on a new port.
#[tauri::command]
async fn restart_engine(engine: tauri::State<'_, Engine>) -> Result<EngineInfo, String> {
    let old = {
        let mut st = engine.0.lock().unwrap();
        if st.info.attached {
            return Err("המנוע הופעל ידנית (TAMLUL_PORT). צריך להפעיל אותו מחדש מבחוץ.".into());
        }
        if needs_setup(&st) || st.setup_running {
            return Err("ההתקנה עוד לא הסתיימה.".into());
        }
        // Taking the child out first keeps the watcher from reporting this exit as a crash.
        st.child.take()
    };
    if let Some(child) = old {
        kill_tree(child);
    }
    let mut st = engine.0.lock().unwrap();
    launch(&mut st);
    Ok(st.info.clone())
}

/// Stop the engine, update only its Python packages, preserve models, and restart it.
/// The package install takes minutes, so it runs on a blocking worker thread: a plain
/// (non-async) command would run on the main thread and freeze the window meanwhile.
#[tauri::command]
async fn update_engine_dependencies(app: tauri::AppHandle) -> Result<EngineInfo, String> {
    tauri::async_runtime::spawn_blocking(move || update_dependencies_blocking(&app))
        .await
        .map_err(|e| format!("עדכון חבילות המנוע נקטע: {e}"))?
}

fn update_dependencies_blocking(app: &tauri::AppHandle) -> Result<EngineInfo, String> {
    let engine = app.state::<Engine>();
    let (old, root, runtime) = {
        let mut st = engine.0.lock().unwrap();
        if st.info.attached {
            return Err("המנוע הופעל ידנית; עדכון החבילות האוטומטי זמין רק למנוע המנוהל של Tamlul.".into());
        }
        if st.setup_running {
            return Err("סביבת המנוע כבר מתעדכנת.".into());
        }
        if !needs_dependency_update(&st) {
            return Ok(st.info.clone());
        }
        let root = st.root.clone().ok_or("app/server.py not found")?;
        let runtime = st.runtime.clone().ok_or("לא נמצאה סביבת מנוע לעדכון")?;
        // Blocks restart_engine and a second update until the packages are in place.
        st.setup_running = true;
        (st.child.take(), root, runtime)
    };
    if let Some(child) = old { kill_tree(child); }

    let outcome = setup::update_runtime_dependencies(app, &root, &runtime);
    let mut st = engine.0.lock().unwrap();
    st.setup_running = false;
    launch(&mut st);
    match outcome {
        Ok(()) => Ok(st.info.clone()),
        Err(error) => Err(format!("עדכון חבילות המנוע נכשל: {error}")),
    }
}

/// The last `lines` lines of engine.log (default 200), read from the end of the file.
#[tauri::command]
fn engine_log(engine: tauri::State<'_, Engine>, lines: Option<usize>) -> Result<String, String> {
    let data = engine.0.lock().unwrap().data.clone().ok_or("app/server.py not found")?;
    tail(&data.path.join("engine.log"), lines.unwrap_or(200))
}

/// The last `lines` lines of a text file, read from its last 256KB.
fn tail(path: &Path, lines: usize) -> Result<String, String> {
    let mut f = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(256 * 1024);
    f.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf);
    let all: Vec<&str> = text.lines().collect();
    let n = lines.min(all.len());
    Ok(all[all.len() - n..].join("\n"))
}

#[derive(Serialize)]
struct SetupInfo {
    needed: bool,
    running: bool,
    runtime: Option<PathBuf>,
    free_bytes: Option<u64>,
    need_bytes: u64,
    steps: Vec<&'static str>,
}

#[tauri::command]
fn setup_info(engine: tauri::State<'_, Engine>) -> SetupInfo {
    let st = engine.0.lock().unwrap();
    SetupInfo {
        needed: needs_setup(&st),
        running: st.setup_running,
        free_bytes: st.runtime.as_deref().and_then(setup::free_bytes),
        runtime: st.runtime.clone(),
        need_bytes: setup::NEED_BYTES,
        steps: setup::STEPS.to_vec(),
    }
}

/// Start building the runtime in the background. Progress arrives as `setup-progress` events.
#[tauri::command]
fn start_setup(app: tauri::AppHandle, engine: tauri::State<'_, Engine>) -> Result<(), String> {
    let (root, runtime) = {
        let mut st = engine.0.lock().unwrap();
        if st.setup_running {
            return Ok(());
        }
        let root = st.root.clone().ok_or("app/server.py not found")?;
        let runtime = st.runtime.clone().ok_or("nothing to set up: the program uses its own .venv")?;
        st.setup_running = true;
        (root, runtime)
    };
    std::thread::spawn(move || {
        let outcome = setup::run(&app, &root, &runtime);
        app.state::<Engine>().0.lock().unwrap().setup_running = false;
        setup::report(&app, outcome);
    });
    Ok(())
}

/// After a finished setup: start the engine and return what the window needs to reach it.
#[tauri::command]
fn finish_setup(engine: tauri::State<'_, Engine>) -> Result<EngineInfo, String> {
    let mut st = engine.0.lock().unwrap();
    if needs_setup(&st) {
        return Err("ההתקנה עוד לא הסתיימה.".into());
    }
    st.info.setup_needed = false;
    if st.child.is_none() && !st.info.attached {
        launch(&mut st);
    }
    Ok(st.info.clone())
}

#[tauri::command]
fn setup_log(engine: tauri::State<'_, Engine>, lines: Option<usize>) -> Result<String, String> {
    let runtime = engine.0.lock().unwrap().runtime.clone().ok_or("no runtime folder")?;
    tail(&runtime.join(setup::LOG_FILE), lines.unwrap_or(200))
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
/// in development, the repo root above src-tauri. The build also copies the
/// bundled resources next to the exe in target\, so a debug build looks at
/// the repo first, while a release build behaves like an installed copy.
fn project_root() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("TAMLUL_HOME") {
        return Some(PathBuf::from(dir));
    }
    let exe = std::env::current_exe().ok()?;
    let dev_root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf);
    let has_server = |d: &PathBuf| d.join("app").join("server.py").is_file();
    if cfg!(debug_assertions) {
        if let Some(d) = dev_root.clone().filter(has_server) {
            return Some(d);
        }
    }
    exe.ancestors().map(Path::to_path_buf).chain(dev_root).find(has_server)
}

fn spawn_engine(root: &Path, data: &DataDir, runtime: Option<&Path>, port: u16, token: &str) -> Result<Child, String> {
    let python = python_path(root, runtime);
    if !python.is_file() {
        return Err(match runtime {
            Some(_) => format!("סביבת הפייתון חסרה ({}). סגור את התוכנה ופתח אותה שוב כדי להתקין אותה מחדש.", python.display()),
            None => format!("{} not found - run install.bat first", python.display()),
        });
    }
    fs::create_dir_all(&data.path).map_err(|e| format!("{}: {e}", data.path.display()))?;
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(data.path.join("engine.log"))
        .map_err(|e| e.to_string())?;
    let log_err = log_file.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&python);
    cmd.arg(root.join("app").join("server.py"))
        .current_dir(root)
        .env("TAMLUL_NO_BROWSER", "1")
        .env("TAMLUL_PORT", port.to_string())
        .env("TAMLUL_TOKEN", token)
        .env("TAMLUL_VERSION", env!("CARGO_PKG_VERSION"))
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_err));
    if data.pass_to_engine {
        cmd.env("TAMLUL_DATA", &data.path);
    } else {
        cmd.env_remove("TAMLUL_DATA");
    }
    match runtime {
        Some(r) => cmd.env("TAMLUL_MODELS", r.join("models")),
        None => cmd.env_remove("TAMLUL_MODELS"),
    };
    no_window(&mut cmd);
    cmd.spawn().map_err(|e| format!("failed to start {}: {e}", python.display()))
}

/// Start a new engine and record it in `st`: new port, same token, next generation.
fn launch(st: &mut EngineState) {
    st.info.dependency_update_needed = needs_dependency_update(st);
    st.info.generation += 1;
    if st.info.token.is_empty() {
        st.info.token = random_token();
    }
    let paths = st.root.clone().zip(st.data.clone()).ok_or_else(|| "app/server.py not found".to_string());
    let runtime = st.runtime.clone();
    let result = paths.and_then(|(root, data)| {
        let port = free_port()?;
        spawn_engine(&root, &data, runtime.as_deref(), port, &st.info.token).map(|child| (port, child))
    });
    match result {
        Ok((port, child)) => {
            log::info!("engine #{} on 127.0.0.1:{port}, pid {}", st.info.generation, child.id());
            st.info.port = port;
            st.info.error = None;
            st.child = Some(child);
        }
        Err(e) => {
            log::error!("engine not started: {e}");
            st.info.error = Some(e);
            st.child = None;
        }
    }
}

/// Attach to an engine started by hand (TAMLUL_PORT set), or launch our own.
fn start(engine: &Engine) {
    let mut st = engine.0.lock().unwrap();
    if let Some(port) = std::env::var("TAMLUL_PORT").ok().and_then(|p| p.parse().ok()) {
        log::info!("attaching to the engine on port {port} (TAMLUL_PORT)");
        st.info = EngineInfo {
            port,
            token: std::env::var("TAMLUL_TOKEN").unwrap_or_default(),
            error: None,
            generation: 1,
            attached: true,
            setup_needed: false,
            dependency_update_needed: false,
        };
        return;
    }
    if needs_setup(&st) {
        log::info!("the Python runtime is not set up yet; waiting for the setup wizard");
        st.info.setup_needed = true;
        return;
    }
    launch(&mut st);
}

/// Poll the engine process; when it exits on its own, tell the window.
fn watch(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let exited = {
            let engine = app.state::<Engine>();
            let mut st = engine.0.lock().unwrap();
            let generation = st.info.generation;
            match st.child.as_mut().map(|c| c.try_wait()) {
                Some(Ok(Some(status))) => {
                    st.child = None;
                    Some(EngineExited { generation, code: status.code() })
                }
                _ => None,
            }
        };
        if let Some(ev) = exited {
            log::warn!("engine #{} exited, code {:?}", ev.generation, ev.code);
            let _ = app.emit("engine-exited", ev);
        }
    });
}

/// The venv's python.exe is a launcher that starts the real interpreter as a
/// child, so killing only the direct child would leave the engine running.
fn kill_tree(mut child: Child) {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        no_window(&mut cmd);
        let _ = cmd.status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub(crate) fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
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
        // First plugin: a second launch exits here, before it can start an engine of its own.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .manage(Engine::new())
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
            // Join the job object before spawning, so the engine inherits it. Commands from the
            // window are handled by the event loop, which starts after setup, so engine_info
            // always sees a started engine.
            kill_children_on_exit();
            let engine = app.state::<Engine>();
            engine.configure(&app.config().identifier);
            start(&engine);
            watch(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine_info,
            restart_engine,
            update_engine_dependencies,
            engine_log,
            setup_info,
            start_setup,
            finish_setup,
            setup_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
