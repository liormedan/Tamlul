"""
עוזר AI: סיכום, פרקים ושאלות על התמלול, דרך Claude API (חשבון מפתחים).
Calls the Anthropic Messages API with streaming, using only the Python standard library.
"""
import json
import os
import ssl
import urllib.error
import urllib.request

API_URL = os.environ.get("TAMLUL_AI_URL", "https://api.anthropic.com/v1/messages")
API_VERSION = "2023-06-01"

MODELS = {
    "claude-haiku-5-5": {"label": "Haiku – מהיר וזול", "in": 0.10, "out": 0.50},
    "claude-sonnet-5-5": {"label": "Sonnet – מומלץ לעברית", "in": 2.0, "out": 10.0},
    "claude-opus-5-5": {"label": "Opus – הכי חזק", "in": 4.0, "out": 20.0},
}
DEFAULT_MODEL = "claude-sonnet-5-5"

CONSOLE_KEYS_URL = "https://platform.claude.com/settings/keys"
CONSOLE_BILLING_URL = "https://platform.claude.com/settings/billing"

SYSTEM_PROMPT = """אתה עוזר עריכה לפודקאסטים וסרטונים בעברית. לפניך תמלול של הקלטה.
כל שורה בתמלול מתחילה בזמן [דקות:שניות] ובשם הדובר.

כללים:
- ענה בעברית טבעית וברורה, אלא אם התבקשת אחרת.
- כשאתה מפנה לרגע בהקלטה, כתוב את הזמן בפורמט [mm:ss] או [h:mm:ss] בדיוק כמו בתמלול, כדי שאפשר יהיה ללחוץ עליו.
- הסתמך רק על מה שנאמר בתמלול. אם משהו לא נאמר, אמור זאת במפורש ואל תמציא.
- התמלול נוצר אוטומטית וייתכנו בו טעויות זיהוי; כשמילה נראית שגויה, הבן אותה מההקשר.
- השתמש בכותרות קצרות ובנקודות כשזה עוזר לקריאה. אל תוסיף הקדמות מיותרות."""

PRESETS = {
    "summary": "כתוב סיכום של ההקלטה: פסקת תקציר של 3-4 משפטים, ואחריה סיכום מורחב לפי הנושאים שעלו, עם הזמן שבו כל נושא מתחיל.",
    "chapters": "חלק את ההקלטה לפרקים ליוטיוב. החזר רשימה בפורמט המדויק שיוטיוב דורש: כל שורה מתחילה בזמן (הראשונה 00:00), רווח, ושם פרק קצר וקולע. בין 5 ל-12 פרקים, כל פרק לפחות דקה. אחרי הרשימה אל תוסיף שום דבר. הפעם כתוב את הזמנים בלי סוגריים מרובעים, כפי שיוטיוב מבקש.",
    "points": "כתוב את הנקודות העיקריות וההמלצות המעשיות שעלו בהקלטה, כרשימה תמציתית, עם הזמן של כל נקודה.",
    "quotes": "מצא 5-8 ציטוטים חזקים ומעניינים מתוך ההקלטה שמתאימים לסרטונים קצרים ברשתות (רילס/שורטס). לכל ציטוט: הזמן, הדובר, הציטוט עצמו כפי שנאמר, ומשפט קצר למה הוא עובד.",
    "title": "הצע 3 כותרות אפשריות לפרק, ואחריהן תיאור לפרק ליוטיוב (כ-100-150 מילים) שמזמין לצפות, ובסופו 5-8 תגיות רלוונטיות.",
    "people": "מי הדוברים בהקלטה ומה התפקיד או הנקודה העיקרית של כל אחד? אם אפשר להבין מההקשר את השמות האמיתיים של 'דובר 1', 'דובר 2' וכו', ציין זאת ואת הסיבה.",
}


class AIError(Exception):
    def __init__(self, message, kind="error"):
        super().__init__(message)
        self.kind = kind  # error | key | credit | overloaded


def mask_key(key):
    if not key:
        return ""
    return key[:10] + "…" + key[-4:] if len(key) > 16 else "…"


def fmt_ts(t):
    t = int(max(0, t))
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return f"{h}:{m:02}:{s:02}" if h else f"{m:02}:{s:02}"


def build_transcript(segments):
    """Readable transcript: one line per sentence, merging consecutive lines of the same speaker."""
    lines, last_sp, line_start = [], None, 0.0
    for s in segments:
        text = s["text"].strip()
        if not text:
            continue
        sp = s.get("speaker") or ""
        # same speaker continues on the same line, but a fresh timestamp every ~30 s keeps references precise
        if sp == last_sp and lines and s["start"] - line_start < 30 and len(lines[-1]) < 300:
            lines[-1] += " " + text
            continue
        lines.append(f"[{fmt_ts(s['start'])}] {sp}: {text}")
        last_sp, line_start = sp, s["start"]
    return "\n".join(lines)


def estimate_cost(model, usage):
    p = MODELS.get(model, MODELS[DEFAULT_MODEL])
    inp = usage.get("input_tokens", 0)
    cache_w = usage.get("cache_creation_input_tokens", 0)
    cache_r = usage.get("cache_read_input_tokens", 0)
    out = usage.get("output_tokens", 0)
    cost = (inp * p["in"] + cache_w * p["in"] * 1.25 + cache_r * p["in"] * 0.1 + out * p["out"]) / 1_000_000
    return round(cost, 5)


def _error_from_http(e):
    try:
        body = json.loads(e.read().decode("utf-8", "replace"))
        msg = body.get("error", {}).get("message", "") or str(body)
    except Exception:
        msg = str(e)
    low = msg.lower()
    if e.code == 401 or "api key" in low or "x-api-key" in low:
        return AIError("מפתח ה-API לא תקין. בדוק אותו בהגדרות ← עוזר AI.", "key")
    if "credit balance" in low or "billing" in low or e.code == 402:
        return AIError("נגמר הקרדיט בחשבון המפתחים. אפשר לטעון קרדיט בלחיצה על 'קניית קרדיטים'.", "credit")
    if e.code in (429, 529) or "overloaded" in low or "rate limit" in low:
        return AIError("השירות עמוס כרגע. נסה שוב בעוד דקה.", "overloaded")
    if e.code == 404 and "model" in low:
        return AIError("המודל שנבחר לא זמין בחשבון שלך. בחר מודל אחר בהגדרות.", "error")
    return AIError(f"שגיאה מ-Claude ({e.code}): {msg}", "error")


def stream_chat(api_key, model, transcript, history, question, max_tokens=4000, cancel=None):
    """
    Generator yielding ("text", chunk) pieces and finally ("done", {usage, cost, model}).
    history: [{"role": "user"/"assistant", "content": str}]
    The transcript is placed in the system prompt with prompt caching, so follow-up
    questions on the same recording are much cheaper.
    """
    if not api_key:
        raise AIError("עדיין לא הוגדר מפתח API. היכנס להגדרות ← עוזר AI.", "key")
    messages = [{"role": m["role"], "content": m["content"]} for m in history if m.get("content")]
    messages.append({"role": "user", "content": question})
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "stream": True,
        "system": [
            {"type": "text", "text": SYSTEM_PROMPT},
            {"type": "text", "text": "<transcript>\n" + transcript + "\n</transcript>",
             "cache_control": {"type": "ephemeral"}},
        ],
        "messages": messages,
    }
    req = urllib.request.Request(
        API_URL, data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"x-api-key": api_key, "anthropic-version": API_VERSION,
                 "content-type": "application/json", "accept": "text/event-stream"})
    try:
        resp = urllib.request.urlopen(req, timeout=120, context=ssl.create_default_context())
    except urllib.error.HTTPError as e:
        raise _error_from_http(e)
    except urllib.error.URLError as e:
        raise AIError(f"אין חיבור ל-Claude. בדוק את החיבור לאינטרנט. ({e.reason})")

    usage = {}
    stop_reason = None
    with resp:
        event = None
        for raw in resp:
            if cancel is not None and cancel.is_set():
                break
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if line.startswith("event:"):
                event = line[6:].strip()
                continue
            if not line.startswith("data:"):
                continue
            try:
                data = json.loads(line[5:].strip())
            except ValueError:
                continue
            t = data.get("type", event)
            if t == "message_start":
                usage.update(data.get("message", {}).get("usage", {}) or {})
            elif t == "content_block_delta":
                d = data.get("delta", {})
                if d.get("type") == "text_delta" and d.get("text"):
                    yield ("text", d["text"])
            elif t == "message_delta":
                usage.update(data.get("usage", {}) or {})
                stop_reason = data.get("delta", {}).get("stop_reason") or stop_reason
            elif t == "error":
                err = data.get("error", {})
                msg = err.get("message", "שגיאה")
                if "overloaded" in (err.get("type", "") + msg).lower():
                    raise AIError("השירות עמוס כרגע. נסה שוב בעוד דקה.", "overloaded")
                raise AIError("שגיאה מ-Claude: " + msg)
    yield ("done", {"usage": usage, "cost": estimate_cost(model, usage), "model": model,
                    "truncated": stop_reason == "max_tokens"})


def test_key(api_key, model):
    """Tiny request to check that the key and credit work."""
    gen = stream_chat(api_key, model, "[00:00] בדיקה: שלום", [], "ענה במילה אחת: תקין", max_tokens=10)
    text = ""
    for kind, val in gen:
        if kind == "text":
            text += val
    return text.strip()
