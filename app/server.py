"""
שרת מקומי של תוכנת התמלול. רץ על המחשב בלבד (127.0.0.1) ופותח את העורך בדפדפן.
Local server: python app/server.py  ->  http://127.0.0.1:8765
"""
import hmac
import json
import os
import re
import shutil
import sys
import threading
import time
import traceback
import uuid
import webbrowser
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_DIR))

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import (FileResponse, JSONResponse, RedirectResponse, Response,  # noqa: E402
                               StreamingResponse)
from fastapi.staticfiles import StaticFiles  # noqa: E402

import ai  # noqa: E402
import engine  # noqa: E402
import exporters  # noqa: E402
import media  # noqa: E402

ROOT = APP_DIR.parent
DATA = ROOT / "data"
PROJECTS = DATA / "projects"
EXPORTS = ROOT / "exports"
for d in (DATA, PROJECTS, EXPORTS):
    d.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("TAMLUL_PORT", "8765"))
APP_VERSION = "0.1.0"
API_VERSION = 1
# The Tauri shell starts the engine with a random per-launch token. When it is set, every /api call
# must carry it, so other programs on this computer cannot drive the engine. Browser mode and the
# pywebview window start without a token and keep working as before.
TOKEN = os.environ.get("TAMLUL_TOKEN") or None

DEFAULT_SETTINGS = {
    "vocabulary": [],
    "corrections": {},
    "fillers": ["אה", "אהה", "אהם", "אמ", "אממ", "אממם", "אום", "הממ", "מממ", "אההה", "אמממ"],
    "silence_min": 1.0,
    "silence_keep": 0.4,
    "speaker_threshold": 0.45,
    "srt_speaker": False,
    "srt_rtl_fix": False,
}

def _authorized(scope):
    """Header X-Tamlul-Token, or ?t= for media URLs (a <video src> cannot send headers)."""
    sent = ""
    for k, v in scope.get("headers") or ():
        if k == b"x-tamlul-token":
            sent = v.decode("latin-1")
            break
    if not sent and "/media/" in scope["path"]:
        from urllib.parse import parse_qs
        sent = (parse_qs(scope.get("query_string", b"").decode("latin-1")).get("t") or [""])[0]
    return hmac.compare_digest(sent.encode(), TOKEN.encode())


class TokenGuard:
    """Plain ASGI middleware (not BaseHTTPMiddleware) so streaming responses pass through untouched.
    Added before CORS, so CORS stays the outer layer: preflights are answered there and a 401 still
    carries the CORS headers the window needs to read it."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (TOKEN and scope["type"] == "http" and scope["path"].startswith("/api/")
                and scope["path"] != "/api/health" and scope.get("method") != "OPTIONS"
                and not _authorized(scope)):
            await JSONResponse({"error": "unauthorized"}, status_code=401)(scope, receive, send)
            return
        await self.app(scope, receive, send)


app = FastAPI()
app.add_middleware(TokenGuard)
# חלון הטאורי מגיש את הממשק מ-tauri.localhost וקורא לשרת הזה ישירות
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)
_file_lock = threading.Lock()


# ---------------------------------------------------------------- storage helpers
def read_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path, data):
    path = Path(path)
    tmp = path.with_suffix(".tmp")
    with _file_lock:
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, path)


def get_settings():
    s = dict(DEFAULT_SETTINGS)
    s.update(read_json(DATA / "settings.json", {}))
    return s


def get_speakers():
    return read_json(DATA / "speakers.json", {})


def pdir(pid):
    if not re.fullmatch(r"[a-f0-9]{8,32}", pid):
        raise HTTPException(404)
    d = PROJECTS / pid
    if not d.is_dir():
        raise HTTPException(404, "הפרויקט לא נמצא")
    return d


def load_project(pid):
    return read_json(pdir(pid) / "project.json", None)


def save_project(p):
    p["updated"] = time.time()
    write_json(PROJECTS / p["id"] / "project.json", p)


def safe_name(name):
    name = re.sub(r'[\\/:*?"<>|]+', "_", name).strip() or "פרויקט"
    return name[:80]


# ---------------------------------------------------------------- background jobs
JOBS = {}  # pid -> {kind, state, progress, message, error, result, cancel}


def start_job(pid, kind, fn):
    job = JOBS.get(pid)
    if job and job["state"] == "running":
        raise HTTPException(409, "יש כבר פעולה שרצה על הפרויקט הזה")
    job = {"kind": kind, "state": "running", "progress": 0.0, "message": "מתחיל...",
           "error": None, "result": None, "cancel": threading.Event(), "log": []}
    JOBS[pid] = job

    def log(msg):
        job["message"] = msg
        job["log"].append(msg)
        print(f"[{pid}] {msg}", flush=True)

    def run():
        try:
            job["result"] = fn(job, log)
            job["state"] = "done"
            job["progress"] = 1.0
        except engine.Cancelled:
            job["state"] = "cancelled"
            job["message"] = "בוטל"
        except Exception as e:
            traceback.print_exc()
            job["state"] = "error"
            job["error"] = friendly_error(e)
            job["message"] = "שגיאה: " + job["error"]

    threading.Thread(target=run, daemon=True).start()
    return job


_MEMORY_ERRORS = ("out of memory", "mkl_malloc", "cublas_status", "cuda failed", "failed to allocate",
                  "cudnn_status", "memoryerror")


def friendly_error(e):
    """Turn low-level GPU / memory failures into something a user can act on; keep the detail."""
    s = f"{type(e).__name__}: {e}" if isinstance(e, MemoryError) else str(e)
    if any(k in s.lower() for k in _MEMORY_ERRORS):
        return ("לא היה מספיק זיכרון במחשב או בכרטיס המסך. סגור תוכנות כבדות ונסה שוב. "
                f"(פרטים: {s[:160]})")
    return s


def effective_status(p):
    """A project marked "transcribing" with no running job was cut off (engine closed or crashed)."""
    st = p.get("status")
    if st == "transcribing":
        job = JOBS.get(p["id"])
        if not job or job["state"] != "running":
            return "interrupted"
    return st


def set_status(pid, status, error=None):
    p = load_project(pid)
    if p is None:
        return
    p["status"] = status
    if error:
        p["error"] = error
    else:
        p.pop("error", None)
    save_project(p)


def job_public(job):
    if not job:
        return {"state": "idle"}
    return {k: job[k] for k in ("kind", "state", "progress", "message", "error", "result")}


# ---------------------------------------------------------------- transcription job
def transcribe_job(pid):
    def fn(job, log):
        p = load_project(pid)
        settings = get_settings()
        d = PROJECTS / pid
        tracks = p["tracks"]
        total_steps = 1 + max(1, len(tracks))

        log("מכין גל סאונד...")
        p["duration"] = media.compute_peaks(p["main"]["path"], d / "peaks_main.json")
        for i, t in enumerate(tracks):
            media.compute_peaks(t["path"], d / f"peaks_t{i}.json")
        job["progress"] = 0.03
        save_project(p)

        segments = []
        if tracks:
            for i, t in enumerate(tracks):
                log(f"מתמלל את הערוץ של {t['speaker']} ({i + 1} מתוך {len(tracks)})...")
                base = 0.05 + 0.9 * i / len(tracks)
                span = 0.9 / len(tracks)
                segs = engine.transcribe(
                    t["path"], settings["vocabulary"], log=log, cancel=job["cancel"],
                    progress=lambda x, b=base, s=span: job.__setitem__("progress", b + s * x))
                for s in segs:
                    s["speaker"] = t["speaker"]
                    s["track"] = i
                segments += segs
            segments.sort(key=lambda s: s["start"])
        else:
            audio = engine.load_audio(p["main"]["path"])
            log("מתמלל... (בפעם הראשונה המודל יורד מהאינטרנט, זה לוקח כמה דקות)")
            segments = engine.transcribe(
                p["main"]["path"], settings["vocabulary"], log=log, cancel=job["cancel"],
                audio=audio, progress=lambda x: job.__setitem__("progress", 0.05 + 0.75 * x))
            log("מזהה דוברים...")
            engine.assign_speakers(segments, audio, get_speakers(),
                                   settings["speaker_threshold"], log=log, cancel=job["cancel"])
        job["progress"] = 0.97
        engine.apply_corrections(segments, settings["corrections"])
        for i, s in enumerate(segments):
            s["id"] = uuid.uuid4().hex[:10]
            s.setdefault("speaker", "דובר 1")
        p["segments"] = segments
        p["cuts"] = []
        p["status"] = "ready"
        p.pop("error", None)
        save_project(p)
        log(f"הסתיים: {len(segments)} משפטים")
        return {"segments": len(segments)}

    def tracked(job, log):
        # The outcome is saved in project.json, so it survives an engine restart (JOBS lives in memory).
        set_status(pid, "transcribing")
        try:
            return fn(job, log)
        except engine.Cancelled:
            set_status(pid, "cancelled")
            raise
        except Exception as e:
            set_status(pid, "error", friendly_error(e))
            raise
    return tracked


# ---------------------------------------------------------------- API: settings & speakers
@app.get("/api/settings")
def api_get_settings():
    return {**get_settings(), "gpu": engine.gpu_info() if not engine.FAKE else {"cuda": False,
                                                                                 "name": "מצב בדיקה"}}


@app.post("/api/settings")
async def api_set_settings(req: Request):
    body = await req.json()
    s = get_settings()
    for k in DEFAULT_SETTINGS:
        if k in body:
            s[k] = body[k]
    s["vocabulary"] = [v.strip() for v in s["vocabulary"] if str(v).strip()]
    s["corrections"] = {k.strip(): v.strip() for k, v in s["corrections"].items() if k.strip()}
    write_json(DATA / "settings.json", s)
    return s


@app.post("/api/corrections/add")
async def api_add_corrections(req: Request):
    body = await req.json()
    s = get_settings()
    for wrong, right in body.get("pairs", []):
        if wrong.strip() and right.strip() and wrong.strip() != right.strip():
            s["corrections"][wrong.strip()] = right.strip()
    write_json(DATA / "settings.json", s)
    return s


@app.get("/api/speakers")
def api_speakers():
    return sorted(get_speakers().keys())


@app.delete("/api/speakers/{name}")
def api_delete_speaker(name: str):
    sp = get_speakers()
    sp.pop(name, None)
    write_json(DATA / "speakers.json", sp)
    return sorted(sp.keys())


# ---------------------------------------------------------------- API: file picker
_pick_lock = threading.Lock()
# desktop.py מחליף את זה בדיאלוג של חלון התוכנה: PICK_HOOK(multiple, kind) -> list[str]
PICK_HOOK = None


@app.post("/api/pick")
async def api_pick(req: Request):
    body = await req.json()
    multiple = bool(body.get("multiple"))
    kind = body.get("kind", "media")

    def pick():
        if PICK_HOOK is not None:
            return list(PICK_HOOK(multiple, kind) or [])
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        types = [("קבצי וידאו ואודיו", "*.mp4 *.mov *.mkv *.avi *.webm *.m4a *.mp3 *.wav *.aac *.flac *.ogg *.wma"),
                 ("כל הקבצים", "*.*")]
        if kind == "audio":
            types = [("קבצי אודיו", "*.m4a *.mp3 *.wav *.aac *.flac *.ogg *.wma *.mp4"),
                     ("כל הקבצים", "*.*")]
        if multiple:
            res = list(filedialog.askopenfilenames(parent=root, filetypes=types))
        else:
            r = filedialog.askopenfilename(parent=root, filetypes=types)
            res = [r] if r else []
        root.destroy()
        return res

    with _pick_lock:
        import asyncio
        files = await asyncio.get_running_loop().run_in_executor(None, pick)
    return {"files": [str(Path(f)) for f in files]}


# ---------------------------------------------------------------- API: health
@app.get("/api/health")
def api_health(req: Request):
    """Open without a token. `authed` tells the caller whether its token matches this engine, so the
    shell can tell its own engine from another program that happens to answer on the port."""
    sent = req.headers.get("x-tamlul-token", "")
    return {"app": "tamlul", "version": APP_VERSION, "api": API_VERSION,
            "authed": (not TOKEN) or hmac.compare_digest(sent.encode(), TOKEN.encode()),
            "token_required": bool(TOKEN), "fake": engine.FAKE,
            "device": engine._whisper_device}  # None until the first transcription loads the model


# ---------------------------------------------------------------- API: projects
@app.get("/api/projects")
def api_projects():
    out = []
    for d in PROJECTS.iterdir():
        p = read_json(d / "project.json", None)
        if p:
            job = JOBS.get(p["id"])
            out.append({"id": p["id"], "name": p["name"], "updated": p.get("updated", 0),
                        "duration": p.get("duration", 0), "status": effective_status(p),
                        "error": p.get("error"),
                        "segments": len(p.get("segments", [])),
                        "job": job_public(job)["state"] if job else "idle"})
    return sorted(out, key=lambda x: -x["updated"])


@app.post("/api/projects")
async def api_create(req: Request):
    body = await req.json()
    video = (body.get("video") or "").strip()
    tracks = [{"path": t["path"], "speaker": (t.get("speaker") or "").strip() or f"דובר {i + 1}"}
              for i, t in enumerate(body.get("tracks") or []) if t.get("path")]
    for f in [video] + [t["path"] for t in tracks]:
        if f and not Path(f).is_file():
            raise HTTPException(400, f"הקובץ לא נמצא: {f}")
    if not video and not tracks:
        raise HTTPException(400, "צריך לבחור קובץ וידאו או אודיו")

    pid = uuid.uuid4().hex[:12]
    d = PROJECTS / pid
    d.mkdir()
    name = (body.get("name") or "").strip() or Path(video or tracks[0]["path"]).stem
    p = {"id": pid, "name": name, "created": time.time(), "status": "transcribing",
         "tracks": tracks, "segments": [], "cuts": [], "speaker_colors": {}}

    if video:
        info = media.probe(video)
        p["main"] = {"path": video, **info}
    elif len(tracks) == 1:
        p["main"] = {"path": tracks[0]["path"], **media.probe(tracks[0]["path"])}
        p["tracks"] = []  # single file -> normal mode
        p["single_track_speaker"] = tracks[0]["speaker"]
    else:
        # audio-only podcast with separate tracks: build a mix for listening
        mix = d / "mix.m4a"
        args = [media.ffmpeg_exe(), "-y", "-v", "error"]
        for t in tracks:
            args += ["-i", t["path"]]
        args += ["-filter_complex", f"amix=inputs={len(tracks)}:normalize=0", "-c:a", "aac",
                 "-b:a", "160k", str(mix)]
        r = media._run(args, stderr=media.subprocess.PIPE)
        if r.returncode != 0:
            raise HTTPException(500, "שגיאה בחיבור הערוצים: " + r.stderr.decode("utf-8", "replace")[-300:])
        p["main"] = {"path": str(mix), **media.probe(mix), "is_mix": True}
    p["duration"] = p["main"].get("duration", 0)
    save_project(p)
    start_job(pid, "transcribe", transcribe_job(pid))
    return {"id": pid}


@app.get("/api/projects/{pid}")
def api_project(pid: str):
    p = load_project(pid)
    if p is None:
        raise HTTPException(404)
    p["status"] = effective_status(p)
    return p


@app.put("/api/projects/{pid}")
async def api_save(pid: str, req: Request):
    p = load_project(pid)
    if p is None:
        raise HTTPException(404)
    body = await req.json()
    for k in ("name", "segments", "cuts", "speaker_colors"):
        if k in body:
            p[k] = body[k]
    save_project(p)
    return {"ok": True, "updated": p["updated"]}


@app.delete("/api/projects/{pid}")
def api_delete(pid: str):
    d = pdir(pid)
    job = JOBS.get(pid)
    if job and job["state"] == "running":
        job["cancel"].set()
    shutil.rmtree(d, ignore_errors=True)
    return {"ok": True}


@app.post("/api/projects/{pid}/retranscribe")
def api_retranscribe(pid: str):
    pdir(pid)
    start_job(pid, "transcribe", transcribe_job(pid))
    return {"ok": True}


@app.get("/api/projects/{pid}/job")
def api_job(pid: str):
    return job_public(JOBS.get(pid))


@app.post("/api/projects/{pid}/cancel")
def api_cancel(pid: str):
    job = JOBS.get(pid)
    if job:
        job["cancel"].set()
    return {"ok": True}


@app.get("/api/projects/{pid}/peaks/{key}")
def api_peaks(pid: str, key: str):
    if not re.fullmatch(r"main|t\d+", key):
        raise HTTPException(404)
    f = pdir(pid) / f"peaks_{key}.json"
    if not f.exists():
        raise HTTPException(404)
    return FileResponse(f, media_type="application/json")


MIME = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/mp4", ".webm": "video/webm",
        ".mkv": "video/webm", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac",
        ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac"}


@app.get("/api/projects/{pid}/media/{key}")
def api_media(pid: str, key: str, request: Request):
    p = load_project(pid)
    if p is None:
        raise HTTPException(404)
    if key == "main":
        path = Path(p["main"]["path"])
    elif re.fullmatch(r"t\d+", key) and int(key[1:]) < len(p["tracks"]):
        path = Path(p["tracks"][int(key[1:])]["path"])
    else:
        raise HTTPException(404)
    if not path.is_file():
        raise HTTPException(404, "קובץ המדיה הוזז או נמחק")
    return ranged_file(path, request)


def ranged_file(path, request):
    size = path.stat().st_size
    ctype = MIME.get(path.suffix.lower(), "application/octet-stream")
    rng = request.headers.get("range")
    start, end = 0, size - 1
    status = 200
    if rng:
        m = re.match(r"bytes=(\d*)-(\d*)", rng)
        if m:
            if m[1]:
                start = int(m[1])
                end = int(m[2]) if m[2] else size - 1
            elif m[2]:
                start = size - int(m[2])
            end = min(end, size - 1)
            status = 206
    if start > end or start >= size:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
    length = end - start + 1

    def body():
        with open(path, "rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(1024 * 1024, left))
                if not chunk:
                    break
                left -= len(chunk)
                yield chunk

    headers = {"Accept-Ranges": "bytes", "Content-Length": str(length)}
    if status == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return StreamingResponse(body(), status_code=status, media_type=ctype, headers=headers)


# ---------------------------------------------------------------- API: editing helpers
@app.post("/api/projects/{pid}/suggest")
async def api_suggest(pid: str, req: Request):
    p = load_project(pid)
    body = await req.json()
    s = get_settings()
    dur = p.get("duration") or p["main"].get("duration", 0)
    cuts = []
    if body.get("silence"):
        cuts += media.suggest_silence_cuts(p["segments"], dur,
                                           float(body.get("min_gap", s["silence_min"])),
                                           float(body.get("keep", s["silence_keep"])))
    if body.get("fillers"):
        cuts += media.suggest_filler_cuts(p["segments"], s["fillers"])
    for c in cuts:
        c["id"] = uuid.uuid4().hex[:10]
    return {"cuts": cuts}


@app.post("/api/projects/{pid}/apply_corrections")
def api_apply_corrections(pid: str):
    p = load_project(pid)
    n = engine.apply_corrections(p["segments"], get_settings()["corrections"])
    save_project(p)
    return {"changed": n, "segments": p["segments"]}


@app.post("/api/projects/{pid}/enroll")
async def api_enroll(pid: str, req: Request):
    """Save the voice of one speaker so future recordings recognise them by name."""
    body = await req.json()
    label, name = body.get("label"), (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "חסר שם")

    def fn(job, log):
        p = load_project(pid)
        segs = [s for s in p["segments"] if s.get("speaker") == label]
        if not segs:
            raise RuntimeError("אין משפטים לדובר הזה")
        tr = segs[0].get("track")
        src = p["tracks"][tr]["path"] if tr is not None and p["tracks"] else p["main"]["path"]
        log(f"לומד את הקול של {name}...")
        audio = engine.load_audio(src)
        vec = engine.voice_print(audio, segs, label)
        if vec is None:
            raise RuntimeError("לא נמצא מספיק דיבור כדי ללמוד את הקול")
        sp = get_speakers()
        if name in sp:  # blend with the old voice print
            import numpy as np
            v = np.asarray(sp[name]) + np.asarray(vec)
            vec = (v / np.linalg.norm(v)).tolist()
        sp[name] = vec
        write_json(DATA / "speakers.json", sp)
        log(f"הקול של {name} נשמר")
        return {"name": name}

    start_job(pid, "enroll", fn)
    return {"ok": True}


# ---------------------------------------------------------------- API: export
def export_dir(p):
    d = EXPORTS / safe_name(p["name"])
    d.mkdir(parents=True, exist_ok=True)
    return d


@app.post("/api/projects/{pid}/export")
async def api_export(pid: str, req: Request):
    body = await req.json()
    kind = body.get("kind")
    edited = bool(body.get("edited"))  # timings for the cut version
    p = load_project(pid)
    s = get_settings()
    d = export_dir(p)
    name = safe_name(p["name"])
    dur = p.get("duration") or p["main"].get("duration", 0)
    removed = media.removed_intervals(p)
    segs = [x for x in p["segments"] if not x.get("deleted")]
    if edited:
        segs = media.remap_segments(segs, removed)
    suffix = "_ערוך" if edited else ""

    if kind == "srt":
        f = exporters.write_srt(segs, d / f"{name}{suffix}.srt", s["srt_speaker"], s["srt_rtl_fix"])
    elif kind == "docx":
        f = exporters.write_docx(segs, d / f"{name}{suffix}.docx", p["name"])
    elif kind == "txt":
        f = exporters.write_txt(segs, d / f"{name}{suffix}.txt")
    elif kind == "video":
        use_tracks = bool(body.get("use_tracks")) and p["tracks"] and not p["main"].get("is_mix")

        def fn(job, log):
            keep = media.keep_intervals(removed, dur)
            info = p["main"]
            ext = ".mp4" if info.get("has_video") else ".m4a"
            out = d / f"{name}_ערוך{ext}"
            log("מייצא... (אפשר להמשיך לעבוד בינתיים)")
            media.export_cut_media(info["path"], out, keep, info.get("has_video"),
                                   info.get("fps", 30), cancel=job["cancel"],
                                   extra_audio=[t["path"] for t in p["tracks"]] if use_tracks else None,
                                   progress=lambda x: job.__setitem__("progress", x))
            exporters.write_srt(media.remap_segments(p["segments"], removed),
                                d / f"{name}_ערוך.srt", s["srt_speaker"], s["srt_rtl_fix"])
            new_len = sum(b - a for a, b in keep)
            log(f"הסתיים. אורך חדש {exporters.fmt_clock(new_len)} (נחתכו {exporters.fmt_clock(dur - new_len)})")
            return {"file": str(out), "folder": str(d)}

        start_job(pid, "export", fn)
        return {"started": True}
    else:
        raise HTTPException(400)
    return {"file": str(f), "folder": str(d)}


@app.post("/api/open_folder")
async def api_open_folder(req: Request):
    body = await req.json()
    folder = Path(body.get("folder") or EXPORTS)
    try:
        folder.resolve().relative_to(ROOT.resolve())
    except ValueError:
        raise HTTPException(400)
    if sys.platform == "win32":
        os.startfile(str(folder))  # noqa
    return {"ok": True}


# ---------------------------------------------------------------- API: AI assistant (Claude API)
AI_FILE = DATA / "ai.json"  # kept apart from settings.json; the key never goes back to the browser


ENV_FILE = ROOT / ".env"


def read_env():
    """Simple .env reader: KEY=VALUE lines, # comments, optional quotes. Re-read on every call."""
    env = {}
    try:
        for line in ENV_FILE.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'").strip()
            env[k.strip()] = v
    except FileNotFoundError:
        pass
    except Exception as e:
        print("Could not read .env:", e)
    return env


def get_ai():
    a = {"key": "", "model": ai.DEFAULT_MODEL, "spent": 0.0}
    a.update(read_json(AI_FILE, {}))
    env = read_env()
    a["from_env"] = False
    env_key = env.get("ANTHROPIC_API_KEY", "")
    if env_key.startswith("sk-"):  # a key in .env wins over one typed in the program
        a["key"], a["from_env"] = env_key, True
    if env.get("TAMLUL_AI_MODEL") in ai.MODELS:
        a["model"] = env["TAMLUL_AI_MODEL"]
        a["model_from_env"] = True
    if a["model"] not in ai.MODELS:
        a["model"] = ai.DEFAULT_MODEL
    return a



def ai_public(a):
    return {"has_key": bool(a["key"]), "masked": ai.mask_key(a["key"]), "model": a["model"],
            "from_env": a.get("from_env", False), "model_from_env": a.get("model_from_env", False),
            "env_path": str(ENV_FILE),
            "spent": round(a.get("spent", 0.0), 4),
            "models": [{"id": k, "label": v["label"], "in": v["in"], "out": v["out"]}
                       for k, v in ai.MODELS.items()],
            "keys_url": ai.CONSOLE_KEYS_URL, "billing_url": ai.CONSOLE_BILLING_URL,
            "presets": list(ai.PRESETS.keys())}


@app.get("/api/ai")
def api_ai_info():
    return ai_public(get_ai())


@app.post("/api/ai")
async def api_ai_config(req: Request):
    body = await req.json()
    stored = {"key": "", "model": ai.DEFAULT_MODEL, "spent": 0.0}
    stored.update(read_json(AI_FILE, {}))  # only what the program itself saved (not .env)
    k = (body.get("key") or "").strip()
    if k and "…" not in k:
        stored["key"] = k
    if body.get("clear_key"):
        stored["key"] = ""
    if body.get("model") in ai.MODELS:
        stored["model"] = body["model"]
    if body.get("reset_spent"):
        stored["spent"] = 0.0
    write_json(AI_FILE, stored)
    return ai_public(get_ai())


@app.post("/api/ai/test")
def api_ai_test():
    a = get_ai()
    try:
        reply = ai.test_key(a["key"], a["model"])
        return {"ok": True, "reply": reply}
    except ai.AIError as e:
        return {"ok": False, "error": str(e), "kind": e.kind}


@app.post("/api/open_url")
async def api_open_url(req: Request):
    body = await req.json()
    url = body.get("url", "")
    if url in (ai.CONSOLE_KEYS_URL, ai.CONSOLE_BILLING_URL):
        webbrowser.open(url)
    return {"ok": True}


def ai_transcript(p, edited):
    segs = [s for s in p.get("segments", []) if not s.get("deleted")]
    if edited:
        segs = media.remap_segments(segs, media.removed_intervals(p))
    return ai.build_transcript(segs)


@app.post("/api/projects/{pid}/ai")
async def api_ai_ask(pid: str, req: Request):
    p = load_project(pid)
    if p is None:
        raise HTTPException(404)
    body = await req.json()
    preset = body.get("preset")
    question = ai.PRESETS.get(preset) if preset else (body.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "חסרה שאלה")
    label = (body.get("label") or question)[:200]
    edited = bool(body.get("edited")) and bool(media.removed_intervals(p))
    a = get_ai()
    transcript = ai_transcript(p, edited)
    if not transcript:
        raise HTTPException(400, "התמלול ריק")
    history = []
    for m in p.get("ai_chat", [])[-12:]:  # keep the last few turns as context
        history.append({"role": m["role"], "content": m["content"]})

    def gen():
        answer = []
        try:
            for kind, val in ai.stream_chat(a["key"], a["model"], transcript, history, question):
                if kind == "text":
                    answer.append(val)
                    yield json.dumps({"t": val}, ensure_ascii=False) + "\n"
                else:
                    text = "".join(answer)
                    pp = load_project(pid)
                    chat = pp.setdefault("ai_chat", [])
                    chat.append({"role": "user", "content": question, "label": label,
                                 "time": time.time()})
                    chat.append({"role": "assistant", "content": text, "edited": edited,
                                 "cost": val["cost"], "model": val["model"], "time": time.time()})
                    save_project(pp)
                    aa = read_json(AI_FILE, {})
                    aa["spent"] = aa.get("spent", 0.0) + val["cost"]
                    write_json(AI_FILE, aa)
                    yield json.dumps({"done": True, "cost": val["cost"], "edited": edited,
                                      "spent": round(aa["spent"], 4), "truncated": val["truncated"],
                                      "usage": val["usage"]}, ensure_ascii=False) + "\n"
        except ai.AIError as e:
            yield json.dumps({"error": str(e), "kind": e.kind}, ensure_ascii=False) + "\n"
        except Exception as e:  # network drop etc.
            traceback.print_exc()
            yield json.dumps({"error": f"שגיאה: {e}", "kind": "error"}, ensure_ascii=False) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.delete("/api/projects/{pid}/ai")
def api_ai_clear(pid: str):
    p = load_project(pid)
    p["ai_chat"] = []
    save_project(p)
    return {"ok": True}


@app.post("/api/projects/{pid}/ai/save")
async def api_ai_save(pid: str, req: Request):
    p = load_project(pid)
    body = await req.json()
    text = body.get("text", "")
    name = safe_name(body.get("name") or "AI")
    d = export_dir(p)
    f = d / f"{safe_name(p['name'])}_{name}.txt"
    f.write_text(text, encoding="utf-8-sig")
    return {"file": str(f), "folder": str(d)}


# ---------------------------------------------------------------- static UI
app.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")


@app.get("/")
def index():
    # index.html uses relative asset paths (the same file is the Tauri frontend)
    return RedirectResponse("/static/index.html")


@app.exception_handler(HTTPException)
async def http_err(_req, exc):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


def ensure_env_file():
    """Create .env (with an empty place for the API key) from .env.example on first run."""
    example = ROOT / ".env.example"
    if not ENV_FILE.exists() and example.exists():
        try:
            shutil.copyfile(example, ENV_FILE)
            print("Created .env - paste your Claude API key there to enable the AI assistant.")
        except Exception as e:
            print("Could not create .env:", e)


def main():
    import socket
    import uvicorn
    ensure_env_file()
    url = f"http://127.0.0.1:{PORT}"
    with socket.socket() as s:
        if s.connect_ex(("127.0.0.1", PORT)) == 0:  # already running -> just open the browser
            print("Tamlul is already running, opening the browser.")
            webbrowser.open(url)
            return
    if os.environ.get("TAMLUL_NO_BROWSER") != "1":
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    print(f"\n  Tamlul is running: {url}\n  (close this window to stop)\n", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
