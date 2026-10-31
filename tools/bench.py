"""
Transcription benchmark: how long one hour of audio takes on this machine.

Runs the real engine (app/engine.py) on a test recording, times each stage and projects the
result to one hour of audio. The numbers set the system requirements and the time estimate
the app shows before a transcription.

  .venv\\Scripts\\python tools\\bench.py                      # GPU if there is one, 10 minutes of audio
  .venv\\Scripts\\python tools\\bench.py --device cpu --minutes 3
  .venv\\Scripts\\python tools\\bench.py --audio talk.mp3 --out bench.json

Without --audio it loops data/test/he_test.m4a up to --minutes. Results are appended to
tools/bench-results.jsonl, one JSON line per run.
"""
import argparse
import json
import os
import platform
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_AUDIO = ROOT / "data" / "test" / "he_test.m4a"
RESULTS = Path(__file__).resolve().parent / "bench-results.jsonl"


def cpu_name():
    if os.name == "nt":
        try:
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            return winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
        except OSError:
            pass
    return platform.processor() or platform.machine()


def ram_gb():
    if os.name == "nt":
        import ctypes

        class MemStatus(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        m = MemStatus()
        m.dwLength = ctypes.sizeof(MemStatus)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        return round(m.ullTotalPhys / 2**30, 1)
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--audio", type=Path, default=DEFAULT_AUDIO)
    ap.add_argument("--minutes", type=float, default=10, help="loop or cut the audio to this length")
    ap.add_argument("--device", choices=["auto", "cpu"], default="auto")
    ap.add_argument("--out", type=Path, help="also write this run's result to a JSON file")
    args = ap.parse_args()

    if args.device == "cpu":
        os.environ["CUDA_VISIBLE_DEVICES"] = ""  # whisper falls back to CPU, torch sees no GPU
    sys.path.insert(0, str(ROOT / "app"))
    import numpy as np
    import engine

    log = lambda msg: print("  ·", msg, flush=True)  # noqa: E731
    stages = {}

    t = time.perf_counter()
    audio = engine.load_audio(args.audio)
    want = int(args.minutes * 60 * engine.SAMPLE_RATE)
    if len(audio) < want:
        audio = np.tile(audio, -(-want // len(audio)))
    audio = audio[:want]
    seconds = len(audio) / engine.SAMPLE_RATE
    stages["decode"] = time.perf_counter() - t
    print(f"audio: {args.audio.name}, {seconds / 60:.1f} min", flush=True)

    t = time.perf_counter()
    if args.device == "cpu":
        # CTranslate2 still finds the GPU when CUDA_VISIBLE_DEVICES is empty, so load the CPU model
        # the way engine.load_whisper does after a GPU failure
        from faster_whisper import WhisperModel
        engine._whisper = WhisperModel(engine.WHISPER_MODEL, device="cpu", compute_type="int8",
                                       download_root=str(engine.MODELS_DIR / "whisper"))
        engine._whisper_device = "cpu"
    else:
        engine.load_whisper(log)
    stages["load_whisper"] = time.perf_counter() - t

    t = time.perf_counter()
    last = [0.0]

    def progress(f):
        if f - last[0] >= 0.1:
            last[0] = f
            print(f"  transcribe {f:4.0%}  {time.perf_counter() - t:6.1f}s", flush=True)

    segments = engine.transcribe(None, audio=audio, progress=progress, log=log)
    stages["transcribe"] = time.perf_counter() - t

    t = time.perf_counter()
    engine.load_speaker_model(log)
    stages["load_speakers"] = time.perf_counter() - t

    t = time.perf_counter()
    engine.assign_speakers(segments, audio, {}, log=log)
    stages["speakers"] = time.perf_counter() - t

    work = stages["transcribe"] + stages["speakers"]
    gpu = None
    try:
        import torch
        if torch.cuda.is_available():
            gpu = torch.cuda.get_device_name(0)
    except Exception:  # noqa: BLE001 - torch is optional for the report
        pass
    result = {
        "when": time.strftime("%Y-%m-%d %H:%M"),
        "device": engine._whisper_device,
        "gpu": gpu,
        "cpu": cpu_name(),
        "cores": os.cpu_count(),
        "ram_gb": ram_gb(),
        "audio_min": round(seconds / 60, 2),
        "segments": len(segments),
        "stages_s": {k: round(v, 1) for k, v in stages.items()},
        "realtime_factor": round(work / seconds, 3),
        "per_audio_hour_min": round(work / seconds * 60, 1),
    }

    print()
    print(f"device       {result['device']}  ({gpu or result['cpu']})")
    for k, v in result["stages_s"].items():
        print(f"{k:<13}{v:8.1f}s")
    print(f"realtime     x{result['realtime_factor']}  (processing / audio length)")
    print(f"1 hour audio ≈ {result['per_audio_hour_min']} min, plus {stages['load_whisper'] + stages['load_speakers']:.0f}s to load the models")

    with RESULTS.open("a", encoding="utf-8") as f:
        f.write(json.dumps(result, ensure_ascii=False) + "\n")
    if args.out:
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
