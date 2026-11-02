"""Import the supplied HiveWork logos and build the existing mascot exports."""

from __future__ import annotations

import base64
import json
import math
import shutil
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "dashboard" / "branding" / "assets"
SOURCE = ROOT / "hivework-logo-assets"
PNG_LOGOS = {
    "logo_horizontal_dark.png": "png/logo-bilingual.png",
    "logo_horizontal_white.png": "png/logo-bilingual-reverse.png",
    "pwa-192.png": "icons/app-icon-orange-192.png",
    "pwa-512.png": "icons/app-icon-orange-512.png",
    "apple-touch-icon.png": "icons/app-icon-orange-180.png",
}
SVG_LOGOS = {
    "logo_vertical_dark.svg": "png/mark-orange.png",
    "logo_vertical_white.svg": "png/mark-white.png",
    "logo_horizontal_dark.svg": "png/logo-bilingual.png",
    "logo_horizontal_white.svg": "png/logo-bilingual-reverse.png",
    "favico.svg": "icons/app-icon-orange-64.png",
}
AMBER = "#F59E0B"
NAVY = "#172033"
WHITE = "#F8FAFC"


def hex_points(x: float, y: float, radius: float) -> list[tuple[float, float]]:
    return [
        (x + radius * math.cos(math.radians(a)), y + radius * math.sin(math.radians(a)))
        for a in range(-90, 270, 60)
    ]


def svg_logo(source: Path, name: str) -> str:
    """Keep existing SVG URLs with a self-contained, unmodified PNG payload."""
    with Image.open(source) as image:
        width, height = image.size
    payload = base64.b64encode(source.read_bytes()).decode("ascii")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'role="img" aria-label="{escape(name)}">'
        f'<image width="{width}" height="{height}" href="data:image/png;base64,{payload}"/>'
        "</svg>\n"
    )


def import_logos(name: str) -> None:
    for directory in (DEST, ROOT / "dashboard/public"):
        directory.mkdir(parents=True, exist_ok=True)
        for filename, source in PNG_LOGOS.items():
            shutil.copyfile(SOURCE / source, directory / filename)
        for filename, source in SVG_LOGOS.items():
            (directory / filename).write_text(svg_logo(SOURCE / source, name), encoding="utf-8")
    docs = ROOT / "docs/assets"
    for filename in (
        "octop-banner.png",
        "readme-banner.png",
        "readme-banner-zh.png",
        "overview.png",
    ):
        shutil.copyfile(SOURCE / "png/logo-bilingual.png", docs / filename)
    (docs / "octop-logo.svg").write_text(
        svg_logo(SOURCE / "png/mark-orange.png", name), encoding="utf-8"
    )


def bee(phase: float = 0, typing: bool = False) -> Image.Image:
    image = Image.new("RGBA", (512, 512))
    draw = ImageDraw.Draw(image)
    bob = round(math.sin(phase) * 7)
    flutter = round(math.sin(phase * 2) * 13)
    draw.ellipse((176, 408, 342, 436), fill=(23, 32, 51, 22))
    draw.ellipse((102, 177 + flutter, 244, 299 + flutter), fill="#FDEBC4", outline=AMBER, width=5)
    draw.ellipse((278, 177 - flutter, 420, 299 - flutter), fill="#FDEBC4", outline=AMBER, width=5)
    draw.line([(227, 189 + bob), (205, 142 + bob)], fill=NAVY, width=7)
    draw.line([(291, 189 + bob), (313, 142 + bob)], fill=NAVY, width=7)
    draw.ellipse((196, 133 + bob, 214, 151 + bob), fill=AMBER)
    draw.ellipse((304, 133 + bob, 322, 151 + bob), fill=AMBER)
    draw.rounded_rectangle((177, 178 + bob, 341, 383 + bob), radius=81, fill=AMBER)
    draw.rounded_rectangle((181, 294 + bob, 337, 320 + bob), radius=12, fill=NAVY)
    draw.rounded_rectangle((196, 344 + bob, 322, 367 + bob), radius=10, fill=NAVY)
    for x in (228, 290):
        draw.ellipse((x - 9, 230 + bob, x + 9, 253 + bob), fill=NAVY)
        draw.ellipse((x - 3, 232 + bob, x + 2, 237 + bob), fill=WHITE)
    draw.arc((241, 251 + bob, 277, 275 + bob), 8, 172, fill=NAVY, width=4)
    if typing:
        draw.rounded_rectangle((163, 376, 357, 415), radius=10, fill=NAVY)
        for row in range(2):
            for column in range(8):
                x, y = 178 + column * 21, 386 + row * 12
                draw.rounded_rectangle((x, y, x + 13, y + 5), radius=2, fill="#FDEBC4")
    for x, y, radius in [(116, 112, 15), (404, 344, 13), (383, 102, 10)]:
        draw.polygon(hex_points(x, y, radius), fill=AMBER)
    return image


def main() -> None:
    profile = json.loads((ROOT / "src/octop/branding/profile.json").read_text(encoding="utf-8"))
    name = profile["name"]["en"]
    DEST.mkdir(parents=True, exist_ok=True)
    import_logos(name)
    bee().save(DEST / "octop-mascot-empty.png")
    bee(typing=True).save(DEST / "octop-mascot-tasks.png")
    for filename, typing in [("octop-mascot-peek.webp", False), ("octop-mascot-type.webp", True)]:
        frames = [bee(index * math.tau / 24, typing) for index in range(24)]
        frames[0].save(
            DEST / filename,
            save_all=True,
            append_images=frames[1:],
            duration=80,
            loop=0,
            quality=90,
            method=6,
        )
    print(f"Built HiveWork artwork: {DEST}")


if __name__ == "__main__":
    main()
