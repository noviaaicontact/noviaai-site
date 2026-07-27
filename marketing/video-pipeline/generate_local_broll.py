#!/usr/bin/env python3
"""B-roll animé 100 % local (sans Pexels) — call, busy, result."""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from config import LOCAL_CLIPS_DIR, PUB_FPS, PUB_HEIGHT, PUB_WIDTH
from utils import setup_logging

log = setup_logging("local_broll", "00_local_broll.log")

SCENES = [
    {
        "file": "broll_call_01.mp4",
        "scene": "call",
        "title": "APPEL MANQUÉ",
        "subtitle": "Il compose. Ça sonne dans le vide.",
        "accent": (220, 60, 60),
        "icon": "📞",
    },
    {
        "file": "broll_busy_01.mp4",
        "scene": "busy",
        "title": "VOUS ÊTES OCCUPÉ",
        "subtitle": "Sous l'évier. Sous le capot. Impossible de répondre.",
        "accent": (255, 160, 40),
        "icon": "🔧",
    },
    {
        "file": "broll_result_01.mp4",
        "scene": "result",
        "title": "RDV BOOKÉ",
        "subtitle": "Texto → conversation → client qualifié",
        "accent": (40, 180, 100),
        "icon": "✅",
    },
]


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    paths = [
        Path("C:/Windows/Fonts/segoeuib.ttf") if bold else Path("C:/Windows/Fonts/segoeuib.ttf"),
        Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf") if bold else Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for p in paths:
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def render_scene_frame(spec: dict, t: float, duration: float) -> np.ndarray:
    w, h = PUB_WIDTH, PUB_HEIGHT
    progress = min(1.0, t / max(duration - 0.01, 0.01))
    pulse = 0.5 + 0.5 * math.sin(t * 4.5)

    img = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(img)
    r, g, b = spec["accent"]
    for y in range(h):
        ratio = y / h
        c1 = (int(12 + r * 0.08), int(14 + g * 0.06), int(22 + b * 0.05))
        c2 = (int(8 + r * 0.15 * pulse), int(10 + g * 0.12), int(18 + b * 0.1))
        col = tuple(int(_lerp(c1[i], c2[i], ratio)) for i in range(3))
        draw.line([(0, y), (w, y)], fill=col)

    # Accent glow
    cx, cy = w // 2, int(h * 0.38)
    radius = int(180 + 40 * pulse)
    for i in range(radius, 0, -4):
        alpha = int(35 * (1 - i / radius))
        draw.ellipse([cx - i, cy - i, cx + i, cy + i], fill=(r, g, b, alpha) if hasattr(draw, "ellipse") else (r // 4, g // 4, b // 4))

    icon_f = _font(120)
    title_f = _font(62, True)
    sub_f = _font(40)

    icon = spec["icon"]
    ib = draw.textbbox((0, 0), icon, font=icon_f)
    draw.text((cx - (ib[2] - ib[0]) // 2, cy - 90), icon, font=icon_f, fill=(255, 255, 255))

    title = spec["title"]
    tb = draw.textbbox((0, 0), title, font=title_f)
    tx = (w - (tb[2] - tb[0])) // 2
    ty = int(h * 0.52)
    draw.text((tx + 2, ty + 2), title, font=title_f, fill=(0, 0, 0))
    draw.text((tx, ty), title, font=title_f, fill=(255, 255, 255))

    sub = spec["subtitle"]
    lines = []
    words = sub.split()
    line = ""
    for word in words:
        test = f"{line} {word}".strip()
        bb = draw.textbbox((0, 0), test, font=sub_f)
        if bb[2] - bb[0] <= w - 100:
            line = test
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)

    y = ty + 90
    fade = min(1.0, progress * 2.5)
    sub_col = (int(220 * fade), int(225 * fade), int(235 * fade))
    for ln in lines:
        bb = draw.textbbox((0, 0), ln, font=sub_f)
        draw.text(((w - (bb[2] - bb[0])) // 2, y), ln, font=sub_f, fill=sub_col)
        y += 48

    # NoviaAI branding
    brand_f = _font(34, True)
    draw.text((w // 2 - 75, h - 120), "Novia", font=brand_f, fill=(255, 255, 255))
    draw.text((w // 2 + 10, h - 120), "AI", font=brand_f, fill=(r, g, b))
    draw.text((w // 2 - 95, h - 75), "noviaai.ca", font=_font(28), fill=(180, 185, 195))

    # Progress bar
    bar_w = int((w - 160) * progress)
    draw.rounded_rectangle([80, h - 40, w - 80, h - 24], radius=8, fill=(40, 44, 52))
    draw.rounded_rectangle([80, h - 40, 80 + bar_w, h - 24], radius=8, fill=(r, g, b))

    return np.array(img)


def render_clip(spec: dict, duration: float, dest: Path) -> None:
    try:
        from moviepy import ImageSequenceClip
    except ImportError:
        from moviepy.editor import ImageSequenceClip

    n = int(duration * PUB_FPS)
    frames = [render_scene_frame(spec, i / PUB_FPS, duration) for i in range(n)]
    clip = ImageSequenceClip(frames, fps=PUB_FPS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    clip.write_videofile(str(dest), fps=PUB_FPS, codec="libx264", audio=False, logger=None)
    clip.close()


def main() -> int:
    LOCAL_CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    durations = {"call": 4.0, "busy": 6.0, "result": 7.0}

    for spec in SCENES:
        dest = LOCAL_CLIPS_DIR / spec["file"]
        dur = durations.get(spec["scene"], 5.0)
        log.info("Génère %s (%.0fs)", dest.name, dur)
        render_clip(spec, dur, dest)

    log.info("OK — %s clips B-roll locaux", len(SCENES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
