"""ייצוא תמלול: כתוביות SRT, קובץ Word, קובץ טקסט."""
from pathlib import Path

RLE, PDF = "‫", "‬"  # right-to-left embedding for players that show Hebrew backwards


def fmt_srt(t):
    t = max(0.0, t)
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def fmt_clock(t):
    t = int(max(0, t))
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return f"{h}:{m:02}:{s:02}" if h else f"{m:02}:{s:02}"


def write_srt(segments, path, with_speaker=False, rtl_fix=False):
    lines = []
    i = 0
    for seg in segments:
        if seg.get("deleted") or not seg["text"].strip():
            continue
        i += 1
        text = seg["text"].strip()
        if with_speaker and seg.get("speaker"):
            text = f"{seg['speaker']}: {text}"
        if rtl_fix:
            text = RLE + text + PDF
        lines += [str(i), f"{fmt_srt(seg['start'])} --> {fmt_srt(seg['end'])}", text, ""]
    Path(path).write_text("\n".join(lines), encoding="utf-8-sig")
    return path


def write_txt(segments, path, with_times=True):
    out, last = [], None
    for seg in segments:
        if seg.get("deleted"):
            continue
        sp = seg.get("speaker")
        head = ""
        if sp != last:
            head = f"\n{sp}" + (f" [{fmt_clock(seg['start'])}]" if with_times else "") + ":\n"
            last = sp
        out.append(head + seg["text"].strip())
    Path(path).write_text("\n".join(out).strip() + "\n", encoding="utf-8-sig")
    return path


def write_docx(segments, path, title="תמלול", with_times=True):
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    from docx.shared import Pt, RGBColor

    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Arial"
    style.font.size = Pt(12)
    style.element.rPr.rFonts.set(qn("w:cs"), "Arial")

    def rtl(p):
        pPr = p._p.get_or_add_pPr()
        b = OxmlElement("w:bidi")
        pPr.append(b)
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    def run_rtl(r):
        rPr = r._r.get_or_add_rPr()
        e = OxmlElement("w:rtl")
        rPr.append(e)

    h = doc.add_heading(title, level=1)
    rtl(h)
    for r in h.runs:
        run_rtl(r)

    last, para = None, None
    for seg in segments:
        if seg.get("deleted"):
            continue
        sp = seg.get("speaker") or ""
        if sp != last:
            hp = doc.add_paragraph()
            rtl(hp)
            r = hp.add_run(sp + (f"  ({fmt_clock(seg['start'])})" if with_times else ""))
            r.bold = True
            r.font.color.rgb = RGBColor(0x1F, 0x4E, 0x79)
            run_rtl(r)
            para = doc.add_paragraph()
            rtl(para)
            last = sp
        r = para.add_run(seg["text"].strip() + " ")
        run_rtl(r)
    doc.save(str(path))
    return path
