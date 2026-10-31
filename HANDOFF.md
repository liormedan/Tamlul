# העברה לסוכן הבא — Tamlul

עודכן: 2026-10-30 (שישי). נכתב בסוף סשן במחשב הראשון; העבודה ממשיכה במחשב אחר.

## מה זה

תוכנת תמלול עברית שרצה מקומית על Windows: מנוע בפייתון (FastAPI + faster-whisper + SpeechBrain) וממשק JS בלי בנדלר. התיאור המלא, כולל סעיף המפתחים, ב-`README.md`.

## מצב ה-git

| ענף | קומיט אחרון | מה יש בו |
|---|---|---|
| `main` | `4949b04` | הקוד המקורי מהדרייב + חלון דסקטופ ב-pywebview (`app/desktop.py`, `start.bat`) |
| `tauri` | הקומיט של הקובץ הזה, מעל `c654a6b` | מעטפת Tauri 2 סביב המנוע. **הענף הפעיל.** לא מוזג ל-`main`, אין PR |

מאגר פרטי: `https://github.com/liormedan/Tamlul`.

## מה לא נמצא ב-git — צריך להשיג במחשב החדש

| מה | גודל | איך משיגים |
|---|---|---|
| `.venv/` | ~5GB | `install.bat` בונה אותה (Python 3.11 + torch cu124 + `requirements.txt`). אם מעתיקים מהמחשב הקודם — לתקן את `.venv/pyvenv.cfg` שיצביע על Python 3.11.9 המקומי (כך תוקן כאן: הוא הצביע על משתמש `medan` במחשב אחר) |
| `models/` | ~1.7GB | `install.bat` מוריד אותם (`app/setup_models.py`), או מעתיקים |
| `.env` | — | נוצר מ-`.env.example` בהפעלה הראשונה. מפתח ה-API של Claude מדביקים ידנית. **לא להעביר דרך git** |
| `data/` | — | פרויקטים, טביעות קול, הגדרות, `data/ai.json` (מכיל מפתח API). נוצר ריק לבד |
| `node_modules/`, `src-tauri/target/` | — | `npm install`, ואז `cargo build` |

כלים נדרשים לענף `tauri`: Rust (נבדק עם 1.97), Node 22, Visual Studio Build Tools עם C++, WebView2 Runtime.

## הפעלה

```bash
npm install
cd src-tauri && cargo build
```
בנייה ראשונה ~8 דקות, חוזרת ~30 שניות. קבצי `app/static` נטמעים בזמן הבנייה — **לבנות מחדש אחרי כל שינוי בממשק**.

```bash
./src-tauri/target/debug/tamlul.exe
```
הפעלה מתוך שורש המאגר. אחרת מגדירים `TAMLUL_HOME` לשורש.

בלי טאורי:
- `start.bat` — חלון pywebview.
- `.venv\Scripts\python.exe app\server.py` — דפדפן.
- `TAMLUL_FAKE=1` — בלי מודלים, משפטים מזויפים. מתאים לפיתוח ממשק.

## הארכיטקטורה בענף `tauri`

- `src-tauri/src/lib.rs` — בעלייה בוחר פורט פנוי וטוקן אקראי, ומפעיל `.venv\Scripts\python.exe app\server.py` עם `TAMLUL_PORT` ו-`TAMLUL_TOKEN` (פלט ל-`data/engine.log`). הפקודה `engine_info` מחזירה לממשק פורט, טוקן ושגיאת הפעלה אם הייתה. אם `TAMLUL_PORT` מוגדר לפני ההפעלה, מתחבר למנוע קיים במקום להפעיל חדש. מחזיק את ה-Child של המנוע: thread שבודק כל חצי שנייה ושולח `engine-exited` כשהמנוע נסגר מעצמו, `restart_engine` שהורג את כל עץ התהליכים (taskkill /T) ומפעיל מנוע חדש בפורט חדש, ו-`engine_log` שמחזיר את סוף `data/engine.log`. `tauri-plugin-single-instance` רשום ראשון, כך שהפעלה שנייה יוצאת לפני שהיא מפעילה מנוע. מכניס את עצמו ל-Windows job object עם `KILL_ON_JOB_CLOSE`: ה-python של ה-venv הוא משגר שמריץ python שני, ובלי ה-job התהליך השני נשאר יתום.
- `app/static/app.js` — `connectEngine()` קורא ל-`engine_info` וממלא את `API` ו-`TOKEN`. בדפדפן הכתובות יחסיות ואין טוקן. `authHeaders()` מוסיף `X-Tamlul-Token`, ו-`mediaUrl()` מוסיף `?t=` לכתובת הווידאו. `waitForEngine()` בודק `/api/health` ונעצר עם הודעה אם המנוע לא מזהה את הטוקן או נסגר בזמן שעלה. `showEngineProblem()` מציג דיאלוג עם הפעלה מחדש ויומן. `watchJob()` שולח בקשת התקדמות אחת בכל פעם.
- נתוני משתמש — `data_dir()` ב-`lib.rs`: בבניית release הכול ב-`%LOCALAPPDATA%\com.liormedan.tamlul` (המזהה של האפליקציה; עובר למנוע כ-`TAMLUL_DATA`, וגם `engine.log` שם). התוכנה עצמה מותקנת ב-`%LOCALAPPDATA%\Tamlul`, ולכן לא באותה תיקייה. המסיר מוחק את הנתונים רק אם מסמנים "מחק גם את הפרויקטים…". בבניית debug נשאר `data\` של הריפו ולא מועבר `TAMLUL_DATA`. `TAMLUL_DATA` מבחוץ גובר על שניהם. ב-`server.py`, ‏`migrate_legacy_data()` מעתיק פעם אחת את `data\` ו-`.env` שליד התוכנה לתיקייה החדשה, רק אם אין בה נתונים, ומשאיר את הישנה כגיבוי עם `MOVED.txt`. `/api/paths` מחזיר את הנתיבים למסך ההגדרות.
- סביבת הפייתון — אם יש `.venv` ליד הקוד (פיתוח, או `install.bat`), המנוע רץ ממנה. אחרת (גרסה מותקנת) ב-`<data>\runtime`, ועד שיש שם `ready.json` החלון פותח את `setup.html` במקום העורך. האשף ב-`src-tauri/src/setup.rs` מריץ את `uv.exe` המצורף: Python 3.11, ‏venv, ‏torch 2.5.1 cu124, ‏`requirements.txt`, ואז `app/setup_models.py` שמוריד מודלים ובודק כרטיס מסך. ההתקדמות מגיעה לחלון באירוע `setup-progress` ונכתבת ל-`runtime\setup.log`. "נסה שוב" מריץ את כל השלבים מחדש, ושלבים שהסתיימו עוברים מהר.
- מתקין — `npx tauri build` (עם `CARGO_BUILD_JOBS=2`) ← `src-tauri\target\release\bundle\nsis\Tamlul_<version>_x64-setup.exe`. NSIS למשתמש הנוכחי, בעברית (`src-tauri/nsis/Hebrew.nsh`, ‏UTF-8 בלי BOM — עם BOM ה-makensis נכשל). `fetch-uv.ps1` מוריד את uv בגרסה נעולה עם בדיקת SHA-256 ל-`src-tauri\bin` (לא ב-git). exe של release ב-`target\release` מתנהג כמו גרסה מותקנת; debug תמיד מהריפו.
- `app/server.py` — תוצאת תמלול נשמרת ב-`project.json` (`status`: ready / error / cancelled, ו-`error`), כי `JOBS` בזיכרון. פרויקט במצב transcribing בלי עבודה רצה מוחזר כ-`interrupted`. `friendly_error()` הופך שגיאות זיכרון (cuBLAS, mkl_malloc, out of memory) להודעה בעברית. CORS לכתובת `http://tauri.localhost` בלבד. `TokenGuard` (ASGI, לפני CORS) דורש את הטוקן בכל `/api` חוץ מ-`/api/health`, רק כש-`TAMLUL_TOKEN` מוגדר. `/` מפנה ל-`/static/index.html` כי `index.html` עבר לנתיבים יחסיים.
- `src-tauri/tauri.conf.json` — CSP: סקריפטים רק מהאפליקציה, חיבורים ומדיה רק ל-`127.0.0.1`.

## מה נבדק (במחשב הקודם)

- חלון טאורי עולה. המנוע עולה תוך 20–35 שניות וחלון ההמתנה נעלם.
- רשימת פרויקטים, הגדרות, נתוני גל סאונד ו-POST עוברים CORS. כתובת זרה נדחית.
- מדיה נטענת מהמנוע. WebView2 מנגן H.264/AAC — לכן לא Qt: ה-Chromium של PySide6 לא מנגן אותם, זה נבדק ונפסל.
- דיאלוג קבצים נפתח, וביטול מחזיר `[]`.
- סגירה רגילה וגם הריגה בכוח סוגרות את המנוע.
- מצב דפדפן לא נשבר.

## מה פתוח — לפי סדר

1. ~~**תמלול אמיתי בחלון טאורי לא נבדק.**~~ נבדק בשלב 0 על GTX 1660 Ti. הבדיקה נעצרה בגלל זיכרון: במחשב הקודם 7.8GB RAM, MX110 עם 2GB (לא תומך float16 → נפילה ל-CPU int8, איטי). אם למחשב החדש יש כרטיס NVIDIA חזק יותר — לבדוק שם. קובץ בדיקה קצר אפשר ליצור עם קול "Asaf" של Windows (he-IL, ‏OneCore TTS).
2. ~~**מתקין**~~ — נפתר בשלב 4: NSIS של טאורי ואשף התקנה בהפעלה הראשונה. נשאר: חתימת קוד (SmartScreen מזהיר בהפעלה ראשונה).
3. ~~**אייקונים**~~ — נפתר בשלב 4: `src-tauri/icons/source.svg`.
4. ~~**פורט 8765 קבוע**~~ — נפתר בשלב 1: פורט דינמי וטוקן לכל הפעלה.
5. **PR מ-`tauri` ל-`main`** — רק באישור של Lior.
6. **ניקוי:** `app/static/index1.html` נראה שארית. ה-README מזכיר `installer/tamlul.nsi` שלא קיים.
7. **חיסכון בזיכרון (רעיון, לא נבדק):** להחליף את מנוע התמלול ב-whisper.cpp עם מודל מכווץ. צריך לבדוק אם ivrit.ai מפרסמים גרסה כזו ומה המחיר בדיוק.

## עבודה עם Lior

- עונים בעברית, תמציתי, בלי הקדמות. קוד, פקודות ונתיבים באנגלית.
- בדיקה של שינוי UI — בחלון האפליקציה, לא רק בדפדפן.
- **אפליקציה שנפתחת לבדיקה — שקטה.**
- **לא יותר ממופע אחד של אפליקציה כבדה, ולסגור בסוף.**
- בסוף משימה מדווחים: קומיט? דחיפה? לאיזה ענף?

## אזהרות מהסשן הקודם

- **לא לסגור חלונות לפי class בלבד.** `FindWindow("Tauri Window")` תפס אפליקציית טאורי אחרת של Lior (`tree-of-life.exe`). לסגור לפי PID.
- computer-use לא מכיר exe שלא מותקן (`tamlul.exe`). חלופה: `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` לפני ההפעלה, ואז CDP דרך `http://127.0.0.1:9333/json` — לבחור את ה-target שה-URL שלו `tauri.localhost`.
- המחשב הקודם: C פנוי ~29GB. לבדוק מקום לפני `cargo build` ו-`install.bat`.
- **קישורים מתחת ל-`%LOCALAPPDATA%` במחשב הזה:** ב-Temp וב-V: הם עובדים, ישירות מתחת ל-`%LOCALAPPDATA%` לא (גם מחוץ לסנדבוקס). שתי תופעות: `uv python install` נכשל ב-"Missing expected target directory for Python minor version link" אחרי ש-Python כבר הותקן, ו-huggingface_hub נכשל ב-WinError 1314 על symlink, למרות שהבדיקה שלו עברה. הטיפול: באשף, שלב ה-Python מצליח כשיש `python.exe` ו-`uv venv` מקבל את הנתיב המלא. ב-`engine.py` המודלים נשמרים כקבצים אמיתיים בלי symlinks.
- **uv venv בלי setuptools:** ‏ctranslate2 4.5 מייבא `pkg_resources`, ולכן `setuptools==75.8.0` נמצא ב-`requirements.txt`.
