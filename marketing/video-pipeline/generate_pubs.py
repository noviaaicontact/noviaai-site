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
    bar_top = int(height * 0.62)
    draw.rectangle([0, bar_top, width, height], fill=(0, 0, 0, 185))
    margin = 40
    lines = wrap_text(draw, text, font, width - margin * 2)
    line_h = font_size + 12
    total_h = len(lines) * line_h
    y = bar_top + max((height - bar_top - total_h) // 2, 20)
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        x = (width - (bbox[2] - bbox[0])) // 2
        draw.text((x + 2, y + 2), line, font=font, fill=(0, 0, 0, 200))
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


def pick_clip(scenes: dict[str, list], scene: str, pub_index: int, plan_index: int, metier: str = "") -> Path:
    pool = scenes.get(scene) or []
    if not pool:
        raise ValueError(f"Aucun clip pour la scène « {scene} »")

    if scene == "sms" and metier:
        tag = {
            "plombier": "plombier",
            "garagiste": "garage",
            "électricien": "electro",
            "electricien": "electro",
            "rénovation": "reno",
            "renovation": "reno",
        }.get(metier.lower(), "")
        if tag:
            for m in pool:
                if tag in m.get("filename", "").lower() or tag in m.get("selection_file", "").lower():
                    path = SELECTION_DIR / m["selection_file"]
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
