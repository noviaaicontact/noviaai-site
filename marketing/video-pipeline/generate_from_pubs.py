#!/usr/bin/env python3
"""Génère les pubs MP4 à partir de pubs.json et pub-modele.json (MoviePy)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from config import CLIPS_DIR, LOCAL_CLIPS_DIR, PUBS_DIR
from utils import load_json, setup_logging

log = setup_logging("generate_from_pubs", "04_generate_pubs.log")

ROOT = Path(__file__).resolve().parent
PUB_MODELE_JSON = ROOT / "pub-modele.json"
PUBS_JSON = ROOT / "pubs.json"
FONTS_DIR = ROOT / "fonts"

try:
    from moviepy import CompositeVideoClip, ImageClip, ImageSequenceClip, VideoFileClip, concatenate_videoclips
except ImportError:
    from moviepy.editor import CompositeVideoClip, ImageClip, ImageSequenceClip, VideoFileClip, concatenate_videoclips


def _subclip(clip, t0: float, t1: float):
    if hasattr(clip, "subclipped"):
        return clip.subclipped(t0, t1)
    return clip.subclip(t0, t1)


def _with_fps(clip, fps: int):
    if hasattr(clip, "with_fps"):
        return clip.with_fps(fps)
    return clip.set_fps(fps)


def _with_duration(clip, duration: float):
    if hasattr(clip, "with_duration"):
        return clip.with_duration(duration)
    return clip.set_duration(duration)


def _with_start(clip, start: float):
    if hasattr(clip, "with_start"):
        return clip.with_start(start)
    return clip.set_start(start)


def _no_audio(clip):
    if hasattr(clip, "without_audio"):
        return clip.without_audio()
    return clip.with_audio(None)


def parse_resolution(resolution: str) -> tuple[int, int]:
    w, h = resolution.lower().split("x")
    return int(w), int(h)


def parse_hex_color(value: str) -> tuple[int, int, int, int]:
    value = value.strip()
    if value.startswith("#"):
        value = value[1:]
    if len(value) == 6:
        r, g, b = int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)
        return r, g, b, 255
    raise ValueError(f"Couleur invalide: {value}")


def parse_bande_opacity(bande_fond: str) -> int:
    match = re.search(r"(\d+)\s*%", bande_fond)
    if match:
        return int(int(match.group(1)) * 255 / 100)
    return int(0.6 * 255)


def find_font(police: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        FONTS_DIR / "Montserrat-Bold.ttf",
        FONTS_DIR / "MontserratBold.ttf",
        Path("C:/Windows/Fonts/Montserrat-Bold.ttf"),
        Path("/usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf"),
        Path("/Library/Fonts/Montserrat-Bold.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    if police:
        slug = police.lower().replace(" ", "-")
        candidates.insert(0, FONTS_DIR / f"{slug}.ttf")
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def resolve_clip(name: str) -> Path:
    """Cherche un clip dans /clips (et /clips/local) par nom exact ou partiel."""
    if not name:
        raise ValueError("Nom de clip vide")

    direct = [CLIPS_DIR / name, LOCAL_CLIPS_DIR / name]
    for path in direct:
        if path.exists():
            return path

    stem = Path(name).stem
    search_dirs = [CLIPS_DIR, LOCAL_CLIPS_DIR]
    patterns = [
        f"*{name}*",
        f"*{stem}*",
        f"*_{stem}.mp4",
        f"*{stem.replace('_', '*')}*",
    ]
    for folder in search_dirs:
        if not folder.exists():
            continue
        for pattern in patterns:
            matches = sorted(folder.glob(pattern))
            if matches:
                return matches[0]

    prefixes = ("call_", "busy_", "sms_", "result_")
    for prefix in prefixes:
        candidate = CLIPS_DIR / f"{prefix}{name}"
        if candidate.exists():
            return candidate
        candidate = CLIPS_DIR / f"{prefix}{stem}.mp4"
        if candidate.exists():
            return candidate

    raise FileNotFoundError(f"Clip introuvable: {name} (dossier {CLIPS_DIR})")


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [text]


def render_text_rgba(
    text: str,
    width: int,
    height: int,
    style: dict,
    alpha: float = 1.0,
    y_offset: int = 0,
) -> np.ndarray:
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    font_size = int(style.get("taille", 90))
    font = find_font(style.get("police", "Montserrat Bold"), font_size)
    fill = parse_hex_color(style.get("couleur", "#FFFFFF"))
    stroke = parse_hex_color(style.get("contour", "#000000"))
    band_alpha = parse_bande_opacity(style.get("bande_fond", "noir 60% opacite"))

    margin = 48
    max_text_w = width - margin * 2
    lines = wrap_text(draw, text, font, max_text_w)
    line_h = font_size + 16
    block_h = len(lines) * line_h + 40

    if style.get("position") == "centre-haut":
        block_top = int(height * 0.08) + y_offset
    else:
        block_top = int(height * 0.08) + y_offset

    band_top = max(block_top - 20, 0)
    band_bottom = min(band_top + block_h, height)
    draw.rectangle([0, band_top, width, band_bottom], fill=(0, 0, 0, band_alpha))

    y = band_top + 20
    text_alpha = max(0, min(255, int(255 * alpha)))
    fill_a = (*fill[:3], text_alpha)
    stroke_a = (*stroke[:3], text_alpha)

    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        line_w = bbox[2] - bbox[0]
        x = (width - line_w) // 2
        draw.text(
            (x, y),
            line,
            font=font,
            fill=fill_a,
            stroke_width=max(2, font_size // 30),
            stroke_fill=stroke_a,
        )
        y += line_h

    return np.array(img)


def fit_portrait(clip, w: int, h: int):
    scale = max(w / clip.w, h / clip.h)
    clip = clip.resized(scale) if hasattr(clip, "resized") else clip.resize(scale)
    cx, cy = clip.w / 2, clip.h / 2
    if hasattr(clip, "cropped"):
        return clip.cropped(x_center=cx, y_center=cy, width=w, height=h)
    return clip.crop(x_center=cx, y_center=cy, width=w, height=h)


def prepare_clip(path: Path, duration: float, fps: int, width: int, height: int):
    clip = VideoFileClip(str(path))
    clip = fit_portrait(clip, width, height)
    if clip.duration >= duration:
        start = max(0.0, (clip.duration - duration) / 2)
        clip = _subclip(clip, start, start + duration)
    else:
        loops = int(duration / max(clip.duration, 0.1)) + 1
        clip = concatenate_videoclips([clip] * loops)
        clip = _subclip(clip, 0, duration)
    return _with_fps(_no_audio(clip), fps)


def animated_text_overlay(
    text: str,
    animation: str,
    start: float,
    end: float,
    width: int,
    height: int,
    style: dict,
    fps: int,
):
    duration = end - start
    anim_dur = min(0.7, max(0.35, duration * 0.18))
    anim_frames = max(6, min(12, int(anim_dur * fps)))

    seq = []
    for i in range(anim_frames):
        progress = (i + 1) / anim_frames
        y_off = int(50 * (1.0 - progress)) if animation == "slide_up" else 0
        seq.append(render_text_rgba(text, width, height, style, alpha=progress, y_offset=y_off))

    anim = ImageSequenceClip(seq, fps=fps)
    anim = _with_duration(anim, anim_dur)

    hold = ImageClip(render_text_rgba(text, width, height, style, alpha=1.0), transparent=True)
    hold = _with_duration(hold, max(0.01, duration - anim_dur))

    text_clip = concatenate_videoclips([anim, hold], method="compose")
    return _with_start(_with_fps(text_clip, fps), start)


def build_pub(pub: dict, fmt: dict, style: dict, out_path: Path) -> None:
    width, height = parse_resolution(fmt["resolution"])
    fps = int(fmt["fps"])
    total = float(fmt.get("duree_totale", 25))

    plans = sorted(pub.get("plans") or [], key=lambda p: p.get("num", 0))
    if not plans:
        raise ValueError(f"Pub {pub.get('id')} sans plans")

    log.info("Génère %s (%s)", out_path.name, pub.get("metier", ""))
    parts = []
    opened: list = []

    for plan in plans:
        debut = float(plan["debut"])
        fin = float(plan["fin"])
        duration = fin - debut
        clip_path = resolve_clip(plan["clip"])
        log.info("  Plan %s ← %s (%.1fs)", plan.get("num"), clip_path.name, duration)

        seg = prepare_clip(clip_path, duration, fps, width, height)
        opened.append(seg)

        text = animated_text_overlay(
            plan.get("texte", ""),
            plan.get("animation_texte", "fade_in"),
            0,
            duration,
            width,
            height,
            style,
            fps,
        )
        opened.append(text)

        parts.append(CompositeVideoClip([seg, text], size=(width, height)))

    video = concatenate_videoclips(parts, method="compose")
    final = _with_duration(video, total)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    final.write_videofile(
        str(out_path),
        fps=fps,
        codec="libx264",
        audio=False,
        preset="ultrafast",
        threads=4,
        logger=None,
    )

    video.close()
    final.close()
    for c in opened:
        c.close()


def load_pubs() -> tuple[dict, dict, list[dict]]:
    modele = load_json(PUB_MODELE_JSON)
    if not modele or "format" not in modele or "style_texte" not in modele:
        log.error("pub-modele.json invalide")
        sys.exit(1)

    data = load_json(PUBS_JSON)
    if isinstance(data, list):
        pubs = data
    elif isinstance(data, dict) and "pubs" in data:
        pubs = data["pubs"]
    else:
        log.error("pubs.json doit être un tableau de pubs ou { \"pubs\": [...] }")
        sys.exit(1)

    if not pubs:
        log.error("pubs.json vide")
        sys.exit(1)

    return modele["format"], modele["style_texte"], pubs


def main() -> int:
    fmt, style, pubs = load_pubs()
    PUBS_DIR.mkdir(parents=True, exist_ok=True)

    for pub in pubs:
        pub_id = pub.get("id")
        if not pub_id:
            log.error("Pub sans id")
            return 1
        out = PUBS_DIR / f"{pub_id}.mp4"
        try:
            build_pub(pub, fmt, style, out)
        except Exception as e:
            log.error("Échec %s: %s", pub_id, e)
            return 1

    log.info("OK — %s pubs dans %s", len(pubs), PUBS_DIR)
    return 0


if __name__ == "__main__":
    sys.exit(main())
