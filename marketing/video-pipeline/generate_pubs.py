#!/usr/bin/env python3
"""Étape 3 — Pubs narratives 4 plans : appel → occupé → SMS → dénouement."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from config import (
    PLAN_DURATIONS,
    PUB_COUNT,
    PUB_FPS,
    PUB_HEIGHT,
    PUBS_DIR,
    PUB_WIDTH,
    SCRIPTS_JSON,
    SELECTION_DIR,
    SELECTION_JSON,
)
from utils import load_json, setup_logging

log = setup_logging("generate_pubs", "03_generate.log")

try:
    from moviepy import CompositeVideoClip, ImageClip, VideoFileClip, concatenate_videoclips
except ImportError:
    from moviepy.editor import CompositeVideoClip, ImageClip, VideoFileClip, concatenate_videoclips


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


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for p in [
        Path("C:/Windows/Fonts/segoeuib.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]:
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


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


def render_text_frame(text: str, width: int, height: int, font_size: int = 52) -> np.ndarray:
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = _font(font_size)
    grad_top = int(height * 0.52)
    for y in range(grad_top, height):
        t = (y - grad_top) / max(height - grad_top, 1)
        alpha = int(210 * t)
        draw.line([(0, y), (width, y)], fill=(0, 0, 0, alpha))
    margin = 48
    lines = wrap_text(draw, text, font, width - margin * 2)
    line_h = font_size + 14
    total_h = len(lines) * line_h
    y = height - total_h - 72
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        x = (width - (bbox[2] - bbox[0])) // 2
        for dx, dy in [(-2, 0), (2, 0), (0, -2), (0, 2)]:
            draw.text((x + dx, y + dy), line, font=font, fill=(0, 0, 0, 180))
        draw.text((x, y), line, font=font, fill=(255, 255, 255, 255))
        y += line_h
    return np.array(img)


def fit_portrait(clip, w: int = PUB_WIDTH, h: int = PUB_HEIGHT):
    scale = max(w / clip.w, h / clip.h)
    clip = clip.resized(scale) if hasattr(clip, "resized") else clip.resize(scale)
    cx, cy = clip.w / 2, clip.h / 2
    if hasattr(clip, "cropped"):
        return clip.cropped(x_center=cx, y_center=cy, width=w, height=h)
    return clip.crop(x_center=cx, y_center=cy, width=w, height=h)


def prepare_scene_clip(path: Path, duration: float):
    clip = VideoFileClip(str(path))
    clip = fit_portrait(clip)
    if clip.duration >= duration:
        start = max(0.0, (clip.duration - duration) / 2)
        clip = _subclip(clip, start, start + duration)
    else:
        loops = int(duration / max(clip.duration, 0.1)) + 1
        clip = concatenate_videoclips([clip] * loops)
        clip = _subclip(clip, 0, duration)
    return _with_fps(_no_audio(clip), PUB_FPS)


def text_overlay_clip(text: str, start: float, end: float, font_size: int = 52):
    ic = ImageClip(render_text_frame(text, PUB_WIDTH, PUB_HEIGHT, font_size))
    return _with_start(_with_duration(ic, end - start), start)


def load_scenes() -> dict[str, list[dict]]:
    data = load_json(SELECTION_JSON)
    if not data or not data.get("scenes"):
        log.error("selection.json invalide — lancez select_clips.py")
        sys.exit(1)
    return data["scenes"]


METIER_TAGS = {
    "plombier": ["plombier", "plumb", "sink", "pipe"],
    "garagiste": ["garage", "mechanic", "hood", "car"],
    "salon": ["salon", "hair", "stylist", "cut", "coiff"],
    "électricien": ["electro", "electric", "wire"],
    "electricien": ["electro", "electric", "wire"],
    "rénovation": ["reno", "construction"],
    "renovation": ["reno", "construction"],
}


def _clip_blob(meta: dict) -> str:
    return " ".join(
        str(meta.get(k, "")) for k in ("filename", "term", "selection_file", "path")
    ).lower()


def _matches_metier(meta: dict, metier: str) -> bool:
    tags = METIER_TAGS.get(metier.lower(), [])
    if not tags:
        return False
    blob = _clip_blob(meta)
    return any(t in blob for t in tags)


def pick_clip(scenes: dict[str, list], scene: str, pub_index: int, plan_index: int, metier: str = "") -> Path:
    pool = scenes.get(scene) or []
    if not pool:
        raise ValueError(f"Aucun clip pour la scène « {scene} »")

    if metier:
        if scene == "sms":
            for m in pool:
                if m.get("source") == "local" and "novia" in m.get("filename", "").lower():
                    if _matches_metier(m, metier):
                        path = SELECTION_DIR / m["selection_file"]
                        if path.exists():
                            return path
        elif scene in ("busy", "result", "call"):
            matched = [m for m in pool if _matches_metier(m, metier)]
            if matched:
                meta = matched[pub_index % len(matched)]
                path = SELECTION_DIR / meta["selection_file"]
                if path.exists():
                    return path

    meta = pool[(pub_index + plan_index) % len(pool)]
    path = SELECTION_DIR / meta["selection_file"]
    if not path.exists():
        path = Path(meta.get("source_path", ""))
    return path


def build_pub(script: dict, scenes: dict[str, list], pub_index: int, out_path: Path) -> None:
    plans = script.get("plans") or []
    if len(plans) != 4:
        raise ValueError(f"Script {script.get('id')} doit avoir 4 plans")

    log.info("Génère %s — %s", out_path.name, script.get("titre", ""))
    parts = []
    overlays = []
    t = 0.0
    opened = []

    for i, (plan, dur) in enumerate(zip(plans, PLAN_DURATIONS)):
        scene = plan["scene"]
        texte = plan.get("texte", "")
        clip_path = pick_clip(scenes, scene, pub_index, i, script.get("metier", ""))
        log.info("  Plan %s [%s] ← %s (%.0fs)", i + 1, scene, clip_path.name, dur)
        seg = prepare_scene_clip(clip_path, dur)
        parts.append(seg)
        opened.append(seg)
        fs = 58 if len(texte) <= 30 else 48
        overlays.append(text_overlay_clip(texte, t, t + dur, fs))
        t += dur

    video = concatenate_videoclips(parts, method="compose")
    final = CompositeVideoClip([video, *overlays], size=(PUB_WIDTH, PUB_HEIGHT))
    final = _with_duration(final, t)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    final.write_videofile(
        str(out_path),
        fps=PUB_FPS,
        codec="libx264",
        audio=False,
        preset="medium",
        threads=4,
        logger=None,
    )
    video.close()
    final.close()
    for c in opened:
        c.close()


def main() -> int:
    scripts_data = load_json(SCRIPTS_JSON)
    if not scripts_data or not scripts_data.get("scripts"):
        log.error("scripts.json manquant")
        return 1

    scenes = load_scenes()
    scripts = scripts_data["scripts"][:PUB_COUNT]
    PUBS_DIR.mkdir(parents=True, exist_ok=True)

    for i, script in enumerate(scripts, 1):
        out = PUBS_DIR / f"pub_{i:02d}.mp4"
        try:
            build_pub(script, scenes, i - 1, out)
        except Exception as e:
            log.error("Échec pub_%02d: %s", i, e)
            return 1

    log.info("Étape 3 OK — %s pubs narratives dans %s", len(scripts), PUBS_DIR)
    return 0


if __name__ == "__main__":
    sys.exit(main())
