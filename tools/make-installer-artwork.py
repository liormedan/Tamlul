from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src-tauri" / "nsis"
BG = "#15181d"
TEAL = "#15837c"
LIGHT_TEAL = "#2fb5a9"
WHITE = "#ffffff"


def font(size):
    candidates = [
        Path("C:/Windows/Fonts/segoeuib.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def draw_art(width, height, mark_size):
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, width - 1, height - 1), outline=TEAL, width=max(1, width // 100))
    center_x = width // 2
    text_font = font(mark_size)
    box = draw.textbbox((0, 0), "ת", font=text_font)
    x = center_x - (box[2] - box[0]) // 2
    y = int(height * 0.22) - box[1]
    draw.text((x, y), "ת", font=text_font, fill=WHITE)
    wave_y = int(height * 0.79)
    spacing = max(5, width // 22)
    bar_width = max(2, width // 34)
    heights = [0.34, 0.56, 0.78, 0.48, 0.65, 0.38, 0.72, 0.52, 0.32]
    start_x = center_x - (len(heights) * spacing) // 2
    for index, factor in enumerate(heights):
        bar_height = max(3, int(height * factor * 0.22))
        bx = start_x + index * spacing
        draw.rounded_rectangle(
            (bx, wave_y - bar_height // 2, bx + bar_width, wave_y + bar_height // 2),
            radius=max(1, bar_width // 2), fill=LIGHT_TEAL if index % 2 else TEAL,
        )
    return image


OUTPUT.mkdir(parents=True, exist_ok=True)
draw_art(164, 314, 148).save(OUTPUT / "sidebar.bmp")
draw_art(150, 57, 44).save(OUTPUT / "header.bmp")
