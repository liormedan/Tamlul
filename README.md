# תמלול בעברית

תוכנה שרצה על המחשב שלך (Windows + כרטיס NVIDIA) ומתמללת וידאו והקלטות בעברית:
זיהוי דוברים, מילים מיוחדות, מילון תיקונים, עריכת זמנים על גל הסאונד, וחיתוך הפסקות וקטעים שגויים.
שום קובץ לא נשלח לאינטרנט – הכל נשאר במחשב.

## התקנה (פעם אחת)

1. לחיצה כפולה על **Tamlul_0.1.0_x64-setup.exe**. לא צריך הרשאות מנהל.
2. פותחים את **Tamlul** מתפריט התחל או משולחן העבודה.
3. בפתיחה הראשונה נפתח חלון "התקנה ראשונה": לוחצים **התחל התקנה**. התוכנה מורידה את מנוע התמלול (בערך 5GB, בין 10 ל־40 דקות) ומראה את ההתקדמות. בסוף היא בודקת את כרטיס המסך ואומרת אם התמלול ירוץ עליו.

אם ההורדה נעצרת, "נסה שוב" ממשיך מאותה נקודה. אם משהו נכשל – "הצג פרטים" מראה מה קרה, ואפשר לצלם ולשלוח ל־Claude.

הדרך הישנה עדיין עובדת: **install.bat** בתיקיית הקוד, ואז קיצור הדרך שהוא יוצר.

## הפעלה

**Tamlul** מתפריט התחל או משולחן העבודה. התוכנה נפתחת בחלון משלה.
לסיום עבודה – סוגרים את החלון.

אם מנוע התמלול נסגר או לא עולה, החלון מציע להפעיל אותו מחדש ולהציג את היומן. היומן נמצא גם ב**הגדרות ← מנוע התמלול**.

### הסרה
"הסרת התקנה" של Tamlul בהגדרות של Windows. הפרויקטים, ההגדרות ומנוע התמלול שהורד נשארים, אלא אם מסמנים "מחק גם את הפרויקטים, ההגדרות ומנוע התמלול שהורד". עדכון לגרסה חדשה לא נוגע בהם.

## עבודה

### פרויקט חדש
- **בחר קובץ** – הווידאו או ההקלטה.
- **ערוצי אודיו נפרדים** (לא חובה) – אם בזום סימנת "הקלט קובץ אודיו נפרד לכל משתתף", מוסיפים כאן את הקבצים וכותבים ליד כל אחד את שם הדובר. כך זיהוי הדוברים מדויק לגמרי.
- **התחל תמלול**. בפעם הראשונה לוקח עוד כמה דקות לטעון את המודל.

### העורך
| מה רוצים | איך עושים |
|---|---|
| לנגן / לעצור | מקש רווח, או ▶ |
| לתקן טקסט | לוחצים על המשפט ומקלידים. כשמחליפים מילה, התוכנה שואלת אם לתקן אותה מעכשיו תמיד |
| להחליף דובר | לוחצים על השם הצבעוני שליד המשפט |
| לכוון זמנים | גוררים את קצוות הבלוק הצבעוני על גל הסאונד, או מקלידים זמן בתיבות |
| לקבוע התחלה / סוף לפי הניגון | עוצרים את הניגון בנקודה המדויקת ולוחצים "⏱ התחלה" או "⏱ סוף" בשורה (או המקשים ‎[‎ ו־‎]‎ על המשפט המסומן) |
| לחפש מילה | תיבת החיפוש (Ctrl+F). Enter = התוצאה הבאה, Shift+Enter = הקודמת, או החצים ▲▼ |
| להחליף מילה | "⇄ החלפה" (Ctrl+H): כותבים מילה חלופית, ואז "החלף" לתוצאה המסומנת או "החלף הכל". אחרי "החלף הכל" אפשר ללחוץ "תקן תמיד" |
| למחוק משפט (גם מהווידאו) | ✂ ליד המשפט, או מקש Delete |
| לפצל משפט | עומדים עם הניגון במקום הפיצול ולוחצים ⑂ |
| לחבר משפט לבא אחריו | ⤓ |
| לקצר הפסקות ארוכות | "קצר הפסקות" – הקטעים שיימחקו מסומנים באדום |
| לסמן אממ / אהה | "מילות מילוי" |
| לחתוך קטע ידנית | "חיתוך ידני" ואז גוררים על גל הסאונד העליון |
| לבטל חיתוך | לחיצה כפולה על הקטע האדום |
| לשמוע את התוצאה לפני ייצוא | מסמנים "השמע בלי החיתוכים" |
| לבטל פעולה | "בטל" או Ctrl+Z |

השמירה אוטומטית.

### דוברים
כפתור **דוברים**: משנים "דובר 1" לשם אמיתי, ולוחצים **זכור קול**. בהקלטות הבאות התוכנה תזהה את האדם הזה לבד בשמו.

### הגדרות
- **מילים מיוחדות** – שמות ומונחים (למשל Meida4U) כדי שיזוהו נכון.
- **מילון תיקונים** – מילה שהתוכנה טועה בה תמיד, ומה צריך לכתוב במקומה.
- רגישות זיהוי דוברים, אורך הפסקה לקיצור, ואפשרויות לכתוביות.

### ✨ עוזר AI
לשונית **עוזר AI** בעורך (ליד "תמלול") קוראת את התמלול בעזרת Claude:
- כפתורים מוכנים: **סיכום**, **פרקים ליוטיוב**, **נקודות עיקריות**, **ציטוטים לרשתות**, **כותרת ותיאור**, **מי הדוברים**.
- אפשר לשאול כל שאלה על ההקלטה ולהמשיך לשאול שאלות המשך.
- לחיצה על זמן בתשובה מקפיצה את הווידאו לאותו רגע. כשיש חיתוכים, הזמנים יכולים להיות לפי הגרסה הערוכה – כך הפרקים מתאימים לווידאו שמעלים ליוטיוב.
- 📋 מעתיק את התשובה, 💾 שומר אותה לקובץ בתיקיית הייצוא. השיחה נשמרת בפרויקט.

**הגדרה (פעם אחת):** פותחים חשבון מפתחים של Claude, יוצרים מפתח API, טוענים קרדיט, ומדביקים את המפתח באחת משתי הדרכים:
- בקובץ **‎.env** שבתיקיית הנתונים (**הגדרות ← תיקיית הנתונים ← פתח**): לחיצה ימנית ← "פתח באמצעות" ← פנקס רשימות, להדביק אחרי `ANTHROPIC_API_KEY=` ולשמור.
- או בלשונית העוזר / ב**הגדרות ← עוזר AI**.

מפתח בקובץ ‎.env קודם למפתח שהוזן בתוכנה. **לא לשלוח את הקובץ ‎.env לאף אחד** – מי שיש לו את המפתח משתמש בקרדיט שלך. שם גם בוחרים מודל (Sonnet מומלץ לעברית) ורואים הערכה של ההוצאה. התשלום הוא לפי שימוש – בדרך כלל אגורות לפרק. הסכום המדויק מופיע בעמוד החיוב באתר של Claude.

### ייצוא
- **וידאו ערוך** – בלי כל מה שסומן באדום ובלי המשפטים שנמחקו, יחד עם קובץ כתוביות מתאים.
- **כתוביות SRT**, **Word**, **טקסט**.
הקבצים נשמרים בתיקייה `exports` שבתיקיית הנתונים (כפתור "פתח את תיקיית הייצוא").

---

## למפתחים (For developers)

- `src-tauri/` – Tauri 2 shell (branch `tauri`, in progress). The UI in `app/static` is the Tauri frontend (served from `http://tauri.localhost`); on startup it picks a free port and a random per-launch token, launches `.venv\Scripts\python.exe app\server.py` with `TAMLUL_PORT` and `TAMLUL_TOKEN` (stdout/stderr → `data/engine.log`), and puts itself in a Windows job object so the engine dies with the window, also on a crash. The page gets the port and token from the `engine_info` command, waits for `GET /api/health` (`waitForEngine` in `app.js`), and sends the token as `X-Tamlul-Token` on every call (`?t=` on media URLs, since `<video src>` cannot send headers). CORS allows the Tauri origin only, and the window's CSP limits connections and media to `127.0.0.1`. File dialogs via `tauri-plugin-dialog`, external links via `tauri-plugin-opener`.
  - Attach to an engine you started yourself: set `TAMLUL_PORT` (and `TAMLUL_TOKEN` if you gave it one) before starting the exe.
  - User data: a release build keeps projects, settings, voice prints, `.env`, exports and `engine.log` in `%LOCALAPPDATA%\com.liormedan.tamlul` (the app identifier; passed to the engine as `TAMLUL_DATA`). The installer puts the program in `%LOCALAPPDATA%\Tamlul`, so the two never mix; updating never touches the data, and the uninstaller deletes it only when "delete app data" is ticked. On first run the engine copies an old `data\` and `.env` found next to the program, writes `migrated_from.txt` there and `MOVED.txt` in the old folder, and leaves the old copy as a backup (exports are not copied). A debug build keeps the repo's `data\`, `exports\` and `.env`. Setting `TAMLUL_DATA` overrides both.
  - Python runtime: if the code folder has a `.venv` (development, or an `install.bat` setup), the engine runs from it with `models\` next to it. Otherwise (the installed app) it lives in `<data>\runtime` (`python\`, `venv\`, `models\`, `setup.log`, `ready.json`), and until `ready.json` exists the window opens `setup.html` instead of the editor. The wizard (`src-tauri/src/setup.rs`) runs the bundled `uv.exe`: `uv python install 3.11 --no-bin --no-registry`, `uv venv`, torch 2.5.1 from the cu124 index, `requirements.txt`, then `app/setup_models.py` with `TAMLUL_MODELS` (downloads the models, tests the GPU and prints `TAMLUL_RESULT {...}`). Steps are idempotent, so "try again" reruns them all; the uv cache in `runtime\cache` is deleted only after success. `TAMLUL_RUNTIME` overrides the folder, `TAMLUL_UV` the uv binary.
  - Installer: `npx tauri build` (with `CARGO_BUILD_JOBS=2` on a machine short of memory) → `src-tauri\target\release\bundle\nsis\Tamlul_<version>_x64-setup.exe`. Per-user NSIS, Hebrew and English (`src-tauri/nsis/Hebrew.nsh` translates Tauri's own strings; keep it UTF-8 without BOM). It ships `tamlul.exe`, the engine's `.py` files, `app/static`, `requirements.txt`, `.env.example` and `uv.exe` (`bundle.resources`). `src-tauri/fetch-uv.ps1` runs before bundling and downloads the pinned uv release into `src-tauri\bin` (git-ignored), checking its SHA-256. A release exe in `target\release` behaves like an installed copy (the build copies the resources next to it); a debug build always uses the repo.
  - Icons: `src-tauri/icons/source.svg` → render to a 1024px PNG (for example headless Edge `--screenshot`) → `npx tauri icon <png>`. Not code-signed yet, so SmartScreen warns on first run.
  - The shell keeps the engine's process handle. When the engine exits on its own it emits `engine-exited` and the window offers a restart and the log. `restart_engine` kills the whole engine tree (the venv `python.exe` is a launcher with a child) and starts a new one on a new port. `engine_log` returns the tail of `engine.log` in the data folder, also shown under Settings. Only one copy runs (`tauri-plugin-single-instance`); a second launch focuses the existing window.
  - Build: `npm install`, then `cd src-tauri && cargo build` (first build ~8 min) → `src-tauri\target\debug\tamlul.exe`. Frontend files are embedded at build time, so rebuild after editing `app/static`.
  - Inspect the page: set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` before starting the exe.
- `app/desktop.py` – desktop entry point: runs the server in a thread and opens it in a pywebview window (WebView2 / Edge engine, so H.264 and AAC play natively). Native file dialogs via `server.PICK_HOOK`; closing the window stops the server. `start.bat` launches it with `pythonw`, output goes to `data/desktop.log`. `TAMLUL_DEBUG=1` opens devtools.
- `app/server.py` – FastAPI server on `127.0.0.1` (`TAMLUL_PORT`, default 8765), background jobs. With `TAMLUL_TOKEN` set, every `/api` route except `/api/health` requires the token; without it (browser mode, pywebview) nothing changes. Also: file picker (tkinter fallback when run without the desktop window), ranged media streaming. `python app\server.py` still works on its own and opens the browser.
- `app/engine.py` – models in `models\` next to the code, or `TAMLUL_MODELS`. faster-whisper with `ivrit-ai/whisper-large-v3-turbo-ct2` (CUDA float16, CPU int8 fallback), hotwords for vocabulary, SpeechBrain ECAPA voice prints for speaker clustering and enrollment (`data/speakers.json`), correction dictionary (keeps Hebrew prefixes ו/ה/ב/ל/מ/ש/כ).
- `app/media.py` – ffmpeg (imageio-ffmpeg) for waveform peaks, decoding, silence/filler suggestions, and cut export via `select/aselect` with `fps` normalisation; tries `h264_nvenc`, falls back to `libx264`.
- `app/exporters.py` – SRT / DOCX (RTL) / TXT.
- `app/ai.py` – Claude Messages API (stdlib urllib, SSE streaming), transcript in a cached system block (`cache_control: ephemeral`) so follow-ups are cheap; key stored in `data/ai.json` and never sent to the browser; `TAMLUL_AI_URL` overrides the endpoint for testing. Chat history in `project.json` → `ai_chat`.
- `app/static/` – vanilla JS editor using wavesurfer.js 7 (regions + timeline plugins, vendored).
- Data: `data/projects/<id>/project.json` (segments with word timings, cuts), `data/settings.json`.
- Test mode without GPU/models: `set TAMLUL_FAKE=1` then `python app\server.py` (fake sentences on loud regions).
- Pinned stack: Python 3.11, torch 2.5.1+cu124 (its bundled cuDNN 9 / cuBLAS DLLs are added to the DLL path for CTranslate2 4.5).
