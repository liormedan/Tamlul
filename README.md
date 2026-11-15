# Tamlul: Hebrew transcription

Software that runs on your computer (Windows + an NVIDIA card) and transcribes Hebrew video and recordings:
speaker identification, special words, a corrections dictionary, timing editing on the waveform, and cutting pauses and bad takes.
No file is sent to the internet – everything stays on the computer.

## Installation (one time)

1. Double-click **Tamlul_0.1.0_x64-setup.exe**. No administrator privileges are needed.
2. Open **Tamlul** from the Start menu or the desktop.
3. On the first launch a "First-time setup" window opens: click **Start setup**. The software downloads the transcription engine (about 5GB, between 10 and 40 minutes) and shows the progress. At the end it checks the graphics card and says whether transcription will run on it.

If the download stops, "Try again" continues from the same point. If something fails – "Show details" shows what happened, and you can take a screenshot and send it to Claude.

## Launching

**Tamlul** from the Start menu or the desktop. The software opens in its own window.
To finish working – close the window.

If the transcription engine closes or does not start, the window offers to restart it and to show the log. The log is also in **Settings → Transcription engine**.

### Uninstalling
"Uninstall" for Tamlul in the Windows settings. The projects, the settings and the downloaded transcription engine remain, unless you check "Also delete the projects, the settings and the downloaded transcription engine". Updating to a new version does not touch them.

## Working

### New project
- **Choose file** – the video or the recording.
- **Separate audio channels** (optional) – if in Zoom you checked "Record a separate audio file for each participant", add the files here and write the speaker's name next to each one. This makes speaker identification completely accurate.
- **Start transcription**. The first time, it takes a few more minutes to load the model.

### The editor
| What you want | How to do it |
|---|---|
| Play / pause | Space bar, or ▶ |
| Fix text | Click the sentence and type. When you replace a word, the software asks whether to always correct it from now on |
| Change speaker | Click the colored name next to the sentence |
| Adjust timings | Drag the edges of the colored block on the waveform, or type a time in the boxes |
| Set start / end from playback | Stop playback at the exact point and click "⏱ Start" or "⏱ End" on the row (or the keys ‎[‎ and ‎]‎ on the selected sentence) |
| Search for a word | The search box (Ctrl+F). Enter = next result, Shift+Enter = previous, or the arrows ▲▼ |
| Replace a word | "⇄ Replace" (Ctrl+H): type a replacement word, then "Replace" for the highlighted result or "Replace all". After "Replace all" you can click "Always correct" |
| Delete a sentence (from the video too) | ✂ next to the sentence, or the Delete key |
| Split a sentence | Stop playback at the split point and click ⑂ |
| Join a sentence to the next one | ⤓ |
| Shorten long pauses | "Shorten pauses" – the sections to be deleted are marked in red |
| Mark umm / uhh | "Filler words" |
| Cut a section manually | "Manual cut", then drag on the upper waveform |
| Undo a cut | Double-click the red section |
| Hear the result before exporting | Check "Play without the cuts" |
| Undo an action | "Undo" or Ctrl+Z |

Saving is automatic.

### Speakers
The **Speakers** button: change "Speaker 1" to a real name, and click **Remember voice**. In future recordings the software will recognize this person by name on its own.

### Settings
- **Special words** – names and terms (for example Meida4U) so they are recognized correctly.
- **Corrections dictionary** – a word the software always gets wrong, and what should be written instead.
- Speaker identification sensitivity, pause length for shortening, and subtitle options.

### ✨ AI assistant
The **AI assistant** tab in the editor (next to "Transcription") reads the transcript with Claude:
- Ready-made buttons: **Summary**, **YouTube chapters**, **Key points**, **Quotes for social media**, **Title and description**, **Who are the speakers**.
- You can ask any question about the recording and keep asking follow-up questions.
- Clicking a time in the answer jumps the video to that moment. When there are cuts, the times can follow the edited version – so the chapters match the video you upload to YouTube.
- 📋 copies the answer, 💾 saves it to a file in the export folder. The conversation is saved in the project.

**Setup (one time):** open a Claude developer account, create an API key, load credit, and paste the key in one of two ways:
- In the **‎.env** file in the data folder (**Settings → Data folder → Open**): right-click → "Open with" → Notepad, paste after `ANTHROPIC_API_KEY=` and save.
- Or in the assistant tab / in **Settings → AI assistant**.

A key in the ‎.env file takes precedence over a key entered in the software. **Do not send the ‎.env file to anyone** – whoever has the key uses your credit. That is also where you choose a model (Sonnet is recommended for Hebrew) and see an estimate of the cost. Payment is by usage – usually agorot (cents) per episode. The exact amount appears on the billing page on Claude's website.

### Export
- **Edited video** – without everything marked in red and without the deleted sentences, together with a matching subtitle file.
- **SRT subtitles**, **Word**, **Text**.
The files are saved in the `exports` folder in the data folder (the "Open the export folder" button).

---

## For developers

- Running from source with a coding agent: [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md).
- Getting started: `install.bat` builds `.venv` (Python 3.11, torch cu124, `requirements.txt`) and `models\` in the repo. Then `npm install` and `cd src-tauri && cargo build` (first build ~8 min) → `src-tauri\target\debug\tamlul.exe`, run from the repo root (or set `TAMLUL_HOME`). Frontend files are embedded at build time, so rebuild after editing `app/static`. Without a `.venv`, a debug build opens the setup wizard and builds its runtime in the repo's `data\runtime` instead (it needs `src-tauri\bin\uv.exe` from `fetch-uv.ps1`, or uv on `PATH`).
- `src-tauri/` – Tauri 2 shell. The UI in `app/static` is the Tauri frontend (served from `http://tauri.localhost`); on startup it picks a free port and a random per-launch token, launches `app\server.py` with the engine's Python (see "Python runtime") and `TAMLUL_PORT` and `TAMLUL_TOKEN` (stdout/stderr → `engine.log` in the data folder), and puts itself in a Windows job object so the engine dies with the window, also on a crash. The page gets the port and token from the `engine_info` command, waits for `GET /api/health` (`waitForEngine` in `app.js`), and sends the token as `X-Tamlul-Token` on every call (`?t=` on media URLs, since `<video src>` cannot send headers). CORS allows the Tauri origin only, and the window's CSP limits connections and media to `127.0.0.1`. File dialogs via `tauri-plugin-dialog`, external links via `tauri-plugin-opener`.
  - Attach to an engine you started yourself: set `TAMLUL_PORT` (and `TAMLUL_TOKEN` if you gave it one) before starting the exe.
  - User data: a release build keeps projects, settings, voice prints, `.env`, exports and `engine.log` in `%LOCALAPPDATA%\com.liormedan.tamlul` (the app identifier; passed to the engine as `TAMLUL_DATA`). The installer puts the program in `%LOCALAPPDATA%\Tamlul`, so the two never mix; updating never touches the data, and the uninstaller deletes it only when "delete app data" is ticked. On first run the engine copies an old `data\` and `.env` found next to the program, writes `migrated_from.txt` there and `MOVED.txt` in the old folder, and leaves the old copy as a backup (exports are not copied). A debug build keeps the repo's `data\`, `exports\` and `.env`. Setting `TAMLUL_DATA` overrides both.
  - Python runtime: if the code folder has a `.venv` (development, or an `install.bat` setup), the engine runs from it with `models\` next to it. Otherwise (the installed app) it lives in `<data>\runtime` (`python\`, `venv\`, `models\`, `setup.log`, `ready.json`), and until `ready.json` exists the window opens `setup.html` instead of the editor. The wizard (`src-tauri/src/setup.rs`) runs the bundled `uv.exe`: `uv python install 3.11 --no-bin --no-registry`, `uv venv`, torch 2.5.1 from the cu124 index, `requirements.txt`, then `app/setup_models.py` with `TAMLUL_MODELS` (downloads the models, tests the GPU and prints `TAMLUL_RESULT {...}`). Steps are idempotent, so "try again" reruns them all; the uv cache in `runtime\cache` is deleted only after success. `TAMLUL_RUNTIME` overrides the folder, `TAMLUL_UV` the uv binary.
  - Installer: `npx tauri build` (with `CARGO_BUILD_JOBS=2` on a machine short of memory) → `src-tauri\target\release\bundle\nsis\Tamlul_<version>_x64-setup.exe`. Per-user NSIS, Hebrew and English (`src-tauri/nsis/Hebrew.nsh` translates Tauri's own strings; keep it UTF-8 without BOM). It ships `tamlul.exe`, the engine's `.py` files, `app/static`, `requirements.txt`, `.env.example` and `uv.exe` (`bundle.resources`). `src-tauri/fetch-uv.ps1` runs before bundling and downloads the pinned uv release into `src-tauri\bin` (git-ignored), checking its SHA-256. A release exe in `target\release` behaves like an installed copy (the build copies the resources next to it); a debug build always uses the repo.
  - Icons: `src-tauri/icons/source.svg` → render to a 1024px PNG (for example headless Edge `--screenshot`) → `npx tauri icon <png>`. Not code-signed yet, so SmartScreen warns on first run.
  - The shell keeps the engine's process handle. When the engine exits on its own it emits `engine-exited` and the window offers a restart and the log. `restart_engine` kills the whole engine tree (the venv `python.exe` is a launcher with a child) and starts a new one on a new port. `engine_log` returns the tail of `engine.log` in the data folder, also shown under Settings. Only one copy runs (`tauri-plugin-single-instance`); a second launch focuses the existing window.
  - Inspect the page: set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` before starting the exe. WebView2 is the Edge engine, so H.264 and AAC play natively.
- `app/server.py` – FastAPI server on `127.0.0.1` (`TAMLUL_PORT`, default 8765), background jobs. With `TAMLUL_TOKEN` set, every `/api` route except `/api/health` requires the token; without it (browser mode) nothing changes. Also: a tkinter file picker for browser mode, ranged media streaming. `.venv\Scripts\python.exe app\server.py` works on its own and opens the browser.
- `app/engine.py` – models in `models\` next to the code, or `TAMLUL_MODELS`. faster-whisper with `ivrit-ai/whisper-large-v3-turbo-ct2` (CUDA float16, CPU int8 fallback), hotwords for vocabulary, SpeechBrain ECAPA voice prints for speaker clustering and enrollment (`data/speakers.json`), correction dictionary.
- `app/media.py` – ffmpeg (imageio-ffmpeg) for waveform peaks, decoding, silence/filler suggestions, and cut export via `select/aselect` with `fps` normalisation; tries `h264_nvenc`, falls back to `libx264`.
- `app/exporters.py` – SRT / DOCX (RTL) / TXT.
- `app/ai.py` – Claude Messages API (stdlib urllib, SSE streaming), transcript in a cached system block (`cache_control: ephemeral`) so follow-ups are cheap; key stored in `data/ai.json` and never sent to the browser; `TAMLUL_AI_URL` overrides the endpoint for testing. Chat history in `project.json` → `ai_chat`.
- `app/static/` – vanilla JS editor using wavesurfer.js 7 (regions + timeline plugins, vendored).
- Data: `data/projects/<id>/project.json` (segments with word timings, cuts), `data/settings.json`.
- Test mode without GPU/models: `set TAMLUL_FAKE=1` then `python app\server.py` (fake sentences on loud regions).
- Pinned stack: Python 3.11, torch 2.5.1+cu124 (its bundled cuDNN 9 / cuBLAS DLLs are added to the DLL path for CTranslate2 4.5).
