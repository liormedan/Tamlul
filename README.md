# תמלול בעברית

תוכנה שרצה על המחשב שלך (Windows + כרטיס NVIDIA) ומתמללת וידאו והקלטות בעברית:
זיהוי דוברים, מילים מיוחדות, מילון תיקונים, עריכת זמנים על גל הסאונד, וחיתוך הפסקות וקטעים שגויים.
שום קובץ לא נשלח לאינטרנט – הכל נשאר במחשב.

## התקנה (פעם אחת)

1. לחיצה כפולה על **install.bat**.
2. מחכים עד שמופיע "Installation finished" (בין רבע שעה ל־40 דקות, יורדים בערך 5GB).
3. על שולחן העבודה יופיע קיצור דרך בשם **Tamlul**.

אם משהו נכשל – לצלם את החלון השחור ולשלוח ל־Claude.

## הפעלה

לחיצה כפולה על **Tamlul** בשולחן העבודה. התוכנה נפתחת בחלון משלה.
לסיום עבודה – סוגרים את החלון.

אם החלון לא נפתח, ההודעה המלאה נמצאת בקובץ `data\desktop.log` – לשלוח אותו ל־Claude.

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
- בקובץ **‎.env** שבתיקיית התוכנה: לחיצה ימנית ← "פתח באמצעות" ← פנקס רשימות, להדביק אחרי `ANTHROPIC_API_KEY=` ולשמור. (גם בתפריט התחל: Tamlul ← "מפתח AI").
- או בלשונית העוזר / ב**הגדרות ← עוזר AI**.

מפתח בקובץ ‎.env קודם למפתח שהוזן בתוכנה. **לא לשלוח את הקובץ ‎.env לאף אחד** – מי שיש לו את המפתח משתמש בקרדיט שלך. שם גם בוחרים מודל (Sonnet מומלץ לעברית) ורואים הערכה של ההוצאה. התשלום הוא לפי שימוש – בדרך כלל אגורות לפרק. הסכום המדויק מופיע בעמוד החיוב באתר של Claude.

### ייצוא
- **וידאו ערוך** – בלי כל מה שסומן באדום ובלי המשפטים שנמחקו, יחד עם קובץ כתוביות מתאים.
- **כתוביות SRT**, **Word**, **טקסט**.
הקבצים נשמרים בתיקייה `exports` בתוך תיקיית התוכנה (כפתור "פתח את תיקיית הייצוא").

---

## למפתחים (For developers)

- `src-tauri/` – Tauri 2 shell (branch `tauri`, in progress). The UI in `app/static` is the Tauri frontend (served from `http://tauri.localhost`); on startup it launches `.venv\Scripts\python.exe app\server.py` (stdout/stderr → `data/engine.log`) unless port 8765 is already taken, and puts itself in a Windows job object so the engine dies with the window, also on a crash. The page waits for the engine (`waitForEngine` in `app.js`) and talks to it at `http://127.0.0.1:8765` (CORS allows the Tauri origin only). File dialogs via `tauri-plugin-dialog`, external links via `tauri-plugin-opener`.
  - Build: `npm install`, then `cd src-tauri && cargo build` (first build ~8 min) → `src-tauri\target\debug\tamlul.exe`. Frontend files are embedded at build time, so rebuild after editing `app/static`.
  - Inspect the page: set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` before starting the exe.
- `app/desktop.py` – desktop entry point: runs the server in a thread and opens it in a pywebview window (WebView2 / Edge engine, so H.264 and AAC play natively). Native file dialogs via `server.PICK_HOOK`; closing the window stops the server. `start.bat` launches it with `pythonw`, output goes to `data/desktop.log`. `TAMLUL_DEBUG=1` opens devtools.
- `app/server.py` – FastAPI server on `127.0.0.1:8765`, background jobs, file picker (tkinter fallback when run without the desktop window), ranged media streaming. `python app\server.py` still works on its own and opens the browser.
- `app/engine.py` – faster-whisper with `ivrit-ai/whisper-large-v3-turbo-ct2` (CUDA float16, CPU int8 fallback), hotwords for vocabulary, SpeechBrain ECAPA voice prints for speaker clustering and enrollment (`data/speakers.json`), correction dictionary (keeps Hebrew prefixes ו/ה/ב/ל/מ/ש/כ).
- `app/media.py` – ffmpeg (imageio-ffmpeg) for waveform peaks, decoding, silence/filler suggestions, and cut export via `select/aselect` with `fps` normalisation; tries `h264_nvenc`, falls back to `libx264`.
- `app/exporters.py` – SRT / DOCX (RTL) / TXT.
- `app/ai.py` – Claude Messages API (stdlib urllib, SSE streaming), transcript in a cached system block (`cache_control: ephemeral`) so follow-ups are cheap; key stored in `data/ai.json` and never sent to the browser; `TAMLUL_AI_URL` overrides the endpoint for testing. Chat history in `project.json` → `ai_chat`.
- `installer/tamlul.nsi` – NSIS installer (`makensis installer/tamlul.nsi`), runs `install.bat /auto`.
- `app/static/` – vanilla JS editor using wavesurfer.js 7 (regions + timeline plugins, vendored).
- Data: `data/projects/<id>/project.json` (segments with word timings, cuts), `data/settings.json`.
- Test mode without GPU/models: `set TAMLUL_FAKE=1` then `python app\server.py` (fake sentences on loud regions).
- Pinned stack: Python 3.11, torch 2.5.1+cu124 (its bundled cuDNN 9 / cuBLAS DLLs are added to the DLL path for CTranslate2 4.5).
