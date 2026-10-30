"""
עבודה עם קבצי מדיה: גל סאונד, זיהוי שקטים, חיתוך וייצוא וידאו.
Media helpers: waveform peaks, silence/filler suggestions, cut maths, video export (ffmpeg).
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def _run(args, **kw):
    return subprocess.run(args, creationflags=CREATE_NO_WINDOW, **kw)


def decode_pcm(path, rate=16000):
    """Decode audio of any file to mono float32 at `rate` using ffmpeg."""
    p = _run([ffmpeg_exe(), "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(rate),
              "-f", "s16le", "-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0 and not p.stdout:
        raise RuntimeError(p.stderr.decode("utf-8", "replace")[-500:])
    return np.frombuffer(p.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def probe(path):
    """Duration, whether it has video, and frame rate."""
    info = {"duration": 0.0, "has_video": False, "fps": 30.0}
    try:
        import av
        with av.open(str(path)) as c:
            if c.duration:
                info["duration"] = c.duration / 1_000_000
            v = next((s for s in c.streams if s.type == "video"), None)
            if v is not None and not (v.disposition and "attached_pic" in str(v.disposition).lower()):
                info["has_video"] = True
                rate = v.average_rate or v.guessed_rate
                if rate:
                    info["fps"] = float(rate)
            if not info["duration"]:
                a = next((s for s in c.streams if s.type == "audio"), None)
                if a is not None and a.duration and a.time_base:
                    info["duration"] = float(a.duration * a.time_base)
    except Exception:
        # fallback: parse ffmpeg banner
        p = _run([ffmpeg_exe(), "-i", str(path)], stderr=subprocess.PIPE, stdout=subprocess.DEVNULL)
        txt = p.stderr.decode("utf-8", "replace")
        import re
        m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", txt)
        if m:
            info["duration"] = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
        info["has_video"] = "Video:" in txt
        m = re.search(r"([\d.]+) fps", txt)
        if m:
            info["fps"] = float(m[1])
    if not (1 <= info["fps"] <= 120):
        info["fps"] = 30.0
    return info


def compute_peaks(path, out_file, per_second=50):
    """Waveform peaks (0..1) for drawing; saved as JSON."""
    rate = 8000
    hop = rate // per_second
    proc = subprocess.Popen([ffmpeg_exe(), "-v", "error", "-i", str(path), "-vn", "-ac", "1",
                             "-ar", str(rate), "-f", "s16le", "-"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            creationflags=CREATE_NO_WINDOW)
    peaks, rest = [], np.zeros(0, dtype=np.int16)
    while True:
        chunk = proc.stdout.read(hop * 2 * 2000)
        if not chunk:
            break
        data = np.concatenate([rest, np.frombuffer(chunk, dtype=np.int16)])
        n = len(data) // hop
        if n:
            blocks = np.abs(data[:n * hop].astype(np.int32)).reshape(n, hop).max(1)
            peaks.append(blocks)
        rest = data[n * hop:]
    proc.wait()
    arr = np.concatenate(peaks) if peaks else np.zeros(1)
    top = max(float(np.percentile(arr, 99.5)) if len(arr) else 1.0, 1.0)
    norm = np.clip(arr / top, 0, 1)
    duration = len(arr) / per_second
    Path(out_file).write_text(json.dumps({"duration": duration,
                                          "peaks": [round(float(x), 3) for x in norm]}))
    return duration


def speech_regions(audio, rate, min_gap=0.6, min_len=0.6):
    """Rough loud-region detector (used by developer fake mode)."""
    win = int(rate * 0.05)
    n = len(audio) // win
    if n == 0:
        return []
    e = np.sqrt((audio[:n * win].reshape(n, win) ** 2).mean(1))
    thr = max(e.max() * 0.08, 1e-4)
    on = e > thr
    regions, start = [], None
    for i, v in enumerate(on):
        t = i * 0.05
        if v and start is None:
            start = t
        elif not v and start is not None:
            regions.append([start, t])
            start = None
    if start is not None:
        regions.append([start, n * 0.05])
    merged = []
    for r in regions:
        if merged and r[0] - merged[-1][1] < min_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    out = []
    for s, e2 in merged:
        if e2 - s >= min_len:
            while e2 - s > 6:
                out.append((s, s + 5))
                s += 5
            out.append((s, e2))
    return out


# ---------------------------------------------------------------- cut maths
def merge_intervals(iv):
    iv = sorted([a, b] for a, b in iv if b > a)
    out = []
    for a, b in iv:
        if out and a <= out[-1][1] + 1e-3:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def removed_intervals(project):
    """All parts of the timeline that will be removed: active cuts + deleted sentences."""
    iv = [[c["start"], c["end"]] for c in project.get("cuts", []) if c.get("active", True)]
    iv += [[s["start"], s["end"]] for s in project.get("segments", []) if s.get("deleted")]
    return merge_intervals(iv)


def keep_intervals(removed, duration):
    keep, t = [], 0.0
    for a, b in removed:
        a, b = max(0.0, a), min(duration, b)
        if a > t + 0.02:
            keep.append([t, a])
        t = max(t, b)
    if duration > t + 0.02:
        keep.append([t, duration])
    return keep


def remap_time(t, removed):
    """Time on the edited (cut) timeline for original time t."""
    shift = 0.0
    for a, b in removed:
        if t >= b:
            shift += b - a
        elif t > a:
            return a - shift
        else:
            break
    return t - shift


def remap_segments(segments, removed):
    out = []
    for s in segments:
        if s.get("deleted"):
            continue
        a, b = remap_time(s["start"], removed), remap_time(s["end"], removed)
        if b - a > 0.15:
            out.append({**s, "start": a, "end": b})
    return out


def speech_spans(segments):
    spans = []
    for s in segments:
        if s.get("deleted"):
            continue
        words = s.get("words") or []
        if words:
            spans += [[w["s"], w["e"]] for w in words]
        else:
            spans.append([s["start"], s["end"]])
    return merge_intervals(spans)


def suggest_silence_cuts(segments, duration, min_gap=1.0, keep_pause=0.4):
    """Pauses longer than min_gap are shortened to keep_pause seconds."""
    spans = speech_spans(segments)
    cuts, prev_end = [], 0.0
    for a, b in spans + [[duration, duration]]:
        gap = a - prev_end
        if gap >= min_gap:
            half = keep_pause / 2
            s = prev_end + (0 if prev_end == 0 else half)
            e = a - (0 if a >= duration else half)
            if e - s > 0.1:
                cuts.append({"start": round(s, 3), "end": round(e, 3), "kind": "silence",
                             "active": True})
        prev_end = max(prev_end, b)
    return cuts


def suggest_filler_cuts(segments, fillers):
    fill = {f.strip().strip(".,?!") for f in fillers if f.strip()}
    cuts = []
    for s in segments:
        if s.get("deleted"):
            continue
        for w in s.get("words") or []:
            if w["w"].strip(".,?!…- ") in fill:
                cuts.append({"start": round(w["s"], 3), "end": round(w["e"], 3), "kind": "filler",
                             "active": True, "label": w["w"]})
    return cuts


# ---------------------------------------------------------------- export
def _encoders():
    p = _run([ffmpeg_exe(), "-hide_banner", "-encoders"], stdout=subprocess.PIPE,
             stderr=subprocess.DEVNULL)
    return p.stdout.decode("utf-8", "replace")


def export_cut_media(src, out_path, keep, has_video, fps, extra_audio=None, progress=None,
                     cancel=None):
    """
    Write the edited file containing only the `keep` intervals.
    extra_audio: list of separate track files to mix as the soundtrack instead of the
    video's own audio (all tracks are cut identically, so everything stays in sync).
    """
    if not keep:
        raise RuntimeError("לא נשאר שום קטע לייצוא")
    expr = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in keep)
    total = sum(b - a for a, b in keep)
    lines = []
    if extra_audio:
        n = len(extra_audio)
        ins = "".join(f"[{i + 1}:a]" for i in range(n))
        lines.append(f"{ins}amix=inputs={n}:normalize=0[mix]" if n > 1 else "[1:a]anull[mix]")
        lines.append(f"[mix]aselect='{expr}',asetpts=N/SR/TB[aout]")
    else:
        lines.append(f"[0:a]aselect='{expr}',asetpts=N/SR/TB[aout]")
    if has_video:
        lines.append(f"[0:v]fps={fps:.3f},select='{expr}',setpts=N/FRAME_RATE/TB[vout]")
    graph = ";\n".join(lines)

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write(graph)
        graph_file = f.name

    def build(video_codec):
        args = [ffmpeg_exe(), "-y", "-hide_banner", "-i", str(src)]
        for t in extra_audio or []:
            args += ["-i", str(t)]
        args += ["-filter_complex_script", graph_file, "-map", "[aout]"]
        if has_video:
            args += ["-map", "[vout]"] + video_codec
        args += ["-c:a", "aac", "-b:a", "192k", "-progress", "pipe:1", "-nostats", str(out_path)]
        return args

    codecs = []
    if has_video:
        if "h264_nvenc" in _encoders():
            codecs.append(["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "21", "-pix_fmt", "yuv420p"])
        codecs.append(["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"])
    else:
        codecs.append([])

    last_err = ""
    for codec in codecs:
        proc = subprocess.Popen(build(codec), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                creationflags=CREATE_NO_WINDOW, text=True, encoding="utf-8",
                                errors="replace")
        import threading
        err_lines = []
        t = threading.Thread(target=lambda: err_lines.extend(proc.stderr), daemon=True)
        t.start()
        for line in proc.stdout:
            if cancel is not None and cancel.is_set():
                proc.kill()
                raise RuntimeError("בוטל")
            if line.startswith("out_time_us=") and progress and total:
                try:
                    progress(min(int(line.split("=")[1]) / 1e6 / total, 1.0))
                except ValueError:
                    pass
        proc.wait()
        t.join(timeout=2)
        if proc.returncode == 0:
            Path(graph_file).unlink(missing_ok=True)
            return out_path
        last_err = "".join(err_lines[-15:])
    Path(graph_file).unlink(missing_ok=True)
    raise RuntimeError("שגיאה ביצוא הווידאו:\n" + last_err)
