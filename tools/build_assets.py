"""Build the site's font subset, icons and share image.

Usage (from the repository root):

    python tools/build_assets.py --font C:/Windows/Fonts/NotoSerifSC-VF.ttf

Needs fontTools, brotli, Pillow and numpy. The font is Noto Serif SC
(SIL Open Font License 1.1, https://github.com/notofonts/noto-cjk).
Re-run after changing any heading text in index.html, so the subset
contains every character the serif headings use.
"""

from __future__ import annotations

import argparse
import io
from html.parser import HTMLParser
from pathlib import Path

import numpy as np
from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

PAPER = (245, 242, 234)
INK = (28, 27, 24)
INK_SOFT = (87, 82, 74)
INK_FAINT = (138, 132, 120)
RULE = (185, 176, 157)
ACCENT = (181, 64, 44)
ACCENT_INK = (251, 246, 238)

SERIF_TAGS = {"h1", "h2", "h3"}
SERIF_CLASSES = {"seal", "brand-name", "demo-title", "section-intro", "stance", "project-name", "footer-name"}
ALWAYS = "".join(chr(c) for c in range(0x20, 0x7F)) + "「」“”‘’·—…，。：；？！、（）《》→↗↑"


class SerifText(HTMLParser):
    """Collect the text of every element that is set in the serif face."""

    VOID = {"br", "img", "meta", "link", "input", "hr", "source"}

    def __init__(self) -> None:
        super().__init__()
        self.stack: list[bool] = []
        self.chars: set[str] = set()

    def handle_starttag(self, tag, attrs):
        if tag in self.VOID:
            return
        classes = set((dict(attrs).get("class") or "").split())
        inherited = bool(self.stack and self.stack[-1])
        self.stack.append(inherited or tag in SERIF_TAGS or bool(classes & SERIF_CLASSES))

    def handle_endtag(self, tag):
        if tag not in self.VOID and self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if self.stack and self.stack[-1]:
            self.chars.update(data)


def serif_characters() -> str:
    parser = SerifText()
    parser.feed((ROOT / "index.html").read_text(encoding="utf-8"))
    chars = parser.chars | set(ALWAYS) | set("空投一轮比想得更深循环计算")
    return "".join(sorted(ch for ch in chars if not ch.isspace() or ch == " "))


def build_subset(font_path: Path, text: str) -> None:
    font = TTFont(font_path)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.hinting = False
    options.desubroutinize = True
    options.name_IDs = ["*"]
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    font = instancer.instantiateVariableFont(font, {"wght": (500, 900)})
    target = ASSETS / "serif-subset.woff2"
    font.flavor = "woff2"
    font.save(target)
    print(f"{target.name}: {len(text)} characters, {target.stat().st_size / 1024:.1f} KiB")


def glyph_path(static_font: TTFont, char: str, size: float, center: tuple[float, float]) -> str:
    glyph_set = static_font.getGlyphSet()
    name = static_font.getBestCmap()[ord(char)]
    measure = BoundsPen(glyph_set)
    glyph_set[name].draw(measure)
    x_min, y_min, x_max, y_max = measure.bounds
    scale = size / max(x_max - x_min, y_max - y_min)
    dx = center[0] - (x_min + x_max) / 2 * scale
    dy = center[1] + (y_min + y_max) / 2 * scale
    pen = SVGPathPen(glyph_set, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    glyph_set[name].draw(TransformPen(pen, (scale, 0, 0, -scale, dx, dy)))
    return pen.getCommands()


def build_favicon(font_path: Path) -> None:
    static = instancer.instantiateVariableFont(TTFont(font_path), {"wght": 900})
    path = glyph_path(static, "空", 40, (32, 32.5))
    accent = "#%02x%02x%02x" % ACCENT
    paper = "#%02x%02x%02x" % ACCENT_INK
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        f'<rect width="64" height="64" rx="7" fill="{accent}"/>'
        f'<rect x="4" y="4" width="56" height="56" rx="4" fill="none" stroke="{paper}" stroke-width="1.6"/>'
        f'<path fill="{paper}" d="{path}"/>'
        "</svg>\n"
    )
    (ASSETS / "seal.svg").write_text(svg, encoding="utf-8")
    print(f"seal.svg: {len(svg)} bytes")


def pil_font(font_path: Path, size: int, weight: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(font_path), size)
    font.set_variation_by_axes([weight])
    return font


def draw_seal(image: Image.Image, font_path: Path, box: tuple[int, int, int, int], chars: str) -> None:
    draw = ImageDraw.Draw(image)
    x0, y0, x1, y1 = box
    width = x1 - x0
    radius = max(4, width // 14)
    draw.rounded_rectangle(box, radius=radius, fill=ACCENT)
    inset = max(4, width // 16)
    draw.rounded_rectangle(
        (x0 + inset, y0 + inset, x1 - inset, y1 - inset),
        radius=max(2, radius // 2),
        outline=ACCENT_INK,
        width=max(2, width // 60),
    )
    font = pil_font(font_path, int(width * 0.62), 900)
    slot = (y1 - y0) / len(chars)
    for index, char in enumerate(chars):
        cx = (x0 + x1) / 2
        cy = y0 + slot * (index + 0.5)
        draw.text((cx, cy), char, font=font, fill=ACCENT_INK, anchor="mm")


def build_touch_icon(font_path: Path) -> None:
    scale = 4
    size = 180 * scale
    image = Image.new("RGB", (size, size), ACCENT)
    draw = ImageDraw.Draw(image)
    inset = 14 * scale
    draw.rounded_rectangle((inset, inset, size - inset, size - inset), radius=10 * scale, outline=ACCENT_INK, width=3 * scale)
    font = pil_font(font_path, int(size * 0.56), 900)
    draw.text((size / 2, size / 2), "空", font=font, fill=ACCENT_INK, anchor="mm")
    image = image.resize((180, 180), Image.LANCZOS)
    image.save(ASSETS / "seal-180.png", optimize=True)
    print(f"seal-180.png: {(ASSETS / 'seal-180.png').stat().st_size / 1024:.1f} KiB")


def recurrence(cols: int, rows: int, sources: list[tuple[int, int]], rounds: int, lam: float = 0.95):
    """Same scalar recurrence as recurrence.mjs: x ← λ·Āx + b, x₀ = b."""
    b = np.zeros((rows, cols))
    for c, r in sources:
        b[r, c] = 1.0
    x = b.copy()
    reached = np.where(b > 0, 0, -1)
    for t in range(1, rounds + 1):
        padded = np.pad(x, 1)
        total = x + padded[:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, :-2] + padded[1:-1, 2:]
        x = lam * total / 5 + b
        reached = np.where((x > 0) & (reached < 0), t, reached)
    return x, b, reached


def build_share_image(font_path: Path) -> None:
    scale = 2
    width, height = 1200 * scale, 630 * scale
    image = Image.new("RGB", (width, height), PAPER)
    draw = ImageDraw.Draw(image)

    margin = 88 * scale
    draw_seal(image, font_path, (margin, 72 * scale, margin + 68 * scale, 72 * scale + 128 * scale), "空投")

    title = pil_font(font_path, 92 * scale, 700)
    draw.text((margin, 345 * scale), "一轮比一轮", font=title, fill=INK, anchor="ls")
    draw.text((margin, 452 * scale), "想得更深", font=title, fill=INK, anchor="ls")

    small = pil_font(font_path, 30 * scale, 600)
    draw.text((margin, 540 * scale), "空投 Kongtou · 循环计算", font=small, fill=INK_SOFT, anchor="ls")

    cols, rows, rounds = 19, 19, 12
    x, b, reached = recurrence(cols, rows, [(9, 9)], rounds)
    cell = 26 * scale
    grid_x = width - margin - cols * cell
    grid_y = (height - rows * cell) // 2
    largest = x.max()
    for r in range(rows):
        for c in range(cols):
            cx = grid_x + (c + 0.5) * cell
            cy = grid_y + (r + 0.5) * cell
            if b[r, c]:
                side = cell * 0.6
                draw.rectangle((cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2), fill=ACCENT)
                continue
            if reached[r, c] < 0:
                radius, color = cell * 0.055, RULE
            elif reached[r, c] == rounds:
                radius, color = cell * 0.16, ACCENT
            else:
                strength = min(1.0, max(0.0, 1 + np.log10(x[r, c] / largest) / 6))
                radius = cell * (0.1 + 0.32 * strength)
                alpha = 0.42 + 0.58 * strength
                color = tuple(int(PAPER[k] + (INK[k] - PAPER[k]) * alpha) for k in range(3))
            draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=color)

    label = pil_font(font_path, 20 * scale, 500)
    draw.text((grid_x, grid_y + rows * cell + 34 * scale), f"第 {rounds} 轮：信号从源点逐格传开", font=label, fill=INK_FAINT, anchor="ls")

    image = image.resize((1200, 630), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, "PNG", optimize=True)
    (ASSETS / "og.png").write_bytes(buffer.getvalue())
    print(f"og.png: {len(buffer.getvalue()) / 1024:.1f} KiB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--font", type=Path, required=True, help="path to NotoSerifSC-VF.ttf")
    args = parser.parse_args()
    ASSETS.mkdir(exist_ok=True)
    build_subset(args.font, serif_characters())
    build_favicon(args.font)
    build_touch_icon(args.font)
    build_share_image(args.font)


if __name__ == "__main__":
    main()
