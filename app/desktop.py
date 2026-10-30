"""
חלון דסקטופ לתוכנת התמלול: מריץ את השרת (server.py) ברקע ופותח עליו חלון
WebView2 (המנוע של Edge). סגירת החלון עוצרת גם את השרת.
Desktop window: python app/desktop.py   (start.bat runs this with pythonw)
"""
import ctypes
import os
import socket
import sys
import threading
import time
import traceback
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_DIR))

TITLE = "תמלול בעברית"
LOG = APP_DIR.parent / "data" / "desktop.log"


def _log_to_file():
    """Under pythonw there is no console; keep prints and errors in data/desktop.log."""
    LOG.parent.mkdir(parents=True, exist_ok=True)
    f = open(LOG, "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = f


def _port_open(port):
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def _wait_for_port(port, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        if _port_open(port):
            return True
        time.sleep(0.1)
    return False


def _error_box(text):
    ctypes.windll.user32.MessageBoxW(None, text, TITLE, 0x10)  # MB_ICONERROR


def _file_types(kind):
    if kind == "audio":
        return ("קבצי אודיו (*.m4a;*.mp3;*.wav;*.aac;*.flac;*.ogg;*.wma;*.mp4)", "כל הקבצים (*.*)")
    return ("קבצי וידאו ואודיו (*.mp4;*.mov;*.mkv;*.avi;*.webm;*.m4a;*.mp3;*.wav;*.aac;*.flac;*.ogg;*.wma)",
            "כל הקבצים (*.*)")


def main():
    if sys.stdout is None:
        _log_to_file()
    import webview
    import server

    server.ensure_env_file()
    port = server.PORT
    url = f"http://127.0.0.1:{port}"

    uv = None
    if _port_open(port):
        print("Tamlul server already running, opening a window on it.")
    else:
        import uvicorn
        uv = uvicorn.Server(uvicorn.Config(server.app, host="127.0.0.1", port=port, log_level="warning"))
        threading.Thread(target=uv.run, daemon=True).start()
        if not _wait_for_port(port):
            raise RuntimeError(f"השרת לא עלה על פורט {port}")

    window = webview.create_window(TITLE, url, width=1360, height=860, min_size=(960, 600),
                                   text_select=True)

    def pick(multiple, kind):
        res = window.create_file_dialog(webview.FileDialog.OPEN, allow_multiple=multiple,
                                        file_types=_file_types(kind))
        return list(res or [])

    server.PICK_HOOK = pick

    def on_closed():
        if uv is not None:
            uv.should_exit = True

    window.events.closed += on_closed

    webview.start(gui="edgechromium", private_mode=False,
                  storage_path=str(APP_DIR.parent / "data" / "webview"),
                  debug=os.environ.get("TAMLUL_DEBUG") == "1")

    # Window closed: give the server a moment to stop, then make sure nothing lingers
    # (transcription worker threads are not daemons).
    if uv is not None:
        for _ in range(50):
            if not _port_open(port):
                break
            time.sleep(0.1)
    os._exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        _error_box("התוכנה לא הצליחה לעלות.\n\n" + traceback.format_exc().splitlines()[-1]
                   + f"\n\nפרטים בקובץ:\n{LOG}")
        os._exit(1)
