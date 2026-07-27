#!/usr/bin/env python3
"""Génère des clips SMS Novia animés (plan 3) — 100 % local, sans API."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from config import CLIPS_DIR, CLIPS_JSON, LOCAL_CLIPS_DIR, PUB_FPS, PUB_HEIGHT, PUB_WIDTH
from utils import load_json, save_json, setup_logging

log = setup_logging("sms_mockups", "00_sms_mockups.log")

MOCKUPS = [
    {
        "file": "sms_novia_plombier_01.mp4",
        "business": "Plomberie Tremblay",
        "incoming": "Bonjour! Ici Léa, de Plomberie Tremblay. Désolé, on a manqué votre appel! Répondez à ce texto.",
        "reply": "Fuite sous l'évier, c'est urgent!",
        "confirm": "Parfait! Disponible demain 8h? Répondez OUI pour confirmer.",
    },
    {
        "file": "sms_novia_garage_01.mp4",
        "business": "Garage Auto Pro",
        "incoming": "Bonjour! Ici Léa, de Garage Auto Pro. Désolé, on a manqué votre appel! Répondez à ce texto.",
        "reply": "Mon auto fait un bruit au freinage.",
        "confirm": "On vous book mercredi 14h. Ça vous convient?",
    },
    {
        "file": "sms_novia_electro_01.mp4",
        "business": "Électro Lévis",
        "incoming": "Bonjour! Ici Léa, de Électro Lévis. Désolé, on a manqué votre appel! Répondez à ce texto.",
        "reply": "Prise qui chauffe dans la cuisine.",
        "confirm": "Technicien vendredi matin. On confirme?",
    },
    {
        "file": "sms_novia_reno_01.mp4",
        "business": "Réno Québec Plus",
        "incoming": "Bonjour! Ici Léa, de Réno Québec Plus. Désolé, on a manqué votre appel! Répondez à ce texto.",
        "reply": "Refaire la salle de bain complète.",
        "confirm": "Visite gratuite lundi! On vous envoie l'heure?",
    },
]

DURATION = 8.0


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    paths = [
        Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf") if bold else Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for p in paths:
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def _draw_phone_frame(
    t: float,
    business: str,
    incoming: str,
    reply: str,
    confirm: str,
) -> np.ndarray:
    w, h = PUB_WIDTH, PUB_HEIGHT
    img = Image.new("RGB", (w, h), (18, 18, 22))
    draw = ImageDraw.Draw(img)

    # Phone bezel
    pw, ph = 920, 1680
    px, py = (w - pw) // 2, (h - ph) // 2 + 40
    draw.rounded_rectangle([px, py, px + pw, py + ph], radius=48, fill=(28, 28, 30), outline=(60, 60, 65), width=4)

    # Status bar
    draw.rectangle([px + 20, py + 20, px + pw - 20, py + 70], fill=(28, 28, 30))
    draw.text((px + pw // 2 - 30, py + 28), "9:41", font=_font(28), fill=(200, 200, 200))

    # Header
    hdr_y = py + 80
    draw.rectangle([px, hdr_y, px + pw, hdr_y + 90], fill=(40, 40, 44))
    draw.text((px + pw // 2 - len(business) * 7, hdr_y + 28), business[:22], font=_font(32, True), fill=(255, 255, 255))

    chat_top = hdr_y + 100
    chat_bottom = py + ph - 120
    draw.rectangle([px, chat_top, px + pw, chat_bottom], fill=(22, 22, 26))

    f_sm, f_md = _font(26), _font(30)
    margin = px + 40
    max_bubble = pw - 120
    y = chat_top + 30

    def bubble(text: str, incoming_msg: bool, show: bool):
        nonlocal y, draw
        if not show:
            return
        lines = []
        words = text.split()
        line = ""
        for word in words:
            test = f"{line} {word}".strip()
            bbox = draw.textbbox((0, 0), test, font=f_md)
            if bbox[2] - bbox[0] <= max_bubble - 40:
                line = test
            else:
                lines.append(line)
                line = word
        if line:
            lines.append(line)
        bh = len(lines) * 38 + 28
        bw = min(max_bubble, max(draw.textbbox((0, 0), ln, font=f_md)[2] for ln in lines) + 40)
        bx = margin if incoming_msg else px + pw - margin - bw
        color = (55, 55, 60) if incoming_msg else (0, 122, 255)
        draw.rounded_rectangle([bx, y, bx + bw, y + bh], radius=22, fill=color)
        ty = y + 14
        for ln in lines:
            draw.text((bx + 20, ty), ln, font=f_md, fill=(255, 255, 255))
            ty += 38
        y += bh + 20

    bubble(incoming, True, t >= 0.3)
    bubble(reply, False, t >= 2.5)
    bubble(confirm, True, t >= 4.8)

    if t < 1.2:
        ny = py + 100
        draw.rounded_rectangle([px + 30, ny, px + pw - 30, ny + 100], radius=20, fill=(40, 40, 45))
        draw.text((px + 60, ny + 20), "Message — " + business[:18], font=f_sm, fill=(255, 255, 255))
        draw.text((px + 60, ny + 52), "On a vu votre appel manqué", font=f_sm, fill=(180, 180, 185))

    # Novia watermark
    draw.text((px + pw // 2 - 55, py + ph - 70), "via Novia", font=_font(22), fill=(100, 100, 110))
    return np.array(img)


def render_mockup(spec: dict, dest: Path) -> None:
    try:
        from moviepy import ImageSequenceClip
    except ImportError:
        from moviepy.editor import ImageSequenceClip

    n_frames = int(DURATION * PUB_FPS)
    frames = [
        _draw_phone_frame(
            i / PUB_FPS,
            spec["business"],
            spec["incoming"],
            spec["reply"],
            spec["confirm"],
        )
        for i in range(n_frames)
    ]
    clip = ImageSequenceClip(frames, fps=PUB_FPS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    clip.write_videofile(str(dest), fps=PUB_FPS, codec="libx264", audio=False, logger=None)
    clip.close()
    log.info("Mockup SMS → %s", dest.name)


def register_in_catalog(clips: list, spec: dict, dest: Path) -> list:
    clips = [c for c in clips if c.get("filename") != spec["file"]]
    clips.append({
        "filename": spec["file"],
        "path": str(dest.relative_to(CLIPS_DIR.parent)),
        "scene": "sms",
        "term": "novia_mockup",
        "source": "local",
        "pexels_id": None,
        "duration": DURATION,
        "width": PUB_WIDTH,
        "height": PUB_HEIGHT,
        "priority": 100,
    })
    return clips


def main() -> int:
    LOCAL_CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    catalog = load_json(CLIPS_JSON, {"clips": []}) or {"clips": []}
    all_clips = list(catalog.get("clips", []))

    for spec in MOCKUPS:
        dest = LOCAL_CLIPS_DIR / spec["file"]
        log.info("Génère mockup %s", spec["file"])
        try:
            render_mockup(spec, dest)
            all_clips = register_in_catalog(all_clips, spec, dest)
        except Exception as e:
            log.error("Échec %s: %s", spec["file"], e)
            return 1

    save_json(CLIPS_JSON, {"clips": all_clips, "scenes": ["call", "busy", "sms", "result"]})
    log.info("OK — %s mockups SMS Novia dans %s", len(MOCKUPS), LOCAL_CLIPS_DIR)
    return 0


if __name__ == "__main__":
    sys.exit(main())
