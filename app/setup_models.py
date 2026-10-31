"""Downloads the models once and checks that the NVIDIA card works.

Run by install.bat and by the setup wizard of the Tauri app, which reads the
last line (TAMLUL_RESULT ...) to show where transcription will run.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402

import engine  # noqa: E402

print("\n[1/3] Checking the graphics card...")
info = engine.gpu_info()
if info["cuda"]:
    print("      OK:", info["name"])
else:
    print("      WARNING: NVIDIA card not available to PyTorch. Transcription will run on the CPU (slow).")
    print("      Updating the NVIDIA driver usually fixes this.")

print("\n[2/3] Downloading the Hebrew speech model (about 1.6 GB, once only)...")
model = engine.load_whisper(log=lambda m: print("     ", m))
silence = np.zeros(engine.SAMPLE_RATE * 2, dtype=np.float32)
list(model.transcribe(silence, language="he")[0])
print("      OK, running on:", engine._whisper_device)

print("\n[3/3] Downloading the speaker recognition model...")
try:
    engine.load_speaker_model(log=lambda m: print("     ", m))
    v = engine.embed(np.random.randn(engine.SAMPLE_RATE * 2).astype(np.float32) * 0.1, 0, 2)
    print("      OK" if v is not None else "      WARNING: speaker model returned nothing")
except Exception as e:
    print("      WARNING: speaker recognition is not available:", e)
    print("      Transcription still works; speakers will not be separated automatically.")

print("\nAll set.")
result = {"device": engine._whisper_device, "gpu": info["name"] if info["cuda"] else None}
print("TAMLUL_RESULT " + json.dumps(result), flush=True)
