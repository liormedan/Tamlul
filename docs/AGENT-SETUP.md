# Run Tamlul from source: instructions for a coding agent

These instructions are for an AI coding agent (Claude Code or similar) helping someone run Tamlul on their own Windows computer from the source code. Follow them step by step.

Tamlul is a Hebrew transcription app. It has three parts:
- a Python FastAPI engine in `app/`;
- a web editor in `app/static/`;
- an optional Tauri desktop window in `src-tauri/`.

Repository: https://github.com/liormedan/Tamlul (public).

## How to work with the user

- Talk to the user in the language they write in (usually Hebrew). Explain each step in a sentence before you run it.
- Ask before installing anything system-wide.
- When a step fails, stop and show the exact error before you try a fix.

## 1. Check the computer

Report what you find:
- Windows 10 or 11, 64-bit, with git installed.
- At least 12GB of free disk space.
- An NVIDIA graphics card (`nvidia-smi`). The app also works without one, on the processor, but transcription is slower.
- Python 3.11 (`py -3.11 --version`).

## 2. Get the code

Clone the repository into a folder the user chooses (suggest `C:\Tamlul`) on the default branch. Before going on, read `README.md` (the "For developers" section) and `install.bat`.

## 3. Set up the engine

Run the same steps as `install.bat`, but run them yourself instead of the script, because it ends with `pause` and would hang. Run every command from the repository root:

1. If Python 3.11 is missing, ask the user first, then run:
   `winget install -e --id Python.Python.3.11 --scope user`
2. `py -3.11 -m venv .venv`
3. `.venv\Scripts\python.exe -m pip install --upgrade pip`
4. `.venv\Scripts\python.exe -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu124`
5. `.venv\Scripts\python.exe -m pip install -r requirements.txt`
6. `.venv\Scripts\python.exe app\setup_models.py` downloads the models and tests the graphics card.

These steps download about 5GB in total and can take 15 to 40 minutes. Run the long steps in the background and tell the user when each one finishes.

## 4. Run the app in the browser

Browser mode needs no Rust or Node:

```
.venv\Scripts\python.exe app\server.py
```

1. The server listens on `http://127.0.0.1:8765` and opens the browser.
2. Confirm that `http://127.0.0.1:8765/api/health` answers, then tell the user the app is ready.
3. Leave the server running.
4. To stop it later, stop only that process.

## 5. Desktop window (only if the user asks)

1. First tell the user what is needed:
   - Node.js LTS;
   - Rust (via rustup);
   - Visual Studio Build Tools with the C++ workload;
   - about 8 minutes for the first build.
2. Run `npm install`, then `cargo build` inside `src-tauri`.
3. Run `src-tauri\target\debug\tamlul.exe` from the repository root. It uses the same `.venv` and models.

## 6. AI assistant (optional)

The assistant inside the app needs an Anthropic API key.
- If the user wants it, copy `.env.example` to `.env` and let the user paste the key into that file themselves.
- Never ask for the key, print it, or read `.env`.

## Rules

- Do not commit, push, or change code or settings in the repository unless the user explicitly asks.
- Do not install anything beyond what is listed here without asking.
- Projects and settings are saved in `data\` inside the repository. Never delete that folder.
- When something fails, show the error and the end of `engine.log` (if it exists) before trying a fix.
