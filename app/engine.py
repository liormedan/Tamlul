"""
מנוע התמלול: Whisper בעברית (מודל ivrit.ai), זיהוי דוברים, מילון מילים ותיקונים.

Transcription engine: faster-whisper with the ivrit.ai Hebrew model,
speaker clustering / enrollment (SpeechBrain ECAPA), vocabulary and corrections.
"""
import os
import re
import sys
import threading
from pathlib import Path

import numpy as np

APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent
# The installed app keeps its models apart from the code (TAMLUL_MODELS, set by the Tauri shell).
MODELS_DIR = Path(os.environ["TAMLUL_MODELS"]) if os.environ.get("TAMLUL_MODELS") else ROOT_DIR / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

os.environ.setdefault("HF_HOME", str(MODELS_DIR / "hf"))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

if os.name == "nt":
    # The Hugging Face cache links snapshot files to blobs with symlinks. On Windows that needs a
    # privilege most users lack, and on some machines its own test passes while the real link then
    # fails (WinError 1314 under %LOCALAPPDATA%). Store real files instead; nothing is duplicated.
    try:
        import huggingface_hub.file_download as _hf_download
        _hf_download.are_symlinks_supported = lambda *args, **kwargs: False
    except Exception:  # noqa: BLE001 - only an optimisation of how files are stored
        pass

WHISPER_MODEL = "ivrit-ai/whisper-large-v3-turbo-ct2"
SPEAKER_MODEL = "speechbrain/spkrec-ecapa-voxceleb"
SAMPLE_RATE = 16000

# מצב בדיקה בלי מודלים (למפתחים): TAMLUL_FAKE=1
FAKE = os.environ.get("TAMLUL_FAKE") == "1"

_lock = threading.Lock()
_whisper = None
_whisper_device = None
_speaker_model = None


class Cancelled(Exception):
    pass


# ---------------------------------------------------------------- GPU setup
def _setup_cuda_dlls():
    """On Windows, let CTranslate2 find the CUDA/cuDNN DLLs that ship with PyTorch."""
    if sys.platform != "win32":
        return
    dirs = []
    try:
        import torch  # noqa: F401  (importing torch loads its CUDA DLLs)
        dirs.append(Path(torch.__file__).parent / "lib")
    except Exception:
        pass
    try:
        import nvidia  # optional pip packages nvidia-cublas-cu12 / nvidia-cudnn-cu12
        for p in Path(list(nvidia.__path__)[0]).glob("*/bin"):
            dirs.append(p)
    except Exception:
        pass
    for d in dirs:
        if d.is_dir():
            try:
                os.add_dll_directory(str(d))
            except Exception:
                pass
            os.environ["PATH"] = str(d) + os.pathsep + os.environ.get("PATH", "")


def gpu_info():
    try:
        import torch
        if torch.cuda.is_available():
            return {"cuda": True, "name": torch.cuda.get_device_name(0)}
    except Exception:
        pass
    return {"cuda": False, "name": None}


def load_whisper(log=print):
    global _whisper, _whisper_device
    if FAKE:
        return None
    with _lock:
        if _whisper is not None:
            return _whisper
        _setup_cuda_dlls()
        from faster_whisper import WhisperModel
        try:
            log("טוען מודל תמלול לכרטיס המסך...")
            _whisper = WhisperModel(WHISPER_MODEL, device="cuda", compute_type="float16",
                                    download_root=str(MODELS_DIR / "whisper"))
            _whisper_device = "cuda"
        except Exception as e:  # no GPU / driver problem -> CPU fallback
            log(f"כרטיס המסך לא זמין ({e}); עובר למעבד, זה יהיה איטי יותר.")
            _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8",
                                    download_root=str(MODELS_DIR / "whisper"))
            _whisper_device = "cpu"
        return _whisper


def load_speaker_model(log=print):
    global _speaker_model
    if FAKE:
        return None
    with _lock:
        if _speaker_model is not None:
            return _speaker_model
        import torch
        from speechbrain.inference.speaker import EncoderClassifier
        kwargs = {}
        try:
            from speechbrain.utils.fetching import LocalStrategy
            kwargs["local_strategy"] = LocalStrategy.COPY  # Windows: no symlinks
        except Exception:
            pass
        device = "cuda" if torch.cuda.is_available() else "cpu"
        log("טוען מודל זיהוי דוברים...")
        _speaker_model = EncoderClassifier.from_hparams(
            source=SPEAKER_MODEL, savedir=str(MODELS_DIR / "speaker"),
            run_opts={"device": device}, **kwargs)
        return _speaker_model


# ---------------------------------------------------------------- audio
def load_audio(path):
    """Decode any audio/video file to mono 16 kHz float32."""
    from media import decode_pcm
    return decode_pcm(path, SAMPLE_RATE)


# ---------------------------------------------------------------- transcription
def transcribe(path, vocabulary=(), progress=None, cancel=None, log=print, audio=None):
    """Return list of segments: {start, end, text, words:[{s,e,w}]}"""
    if audio is None:
        audio = load_audio(path)
    duration = len(audio) / SAMPLE_RATE
    if FAKE:
        return _fake_transcribe(audio, duration, progress)

    model = load_whisper(log)
    vocab = [v.strip() for v in vocabulary if v and v.strip()]
    kwargs = dict(language="he", beam_size=5, word_timestamps=True, vad_filter=True,
                  vad_parameters={"min_silence_duration_ms": 500},
                  condition_on_previous_text=False)
    if vocab:
        kwargs["hotwords"] = " ".join(vocab)[:800]
    seg_iter, _info = model.transcribe(audio, **kwargs)
    out = []
    for seg in seg_iter:
        if cancel is not None and cancel.is_set():
            raise Cancelled()
        words = [{"s": round(w.start, 3), "e": round(w.end, 3), "w": w.word.strip()}
                 for w in (seg.words or []) if w.word.strip()]
        text = seg.text.strip()
        if not text:
            continue
        out.append({"start": round(seg.start, 3), "end": round(seg.end, 3),
                    "text": text, "words": words})
        if progress and duration:
            progress(min(seg.end / duration, 1.0))
    return split_long_segments(out)


def split_long_segments(segments, max_len=7.0, max_chars=84):
    """Break long Whisper segments into subtitle-sized sentences using word timings."""
    result = []
    for seg in segments:
        words = seg.get("words") or []
        if (seg["end"] - seg["start"] <= max_len and len(seg["text"]) <= max_chars) or len(words) < 4:
            result.append(seg)
            continue
        cur = []
        for i, w in enumerate(words):
            cur.append(w)
            text = " ".join(x["w"] for x in cur)
            ends_sentence = w["w"][-1:] in ".?!,:"
            too_long = (cur[-1]["e"] - cur[0]["s"] > max_len) or len(text) > max_chars
            last = i == len(words) - 1
            if last or (ends_sentence and cur[-1]["e"] - cur[0]["s"] > 2.0) or too_long:
                result.append({"start": cur[0]["s"], "end": cur[-1]["e"], "text": text,
                               "words": cur})
                cur = []
    return result


def _fake_transcribe(audio, duration, progress):
    """Developer mode: fake sentences on loud regions so the UI can be tested without GPU."""
    from media import speech_regions
    sample = ["שלום וברוכים הבאים לפודקאסט", "אה היום נדבר על נושא מעניין",
              "זה משפט לבדיקה של התוכנה", "תודה רבה שהייתם איתנו"]
    out = []
    for i, (s, e) in enumerate(speech_regions(audio, SAMPLE_RATE)):
        text = sample[i % len(sample)]
        ws = text.split()
        step = (e - s) / len(ws)
        words = [{"s": round(s + k * step, 3), "e": round(s + (k + 1) * step - 0.02, 3), "w": w}
                 for k, w in enumerate(ws)]
        out.append({"start": round(s, 3), "end": round(e, 3), "text": text, "words": words})
        if progress:
            progress(e / duration)
    return out


# ---------------------------------------------------------------- speakers
def embed(audio, start, end):
    """Voice fingerprint of a stretch of audio (L2-normalized)."""
    a = audio[int(start * SAMPLE_RATE):int(end * SAMPLE_RATE)]
    if len(a) < SAMPLE_RATE * 0.5:
        return None
    if FAKE:
        # crude fake: spectrum shape
        spec = np.abs(np.fft.rfft(a[:SAMPLE_RATE * 2], n=4096))[:256]
        v = np.log1p(spec.reshape(32, 8).mean(1))
    else:
        import torch
        model = load_speaker_model()
        with torch.no_grad():
            t = torch.from_numpy(np.ascontiguousarray(a)).float().unsqueeze(0)
            v = model.encode_batch(t).squeeze().cpu().numpy()
    n = np.linalg.norm(v)
    return (v / n).astype(np.float32) if n > 0 else None


def assign_speakers(segments, audio, enrolled, threshold=0.45, log=print, cancel=None):
    """Label each segment with a known name (enrolled voices) or 'דובר N'."""
    if not segments:
        return
    try:
        if not FAKE:
            load_speaker_model(log)
    except Exception as e:
        log(f"זיהוי דוברים לא זמין ({e}). כל המשפטים יסומנו 'דובר 1'.")
        for s in segments:
            s["speaker"] = "דובר 1"
        return

    known = {name: np.asarray(v, dtype=np.float32) for name, v in (enrolled or {}).items()}
    clusters = []  # [{label, sum, n}]
    for idx, seg in enumerate(segments):
        if cancel is not None and cancel.is_set():
            raise Cancelled()
        v = embed(audio, seg["start"], seg["end"])
        seg["_emb"] = v
        if v is None:
            continue
        best_name, best = None, -1.0
        for name, kv in known.items():
            sim = float(np.dot(v, kv) / (np.linalg.norm(kv) + 1e-9))
            if sim > best:
                best_name, best = name, sim
        if best_name is not None and best >= threshold:
            seg["speaker"] = best_name
            continue
        best_c, best = None, -1.0
        for c in clusters:
            cen = c["sum"] / np.linalg.norm(c["sum"])
            sim = float(np.dot(v, cen))
            if sim > best:
                best_c, best = c, sim
        if best_c is not None and best >= threshold:
            best_c["sum"] += v
            best_c["n"] += 1
            seg["speaker"] = best_c["label"]
        else:
            label = f"דובר {len(clusters) + 1}"
            clusters.append({"label": label, "sum": v.copy(), "n": 1})
            seg["speaker"] = label

    # short segments: take the speaker of the nearest neighbour
    last = None
    for seg in segments:
        if "speaker" in seg:
            last = seg["speaker"]
        elif last:
            seg["speaker"] = last
    first = next((s["speaker"] for s in segments if "speaker" in s), "דובר 1")
    for seg in segments:
        seg.setdefault("speaker", first)
        seg.pop("_emb", None)


def voice_print(audio, segments, label, max_segments=25):
    """Average voice fingerprint for all segments of one speaker (for enrollment)."""
    vecs = []
    chosen = sorted((s for s in segments if s.get("speaker") == label and not s.get("deleted")),
                    key=lambda s: s["end"] - s["start"], reverse=True)[:max_segments]
    for s in chosen:
        v = embed(audio, s["start"], s["end"])
        if v is not None:
            vecs.append(v)
    if not vecs:
        return None
    m = np.mean(vecs, axis=0)
    return (m / np.linalg.norm(m)).tolist()


# ---------------------------------------------------------------- corrections
HEB_PREFIX = "והבלמשכ"


def _pattern(wrong):
    return re.compile(r"(?<!\w)([" + HEB_PREFIX + r"]{0,2})" + re.escape(wrong) + r"(?!\w)")


def apply_corrections(segments, corrections):
    """Replace mistaken words everywhere (keeps Hebrew prefixes like ו/ה/ב/ל)."""
    if not corrections:
        return 0
    pats = [(_pattern(w), r) for w, r in corrections.items() if w.strip()]
    changed = 0
    for seg in segments:
        new = seg["text"]
        for p, right in pats:
            new = p.sub(lambda m: m.group(1) + right, new)
        if new != seg["text"]:
            seg["text"] = new
            changed += 1
        for w in seg.get("words") or []:
            for p, right in pats:
                w["w"] = p.sub(lambda m: m.group(1) + right, w["w"])
    return changed
