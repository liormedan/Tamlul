# העברה לסוכן הבא — Tamlul

עודכן: 2026-11-11 (רביעי), אחרי R0.

## סיכום מצב והמשך מיידי

- הענף הפעיל הוא `saas`. S1 הושלם: CI ו-Release עברו, ונוצרה טיוטת prerelease עם מתקין ו-`SHA256SUMS.txt`. הטיוטה לא פורסמה.
- **R0 הושלם ונדחף:** עדכון חבילות המנוע (חלק מ-S2) תוקן ונבדק בריצה אמיתית. פרטים בסעיף "R0" למטה.
- סדר העבודה מכאן הוא מסלול הריליס (R0–R9): https://claude.ai/artifact/ExDhbwYfDueyzaa63QzrtX.
- **R1 בעבודה:** Lior בחר ריפו ציבורי ל-Releases. נוצר `liormedan/Tamlul-releases` (ציבורי, README להורדה בלבד), ו-`release.yml` מפרסם אליו טיוטה כשהסוד `RELEASES_TOKEN` קיים. ממתין ל-Lior: ליצור את הטוקן ולשמור אותו כסוד (פרטים בסעיף R1). אחר כך: תגית בדיקה, ו-Lior מפרסם את הטיוטה.
- מפתח חתימת updater עדיין לא הוגדר. תעודת חתימת הקוד מסומנת בכוכבית. אין לגעת ב-`main` או לפרסם את טיוטת ה-Release ללא אישור.

## מה זה

תוכנת תמלול עברית שרצה מקומית על Windows: מנוע בפייתון (FastAPI + faster-whisper + SpeechBrain) וממשק JS בלי בנדלר. התיאור המלא, כולל סעיף המפתחים, ב-`README.md`.

## מצב ה-git

| ענף | קומיט אחרון | מה יש בו |
|---|---|---|
| `main` | `aab8074` | מעטפת Tauri 2, מתקין, אשף התקנה ומצב כהה. PR #1 מוזג אליו באישור של Lior ב-2026-10-31 |
| `tauri` | `817511d` | הענף של מעבר ל-Tauri (שלבים 0–5). מוזג ל-`main`, אין בו עבודה חדשה |
| `saas` | הקומיט של הקובץ הזה | תוכנית המנוי, מ-`main` (ספרינט S0 והלאה). **הענף הפעיל** |

מאגר פרטי: `https://github.com/liormedan/Tamlul`.

## תוכנית המנוי (ענף `saas`)

הדשבורד: https://claude.ai/artifact/MpRr6hVJTJryqyWSZ4M1oe (7 שלבים, 12 ספרינטים של שבוע).

**העיקרון: כל העבודה נשארת במחשב של המשתמש.** וידאו, אודיו ותמלולים לא עולים לשום שרת. הענן משמש רק לאתר, לעדכונים, לחשבון ולרישיון, לתשלום, ולשער AI שמעביר טקסט רק כשמשתמשים בעוזר ולא שומר אותו.

**רישום, אימות, רישיון ותשלום נבנים בסוף (S10–S11).** עד אז כל בדיקת הרשאה עוברת דרך `license()` שמחזירה "מלא", ושער ה-AI וערוץ הבטא סגורים בטוקן בטא.

החלטות שנסגרו ב-2026-10-31 (לפי ההמלצות בדשבורד):
- עוזר ה-AI: שער של המערכת, ומפתח אישי נשאר כאפשרות.
- מחיר: מנוי חודשי ושנתי, ניסיון של 14 יום. המכסה היא על ה-AI, כי לתמלול אין עלות שרת.
- קהל יעד ראשון: יוצרי תוכן ופודקאסטים.
- כשמנוי נגמר: הפרויקטים נשארים פתוחים לקריאה ולייצוא. תמלול חדש ו-AI נעצרים.

מדידת מהירות: `tools/bench.py` (התוצאות נצברות ב-`tools/bench-results.jsonl`). תוצאות ראשונות, במחשב של Lior (i7-8700, ‏16GB RAM):

| איפה רץ | שעת אודיו לוקחת | טעינת מודלים |
|---|---|---|
| GTX 1660 Ti (‏float16) | כ-14 דקות | 24 שניות |
| מעבד בלבד (‏int8) | כ-51 דקות | 19 שניות |

`CUDA_VISIBLE_DEVICES=` לא מכבה את הכרטיס ל-CTranslate2, ולכן `--device cpu` טוען את מודל המעבד ישירות.

## מה לא נמצא ב-git — צריך להשיג במחשב החדש

| מה | גודל | איך משיגים |
|---|---|---|
| `.venv/` | ~5GB | לפיתוח בלבד: `install.bat` בונה אותה (Python 3.11 + torch cu124 + `requirements.txt`). אם מעתיקים מהמחשב הקודם — לתקן את `.venv/pyvenv.cfg` שיצביע על Python 3.11.9 המקומי (כך תוקן כאן: הוא הצביע על משתמש `medan` במחשב אחר) |
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

### ספרינט S1 — תהליך הפצה

תהליך ההפצה אוטומטי בענף `saas`: מקור גרסה מרכזי ב-`tools/set-version.mjs`, גרסת `/api/health` מועברת מהמעטפת, CI בסיסי, ו-workflow לתגיות `v*` שמעלה מתקין Windows ו-`SHA256SUMS.txt` ל-GitHub Release כטיוטה. חתימת קוד מופעלת רק כששני הסודות `WINDOWS_CERTIFICATE` ו-`WINDOWS_CERTIFICATE_PASSWORD` מוגדרים; אחרת המתקין לא חתום ומופיעה אזהרה בסיכום הפעולה. אמנות NSIS נוצרת ב-`tools/make-installer-artwork.py`. בניית מתקין מקומית לגרסת בדיקה הצליחה; התקנה שקטה וה-API החזירו `0.1.1-test.1` בתיקיות בדיקה מבודדות תחת `src-tauri/target`, בלי להשתמש בנתוני המשתמש. ה-PrintWindow של חלון NSIS החזיר תמונה שחורה, ולכן תצוגת האמנות בתוך חלון המתקין עדיין לא אומתה בצילום. הרצת GitHub הראשונה נכשלה כי `tauri.conf.json` דורש את `src-tauri/bin/uv.exe` כבר בזמן `cargo check/build`, אך הקובץ מוחרג מ-Git ונוצר קודם רק ב-`beforeBundleCommand`. שני ה-workflows עודכנו להריץ קודם את הסקריפט הנעול `src-tauri/fetch-uv.ps1`; ה-CI החוזר עבר. גם ריצת ה-Release החוזרת הצליחה: טיוטת prerelease עבור `v0.1.1-test.2` נוצרה עם `Tamlul_0.1.1-test.2_x64-setup.exe` ו-`SHA256SUMS.txt`. הטיוטה עדיין לא פורסמה, כנדרש ב-workflow. תעודת חתימת הקוד לא קיימת; הכוכבית נשארת לסוף הספרינטים.

### R0 — עדכון חבילות המנוע (הושלם, 2026-11-11)

`runtime/ready.json` שומר שתי טביעות: `requirements_sha256` (של `requirements.txt`) ו-`torch` (הנעיצה `TORCH` + `TORCH_INDEX` מ-`setup.rs`, כי torch מותקן מאינדקס משלו ולא מופיע ב-`requirements.txt`). `stale_package_steps()` מחזיר אילו שלבים להריץ: 2 (torch) ו/או 3 (requirements); טביעה חסרה (סביבה מלפני המעקב) מריצה את השלב פעם אחת, ו-uv מסיים אותו בשניות אם הכול כבר מותקן. `update_engine_dependencies` היא פקודה `async` שמריצה את העבודה ב-`spawn_blocking`: פקודה רגילה רצה על ה-thread הראשי והקפיאה את החלון. בזמן העדכון `setup_running` חוסם את `restart_engine` ועדכון נוסף. `uv pip install` לא מסיר חבילות שנמחקו מהרשימה; `uv pip sync` היה מסיר גם את torch, לכן זה מתועד ולא משונה.

נבדק בריצה אמיתית בסביבה מבודדת (עותק של `.venv` ו-`models` תחת `src-tauri/target/r0-test`, עם `TAMLUL_HOME`, ‏`TAMLUL_RUNTIME`, ‏`TAMLUL_DATA`; נמחק אחרי הבדיקה), ומעקב CDP על החלון:
- סביבה עם טביעה ישנה + חבילה חדשה ב-`requirements.txt`: שני השלבים רצו (torch: ‏"Checked 2 packages in 1.30s"), החבילה הותקנה, torch נשאר `2.5.1+cu124`. קריאות IPC מהחלון ענו תוך 5–22ms לאורך כל העדכון. שתי ההודעות הופיעו, והמנוע עלה (gen 2) עם `authed:true`.
- המודלים: גודל, mtime ו-SHA-256 של כל 11 הקבצים (1.71GB) זהים לפני ואחרי.
- הפעלה שנייה: אין עדכון, `setup.log` לא גדל, המנוע עולה ישר.
- חבילה שלא קיימת: הודעת שגיאה בחלון, המנוע עולה על החבילות הקיימות, הטביעה לא מתעדכנת (ינסה שוב בהפעלה הבאה).
- סגירה לפי PID לא השאירה תהליכי python.

### R1 — מקום הפצה ציבורי (בעבודה)

- `https://github.com/liormedan/Tamlul-releases`: ציבורי, בלי קוד. רק README בעברית ובאנגלית (הורדה, דרישות מערכת, SmartScreen, בדיקת SHA-256, הסרה). Issues, Wiki ו-Projects כבויים. מקור ה-README היה בתיקייה זמנית; לעריכה עתידית עורכים ישירות בריפו.
- הקומיט הראשון שם נושא את כתובת ה-Gmail של Lior. ניסיון להחליף אותה בכתובת ה-noreply עם force push נחסם; ההחלטה (force push, מחיקה ויצירה מחדש, או להשאיר) אצל Lior.
- `release.yml`, ‏job ‏`release`: עם `RELEASES_TOKEN`, טיוטה ב-`PUBLIC_RELEASES_REPO` עם `--target main` והערות ניטרליות בעברית (גרסה, "מה חדש" למילוי, הוראות התקנה, SHA-256), כי `--generate-notes` היה חושף כותרות של קומיטים ו-PR מהריפו הפרטי. בלי הסוד: טיוטה בריפו הפרטי כמו קודם, עם אזהרה בסיכום. נבדק בהרצה יבשה (gh מוחלף ב-stub) בשני המצבים.
- **ממתין ל-Lior:** טוקן fine-grained ב-GitHub (Settings ← Developer settings ← Fine-grained tokens), גישה רק ל-`Tamlul-releases`, הרשאה Contents: Read and write. לשמור אותו עם `gh secret set RELEASES_TOKEN --repo liormedan/Tamlul` (הפקודה מבקשת את הערך). קלוד לא מטפל בערך הטוקן.
- אחר כך: תגית בדיקה (למשל `v0.1.1-test.3`), לוודא שהטיוטה נוצרה בריפו הציבורי, ו-Lior מפרסם אותה. R1 נגמר כשקישור ההורדה עובד בלי התחברות.

### ספרינט S2 — מה נשאר (R2 במסלול הריליס)

Tauri updater, ערוצי בטא/יציב, והודעת גרסה חדשה בעורך. ה-endpoint יהיה `latest.json` בריפו הציבורי. תיעוד Tauri דורש חתימה קריפטוגרפית לכל עדכון; מפתח ה-updater נפרד מתעודת חתימת הקוד ועדיין לא נוצר. אל תמציא מפתח. אל תיגע ב-`main`.
הערת בדיקה: בדיקת המתקין וההתקנה השקטה חייבות להשתמש בסביבה זמנית ומבודדת כדי לא לגעת בנתוני המשתמש תחת `%LOCALAPPDATA%\com.liormedan.tamlul`.

1. ~~**תמלול אמיתי בחלון טאורי לא נבדק.**~~ נבדק בשלב 0 על GTX 1660 Ti. הבדיקה נעצרה בגלל זיכרון: במחשב הקודם 7.8GB RAM, MX110 עם 2GB (לא תומך float16 → נפילה ל-CPU int8, איטי). אם למחשב החדש יש כרטיס NVIDIA חזק יותר — לבדוק שם. קובץ בדיקה קצר אפשר ליצור עם קול "Asaf" של Windows (he-IL, ‏OneCore TTS).
2. ~~**מתקין**~~ — נפתר בשלב 4: NSIS של טאורי ואשף התקנה בהפעלה הראשונה. נשאר: חתימת קוד (SmartScreen מזהיר בהפעלה ראשונה).
3. ~~**אייקונים**~~ — נפתר בשלב 4: `src-tauri/icons/source.svg`.
4. ~~**פורט 8765 קבוע**~~ — נפתר בשלב 1: פורט דינמי וטוקן לכל הפעלה.
5. ~~**PR מ-`tauri` ל-`main`**~~ — https://github.com/liormedan/Tamlul/pull/1 מוזג באישור של Lior ב-2026-10-31 (`aab8074`).
6. ~~**ניקוי**~~ — נעשה בשלב 5: `app/desktop.py`, ‏`start.bat`, ‏`index1.html` ו-pywebview הוסרו. `install.bat` נשאר רק להקמת סביבת פיתוח (`.venv` ו-`models\` בריפו), בלי קיצור דרך.
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
- **בדיקת המתקין עם ממשק:** חלון המתקין או המסיר קופץ לחזית ותופס הקלדה או Enter של מי שעובד במחשב באותו רגע. כך דף האישור של המסיר עבר פעמיים להסרה בלי שנלחץ "הסר". הנתונים נשארו, כי "מחק גם…" לא מסומן כברירת מחדל. כדאי לצלם עם PrintWindow ולבטל עם `PostMessage(hwnd, WM_COMMAND, IDCANCEL)` ולא במקלדת. המתקין בוחר שפה לפי שפת ההתקנה של Windows. כאן היא he-IL (ממשק המשתמש en-US), ולכן הוא עלה בעברית. ב-Windows שכולו באנגלית הוא יעלה באנגלית.
- **uv venv בלי setuptools:** ‏ctranslate2 4.5 מייבא `pkg_resources`, ולכן `setuptools==75.8.0` נמצא ב-`requirements.txt`.
