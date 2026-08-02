#!/usr/bin/env python3
"""Assemble a single ad scene without Runway (Pexels b-roll + MoviePy overlays)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VIDEO_PIPELINE = ROOT.parent / "video-pipeline"
sys.path.insert(0, str(VIDEO_PIPELINE))

from ghl_compositor import (  # noqa: E402
    _import_moviepy,
    _no_audio,
    _with_fps,
    broll_clip,
    karaoke_caption_clip,
    overlay_on_clip,
    write_pub,
)
from utils import setup_logging  # noqa: E402

log = setup_logging("build_scene", "build_scene.log")

STORYBOARD_DIR = ROOT / "output" / "production" / "noviaai_storyboard_pro_5scenes"
STORYBOARD = STORYBOARD_DIR / "STORYBOARD_PRO.json"
SITE_ROOT = ROOT.parent.parent
MUSIC_PATH = SITE_ROOT / "marketing" / "assets-pub" / "ghl-bg.mp3"

# Scene 1 — busy trades worker (Pexels, no Runway)
SCENE1_BROLL = VIDEO_PIPELINE / "clips" / "busy_plumber_under_sink_01.mp4"
SCENE1_BROLL_ALT = [
    VIDEO_PIPELINE / "clips" / "busy_plumber_under_sink_02.mp4",
    VIDEO_PIPELINE / "clips" / "busy_plumber_under_sink_03.mp4",
]


def _scene_duration(scene: dict) -> float:
    if scene.get("duree_s"):
        return float(scene["duree_s"])
    timing = scene.get("timing", "4")
    part = timing.replace("s", "").strip()
    if ":" in part and "-" in part:
        a, b = part.split("-", 1)

        def _to_sec(t: str) -> float:
            if ":" in t:
                m, s = t.split(":", 1)
                return float(m) * 60 + float(s)
            return float(t)

        return _to_sec(b.strip()) - _to_sec(a.strip())
    if "-" in part:
        a, b = part.split("-", 1)
        return float(b) - float(a)
    return float(part)


def _scene_caption(scene: dict) -> str:
    if scene.get("texte_ecran"):
        return scene["texte_ecran"]
    montage = scene.get("montage") or {}
    return montage.get("texte_ecran", "")


def _fade_in_duration(scene: dict) -> float:
    montage = scene.get("montage") or {}
    transition = montage.get("transition_entree", "")
    if "fade_in" in transition:
        for token in transition.replace("fade_in", "").split():
            token = token.replace("s", "").strip()
            if token:
                try:
                    return float(token)
                except ValueError:
                    pass
    return 0.0


def _apply_fade_in(clip, fade_s: float):
    if fade_s <= 0:
        return clip
    _, _, VideoClip, _, _ = _import_moviepy()
    import numpy as np

    def make_frame(t):
        frame = clip.get_frame(t)
        if t < fade_s:
            alpha = t / fade_s
            return (frame.astype(np.float32) * alpha).astype(np.uint8)
        return frame

    out = VideoClip(make_frame, duration=clip.duration)
    return _with_fps(_no_audio(out), 30)


def _resolve_broll(scene: dict) -> Path:
    scene_num = scene["numero"]
    broll_file = scene.get("broll_file")
    if broll_file:
        path = VIDEO_PIPELINE / "clips" / broll_file
        if path.exists():
            return path

    if scene_num == 1:
        if SCENE1_BROLL.exists():
            return SCENE1_BROLL
        for alt in SCENE1_BROLL_ALT:
            if alt.exists():
                return alt

    try:
        from generate_pub_ghl import resolve_plumber_broll

        return resolve_plumber_broll()
    except Exception:
        pass
    raise FileNotFoundError(f"No Pexels b-roll found for scene {scene_num}")


def build_scene(
    scene_num: int,
    *,
    storyboard_path: Path | None = None,
    with_music: bool = False,
) -> Path:
    sb_path = storyboard_path or STORYBOARD
    sb = json.loads(sb_path.read_text(encoding="utf-8"))
    scene = next(s for s in sb["scenes"] if s["numero"] == scene_num)
    duration = _scene_duration(scene)
    caption = _scene_caption(scene)
    fade_s = _fade_in_duration(scene)

    broll_path = _resolve_broll(scene)
    log.info(
        "Scene %s — Pexels b-roll: %s (%.1fs, no Runway, fade_in=%.1fs)",
        scene_num,
        broll_path.name,
        duration,
        fade_s,
    )

    clip = broll_clip(broll_path, duration)
    if fade_s > 0:
        clip = _apply_fade_in(clip, fade_s)
    if caption:
        cap = karaoke_caption_clip(caption, duration)
        clip = overlay_on_clip(clip, cap)

    out_dir = sb_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"scene_{scene_num:02d}_LATEST.mp4"
    music = MUSIC_PATH if with_music and MUSIC_PATH.exists() else None
    write_pub([clip], out, music)
    log.info("Scene %s exported: %s", scene_num, out)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Build a single ad scene without Runway")
    ap.add_argument("scene", type=int, help="Scene number (1-5)")
    ap.add_argument("--storyboard", type=Path, default=STORYBOARD)
    ap.add_argument("--music", action="store_true", help="Add background music")
    args = ap.parse_args()
    build_scene(args.scene, storyboard_path=args.storyboard, with_music=args.music)
    return 0


if __name__ == "__main__":
    sys.exit(main())
