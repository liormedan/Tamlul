//! First-run setup of the engine's Python environment.
//!
//! The installer only copies the program (tamlul.exe, the Python sources and
//! uv.exe). On the first launch the window shows setup.html, and this module
//! builds everything else in the runtime folder, one step at a time:
//! Python 3.11 (uv), a venv, PyTorch for CUDA, the libraries from
//! requirements.txt, and the models (app/setup_models.py, which also tests the
//! graphics card). Every step is safe to repeat, so after a failure "try
//! again" simply runs them all again and finished steps pass quickly.
//!
//! Progress goes to the window as `setup-progress` events and to
//! runtime/setup.log. ready.json marks a finished setup; the download cache is
//! deleted only then, so a retry does not download PyTorch again.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

pub const READY_FILE: &str = "ready.json";
pub const LOG_FILE: &str = "setup.log";
/// Python, the venv with PyTorch, the models and the download cache while it lasts.
pub const NEED_BYTES: u64 = 12 * 1024 * 1024 * 1024;

const TORCH: [&str; 2] = ["torch==2.5.1", "torchaudio==2.5.1"];
const TORCH_INDEX: &str = "https://download.pytorch.org/whl/cu124";
/// About what the two models take on disk (whisper 1.6GB, speaker 85MB).
const MODELS_BYTES: u64 = 1_750_000_000;

pub const STEPS: [&str; 5] = [
    "התקנת Python 3.11",
    "יצירת סביבה פרטית",
    "הורדת PyTorch לכרטיס המסך",
    "התקנת ספריות התמלול",
    "הורדת המודלים ובדיקת כרטיס המסך",
];

pub fn is_ready(runtime: &Path) -> bool {
    runtime.join(READY_FILE).is_file()
}

fn requirements_hash(root: &Path) -> Result<String, String> {
    let bytes = fs::read(root.join("requirements.txt")).map_err(|e| format!("לא הצלחתי לקרוא requirements.txt: {e}"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

/// The PyTorch pin as installed by step 2. It lives in this file, not in requirements.txt,
/// because it needs its own index, so ready.json records it separately.
fn torch_pin() -> String {
    format!("{} {}", TORCH.join(" "), TORCH_INDEX)
}

/// The package steps (2: PyTorch, 3: requirements.txt) whose recorded fingerprint in ready.json
/// differs from this build. A missing fingerprint means the runtime predates the tracking, so
/// that step runs once; when the packages are already in place uv finishes it in seconds.
/// Empty when the runtime is not set up yet: the setup wizard handles that case.
pub fn stale_package_steps(root: &Path, runtime: &Path) -> Vec<usize> {
    let Ok(current) = requirements_hash(root) else { return Vec::new() };
    let Ok(ready) = fs::read(runtime.join(READY_FILE)) else { return Vec::new() };
    let value = serde_json::from_slice::<serde_json::Value>(&ready).unwrap_or_default();
    let recorded = |key: &str| value.get(key).and_then(|v| v.as_str()).map(str::to_owned);
    let mut steps = Vec::new();
    if recorded("torch").as_deref() != Some(torch_pin().as_str()) {
        steps.push(2);
    }
    if recorded("requirements_sha256").as_deref() != Some(current.as_str()) {
        steps.push(3);
    }
    steps
}

pub fn dependency_update_needed(root: &Path, runtime: &Path) -> bool {
    !stale_package_steps(root, runtime).is_empty()
}

pub fn venv_python(runtime: &Path) -> PathBuf {
    runtime.join("venv").join("Scripts").join("python.exe")
}

/// One message to the window. `kind` is step, line, size, done or error.
#[derive(Clone, Serialize)]
struct Progress {
    kind: &'static str,
    step: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
}

impl Progress {
    fn new(kind: &'static str, step: usize) -> Self {
        Progress { kind, step, line: None, bytes: None, expected: None, error: None, result: None }
    }
}

struct Step {
    cmd: Option<Command>,
    /// Folder whose growth is reported while the step runs.
    watch: Option<PathBuf>,
    expected: Option<u64>,
}

/// uv.exe sits next to tamlul.exe once installed. In development: TAMLUL_UV,
/// src-tauri/bin, or uv on PATH.
fn find_uv(root: &Path) -> PathBuf {
    if let Some(p) = std::env::var_os("TAMLUL_UV").filter(|p| !p.is_empty()) {
        return PathBuf::from(p);
    }
    let exe_dir = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf));
    exe_dir
        .into_iter()
        .chain([root.to_path_buf(), root.join("src-tauri").join("bin")])
        .map(|d| d.join("uv.exe"))
        .find(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from("uv"))
}

fn base_command(program: &Path, runtime: &Path) -> Command {
    let mut cmd = Command::new(program);
    cmd.env("UV_CACHE_DIR", runtime.join("cache"))
        .env("UV_PYTHON_INSTALL_DIR", runtime.join("python"))
        .env("UV_NO_CONFIG", "1")
        .env("UV_NO_PROGRESS", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .env("HF_HUB_DISABLE_PROGRESS_BARS", "1")
        .env_remove("VIRTUAL_ENV")
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .env_remove("CONDA_PREFIX");
    cmd
}

/// The interpreter `uv python install` unpacked: runtime/python/cpython-3.11.<patch>-.../python.exe.
/// Looked up directly instead of through uv's "cpython-3.11-..." junction: on some machines uv
/// fails to verify that junction under %LOCALAPPDATA% (uv 0.12.23, "Missing expected target
/// directory for Python minor version link") although Python itself is fully installed.
fn managed_python(runtime: &Path) -> Option<PathBuf> {
    let mut found: Vec<PathBuf> = fs::read_dir(runtime.join("python"))
        .ok()?
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("cpython-3.11."))
        .map(|e| e.path().join("python.exe"))
        .filter(|p| p.is_file())
        .collect();
    found.sort();
    found.pop()
}

/// The command for step `i`, built when the step starts so it can use what earlier steps
/// produced. None: nothing to do.
fn step(i: usize, root: &Path, runtime: &Path) -> Step {
    let uv = find_uv(root);
    let python = venv_python(runtime);
    let cache = runtime.join("cache");
    match i {
        0 => {
            let mut c = base_command(&uv, runtime);
            c.args(["python", "install", "3.11", "--no-bin", "--no-registry"]);
            Step { cmd: Some(c), watch: Some(runtime.join("python")), expected: None }
        }
        1 => {
            let cmd = (!python.is_file()).then(|| {
                let base = managed_python(runtime).unwrap_or_else(|| PathBuf::from("3.11"));
                let mut c = base_command(&uv, runtime);
                c.arg("venv").arg(runtime.join("venv")).arg("--python").arg(base).arg("--allow-existing");
                c
            });
            Step { cmd, watch: None, expected: None }
        }
        2 => {
            let mut c = base_command(&uv, runtime);
            c.args(["pip", "install", "--python"]).arg(&python).args(TORCH).args(["--index-url", TORCH_INDEX]);
            Step { cmd: Some(c), watch: Some(cache), expected: None }
        }
        3 => {
            let mut c = base_command(&uv, runtime);
            c.args(["pip", "install", "--python"]).arg(&python).arg("-r").arg(root.join("requirements.txt"));
            Step { cmd: Some(c), watch: Some(cache), expected: None }
        }
        _ => {
            let mut c = base_command(&python, runtime);
            c.arg(root.join("app").join("setup_models.py"))
                .current_dir(root)
                .env("TAMLUL_MODELS", runtime.join("models"));
            Step { cmd: Some(c), watch: Some(runtime.join("models")), expected: Some(MODELS_BYTES) }
        }
    }
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

/// Free bytes on the drive that holds `path` (or its nearest existing parent).
pub fn free_bytes(path: &Path) -> Option<u64> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let existing = path.ancestors().find(|p| p.exists())?;
        let wide: Vec<u16> = existing.as_os_str().encode_wide().chain([0]).collect();
        let mut free: u64 = 0;
        let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
        if ok != 0 { Some(free) } else { None }
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        None
    }
}

/// Send the bytes of `stream` as lines; uv and tqdm also use \r for progress.
fn pump(mut stream: impl Read + Send + 'static, tx: mpsc::Sender<String>) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut line = Vec::new();
        loop {
            let n = match stream.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            for &b in &buf[..n] {
                if b == b'\n' || b == b'\r' {
                    if !line.is_empty() {
                        let _ = tx.send(String::from_utf8_lossy(&line).trim_end().to_string());
                        line.clear();
                    }
                } else {
                    line.push(b);
                }
            }
        }
        if !line.is_empty() {
            let _ = tx.send(String::from_utf8_lossy(&line).trim_end().to_string());
        }
    });
}

fn run_step(app: &AppHandle, index: usize, step: Step, log: &mut File) -> Result<Vec<String>, String> {
    let Some(mut cmd) = step.cmd else {
        let _ = writeln!(log, "(already done)");
        return Ok(Vec::new());
    };
    let program = cmd.get_program().to_string_lossy().into_owned();
    let _ = writeln!(log, "> {program} {}", cmd.get_args().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" "));
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    crate::no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("לא הצלחתי להפעיל את {program}: {e}"))?;

    let (tx, rx) = mpsc::channel();
    if let Some(out) = child.stdout.take() {
        pump(out, tx.clone());
    }
    if let Some(err) = child.stderr.take() {
        pump(err, tx.clone());
    }
    drop(tx);

    let mut lines: Vec<String> = Vec::new();
    let mut last_size = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(line) => {
                let _ = writeln!(log, "{line}");
                let mut ev = Progress::new("line", index);
                ev.line = Some(line.clone());
                let _ = app.emit("setup-progress", ev);
                lines.push(line);
                if lines.len() > 400 {
                    lines.drain(..100);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if let Some(dir) = &step.watch {
            if last_size.elapsed() >= Duration::from_secs(2) {
                last_size = Instant::now();
                let mut ev = Progress::new("size", index);
                ev.bytes = Some(dir_size(dir));
                ev.expected = step.expected;
                let _ = app.emit("setup-progress", ev);
            }
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = writeln!(log, "exit: {status}");
    if status.success() {
        Ok(lines)
    } else {
        let tail = lines[lines.len().saturating_sub(12)..].join("\n");
        Err(format!("השלב נכשל.\n{status}\n{tail}"))
    }
}

/// Run every step, write ready.json and drop the download cache. Blocking.
pub fn run(app: &AppHandle, root: &Path, runtime: &Path) -> Result<serde_json::Value, String> {
    fs::create_dir_all(runtime).map_err(|e| format!("{}: {e}", runtime.display()))?;
    let mut log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(runtime.join(LOG_FILE))
        .map_err(|e| e.to_string())?;
    let _ = writeln!(log, "\n===== setup started (unix {}) root={} runtime={}", unix_now(), root.display(), runtime.display());

    let mut result = serde_json::Value::Null;
    for i in 0..STEPS.len() {
        let _ = writeln!(log, "\n--- step {}: {}", i + 1, STEPS[i]);
        let _ = app.emit("setup-progress", Progress::new("step", i));
        let lines = match run_step(app, i, step(i, root, runtime), &mut log) {
            Ok(lines) => lines,
            // The Python step is done when python.exe is there, whatever uv says about its links.
            Err(_) if i == 0 && managed_python(runtime).is_some() => {
                let _ = writeln!(log, "uv reported an error, but Python is installed; continuing");
                Vec::new()
            }
            Err(e) => {
                let _ = writeln!(log, "FAILED: {e}");
                return Err(e);
            }
        };
        if let Some(json) = lines.iter().rev().find_map(|l| l.strip_prefix("TAMLUL_RESULT ")) {
            result = serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
        }
    }

    let ready = serde_json::json!({
        "version": 1,
        "finished": unix_now(),
        "result": result,
        "requirements_sha256": requirements_hash(root)?,
        "torch": torch_pin(),
    });
    fs::write(runtime.join(READY_FILE), serde_json::to_vec_pretty(&ready).unwrap_or_default())
        .map_err(|e| format!("{}: {e}", runtime.join(READY_FILE).display()))?;
    let _ = fs::remove_dir_all(runtime.join("cache"));
    let _ = writeln!(log, "===== setup finished: {result}");
    Ok(result)
}

/// Refresh only the Python packages in the existing runtime: PyTorch when its pin changed,
/// then requirements.txt when it changed. Python, the venv and runtime/models stay as they are.
///
/// `uv pip install` adds and upgrades packages but never removes one, so a package dropped
/// from requirements.txt stays installed (harmless; the engine just does not import it).
/// `uv pip sync` would remove it, but it would also remove PyTorch, which is installed from
/// its own index and is not listed in requirements.txt.
pub fn update_runtime_dependencies(app: &AppHandle, root: &Path, runtime: &Path) -> Result<(), String> {
    if !is_ready(runtime) {
        return Err("סביבת המנוע עוד לא הותקנה.".into());
    }
    let mut log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(runtime.join(LOG_FILE))
        .map_err(|e| e.to_string())?;
    let steps = stale_package_steps(root, runtime);
    let _ = writeln!(log, "\n===== dependency update started (unix {}), steps {:?}", unix_now(), steps.iter().map(|i| i + 1).collect::<Vec<_>>());
    for &i in &steps {
        let _ = writeln!(log, "\n--- step {}: {}", i + 1, STEPS[i]);
        if let Err(e) = run_step(app, i, step(i, root, runtime), &mut log) {
            let _ = writeln!(log, "FAILED: {e}");
            return Err(e);
        }
    }
    let mut ready: serde_json::Value = serde_json::from_slice(&fs::read(runtime.join(READY_FILE)).map_err(|e| e.to_string())?)
        .map_err(|e| format!("קובץ מצב ההתקנה פגום: {e}"))?;
    ready["requirements_sha256"] = serde_json::Value::String(requirements_hash(root)?);
    ready["torch"] = serde_json::Value::String(torch_pin());
    ready["dependencies_updated"] = serde_json::Value::from(unix_now());
    let temp = runtime.join("ready.json.tmp");
    fs::write(&temp, serde_json::to_vec_pretty(&ready).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let marker = runtime.join(READY_FILE);
    let backup = runtime.join("ready.json.bak");
    let _ = fs::remove_file(&backup);
    fs::rename(&marker, &backup).map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(&temp, &marker) {
        let _ = fs::remove_file(&temp);
        let _ = fs::rename(&backup, &marker);
        return Err(error.to_string());
    }
    let _ = fs::remove_file(backup);
    let _ = fs::remove_dir_all(runtime.join("cache"));
    let _ = writeln!(log, "===== dependency update finished");
    Ok(())
}

/// Report the outcome of `run` to the window.
pub fn report(app: &AppHandle, outcome: Result<serde_json::Value, String>) {
    let ev = match outcome {
        Ok(result) => {
            let mut ev = Progress::new("done", STEPS.len());
            ev.result = Some(result);
            ev
        }
        Err(e) => {
            log::error!("setup failed: {e}");
            let mut ev = Progress::new("error", 0);
            ev.error = Some(e);
            ev
        }
    };
    let _ = app.emit("setup-progress", ev);
}
