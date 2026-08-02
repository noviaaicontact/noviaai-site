#!/usr/bin/env python3
"""Assemble la pub 30s NoviaAI depuis STORYBOARD_LATEST.json."""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VIDEO_PIPELINE = ROOT.parent / "video-pipeline"
sys.path.insert(0, str(VIDEO_PIPELINE))

from config import LOCAL_CLIPS_DIR, PUBS_DIR  # noqa: E402
from ghl_compositor import (  # noqa: E402
    broll_clip,
    cta_clip,
    dashboard_clip_for_source,
    fit_portrait,
    karaoke_caption_clip,
    overlay_on_clip,
    product_fallback_clip,
    stat_clip,
    write_pub,
    _import_moviepy,
    _no_audio,
    _subclip,
    _with_fps,
)
from openai_image import generate_image  # noqa: E402
from runway_guard import grant_runway_approval, is_runway_allowed  # noqa: E402
from runway_video import generate_video_from_image  # noqa: E402
from utils import load_secrets_into_env, setup_logging  # noqa: E402

log = setup_logging("pub_30s", "pub_30s.log")

OUT_DIR = ROOT / "output" / "noviaai_demo_pme"
STORYBOARD = OUT_DIR / "STORYBOARD_LATEST.json"
SITE_ROOT = ROOT.parent.parent
MUSIC_PATH = SITE_ROOT / "marketing" / "assets-pub" / "ghl-bg.mp3"
SMS_CLIP = LOCAL_CLIPS_DIR / "sms_novia_plombier_01.mp4"
PLOMBIER_VIDEO = ROOT / "output" / "plombier" / "plombier_LATEST.mp4"
PLOMBIER_IMAGE = ROOT / "output" / "plombier" / "plombier_LATEST.png"

NICHE_SMS = {
    "plombier": "sms_novia_plombier_01.mp4",
    "garage": "sms_novia_garage_01.mp4",
    "salon": "sms_novia_salon_01.mp4",
    "electricien": "sms_novia_electro_01.mp4",
}


def _scene_asset(scene: dict) -> str:
    if scene.get("asset"):
        return scene["asset"].lower()
    # Rétrocompat storyboards sans champ asset
    st = scene.get("scene_type", "")
    if "sms" in st:
        return "sms_mockup"
    if "stat" in st:
        return "stat"
    if "dashboard" in st:
        return "dashboard"
    if "cta" in st:
        return "cta"
    num = scene.get("numero", 0)
    if num == 3:
        return "sms_mockup"
    if num == 5:
        return "cta"
    return "runway"


def _sms_clip_for_storyboard(sb: dict) -> Path:
    niche = (sb.get("niche") or "plombier").lower()
    name = NICHE_SMS.get(niche, "sms_novia_plombier_01.mp4")
    path = LOCAL_CLIPS_DIR / name
    return path if path.exists() else LOCAL_CLIPS_DIR / "sms_novia_plombier_01.mp4"


def _parse_timing(timing: str) -> float:
    """Ex: '3-10s' -> 7.0"""
    part = timing.replace("s", "").strip()
    if "-" in part:
        a, b = part.split("-", 1)
        return float(b) - float(a)
    return float(part)


def _load_storyboard() -> dict:
    if not STORYBOARD.exists():
        raise FileNotFoundError(f"Storyboard manquant: {STORYBOARD}")
    return json.loads(STORYBOARD.read_text(encoding="utf-8"))


def _scene_assets(num: int) -> tuple[Path, Path]:
    return OUT_DIR / f"scene_{num}_LATEST.png", OUT_DIR / f"scene_{num}_LATEST.mp4"


def _resolve_broll_fallback(niche: str) -> Path | None:
    """Pexels/stock local — remplace Runway sans credits."""
    try:
        from generate_pub_ghl import resolve_plumber_broll

        return resolve_plumber_broll()
    except Exception:
        pass
    root = Path(__file__).resolve().parent.parent / "video-pipeline"
    local = root / "clips" / "local"
    if local.is_dir():
        for p in sorted(local.glob("*.mp4")):
            if p.name.startswith("sms_"):
                continue
            return p
    return None


def _broll_fallback_segment(duration: float, caption: str, niche: str):
    path = _resolve_broll_fallback(niche)
    if path and path.exists():
        log.info("Scene runway -> b-roll Pexels/local (%s)", path.name)
        return broll_clip(path, duration, caption)
    log.warning("Pas de b-roll — slide stat de secours")
    return _stat_segment(caption or "NoviaAI", duration, caption)


def _ensure_runway_scene(
    scene: dict,
    *,
    skip_images: bool,
    skip_runway: bool,
    reuse_scene1: bool,
    niche: str = "plombier",
) -> Path | None:
    num = scene["numero"]
    img_path, vid_path = _scene_assets(num)
    prompt_vid = scene.get("prompt_runway") or scene.get("prompt_video") or ""

    if num == 1 and reuse_scene1 and PLOMBIER_VIDEO.exists():
        if not vid_path.exists():
            shutil.copy2(PLOMBIER_VIDEO, vid_path)
        if PLOMBIER_IMAGE.exists() and not img_path.exists():
            shutil.copy2(PLOMBIER_IMAGE, img_path)
        log.info("Scene 1 — reutilise plombier_LATEST")
        return vid_path

    if vid_path.exists():
        return vid_path

    if skip_runway:
        log.info("Scene %s — Runway desactive (pas de credits)", num)
        return None

    if not skip_images and not img_path.exists():
        log.info("Scene %s — GPT Image…", num)
        generate_image(scene["prompt_image"], img_path)
    elif not img_path.exists():
        raise FileNotFoundError(f"Image manquante scene {num}: {img_path}")

    log.info("Scene %s — Runway (credits — approbation active)…", num)
    generate_video_from_image(
        img_path,
        prompt_vid,
        vid_path,
        duration=5,
    )
    return vid_path


def _runway_segment(path: Path, duration: float, caption: str):
    clip = broll_clip(path, duration)
    if caption:
        cap = karaoke_caption_clip(caption, duration)
        clip = overlay_on_clip(clip, cap)
    return clip


def _stat_segment(texte: str, duration: float, caption: str):
    lines = texte.replace("\\n", "\n").split("\n")
    big = lines[0] if lines else texte
    sub = "\n".join(lines[1:]) if len(lines) > 1 else ""
    clip = stat_clip(big, sub, duration)
    if caption and caption != texte:
        cap = karaoke_caption_clip(caption, duration)
        clip = overlay_on_clip(clip, cap)
    return clip


def _dashboard_segment(duration: float, caption: str):
    from generate_pub_highlevel import latest_dashboard_clip

    _, _, _, VideoFileClip, _ = _import_moviepy()
    dash = latest_dashboard_clip()
    if dash and dash.exists():
        inner = VideoFileClip(str(dash))
        clip = dashboard_clip_for_source(inner, "Ton dashboard NoviaAI", duration)
        if clip.duration > duration:
            clip = _subclip(clip, 0, duration)
    else:
        clip = product_fallback_clip(duration)
    if caption:
        cap = karaoke_caption_clip(caption, duration)
        clip = overlay_on_clip(clip, cap)
    return clip


def _cta_segment(texte: str, duration: float):
    lines = texte.replace("\\n", "\n").split("\n")
    line1 = lines[0] if lines else "Arrêtez de perdre des clients."
    line2 = lines[1] if len(lines) > 1 else "Demandez votre démonstration."
    return cta_clip(line1, line2, duration)


def _sms_segment(sms_path: Path, duration: float, caption: str):
    _, _, _, VideoFileClip, _ = _import_moviepy()
    if not sms_path.exists():
        raise FileNotFoundError(f"Mockup SMS manquant: {sms_path}")
    raw = VideoFileClip(str(sms_path))
    raw = fit_portrait(raw)
    if raw.duration >= duration:
        start = max(0.0, (raw.duration - duration) / 2)
        clip = _subclip(raw, start, start + duration)
    else:
        clip = _subclip(raw, 0, raw.duration)
    clip = _with_fps(_no_audio(clip), 30)
    if caption:
        cap = karaoke_caption_clip(caption, clip.duration)
        clip = overlay_on_clip(clip, cap)
    return clip


def _build_scene_clip(
    scene: dict,
    duration: float,
    *,
    sms_path: Path,
    skip_images: bool,
    skip_runway: bool,
    reuse_scene1: bool,
    niche: str = "plombier",
) -> object:
    asset = _scene_asset(scene)
    caption = scene.get("texte_ecran", "")

    if asset == "sms_mockup":
        return _sms_segment(sms_path, duration, caption)
    if asset == "stat":
        return _stat_segment(caption, duration, caption)
    if asset == "dashboard":
        return _dashboard_segment(duration, caption)
    if asset == "cta":
        return _cta_segment(caption, duration)

    vid_path = _ensure_runway_scene(
        scene,
        skip_images=skip_images,
        skip_runway=skip_runway,
        reuse_scene1=reuse_scene1,
        niche=niche,
    )
    if vid_path is None:
        return _broll_fallback_segment(duration, caption, niche)
    return _runway_segment(vid_path, duration, caption)


def build_pub_30s(
    *,
    skip_images: bool = True,
    skip_runway: bool = True,
    reuse_scene1: bool = True,
) -> Path:
    sb = _load_storyboard()
    scenes = sorted(sb["scenes"], key=lambda s: s["numero"])
    niche = sb.get("niche", "plombier")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sms_path = _sms_clip_for_storyboard(sb)
    framework = sb.get("framework_id", "custom")

    parts = []
    for scene in scenes:
        num = scene["numero"]
        dur = _parse_timing(scene["timing"])
        clip = _build_scene_clip(
            scene, dur,
            sms_path=sms_path,
            skip_images=skip_images,
            skip_runway=skip_runway,
            reuse_scene1=reuse_scene1 and num == 1,
            niche=niche,
        )
        parts.append(clip)
        log.info("Scene %s [%s] %.0fs", num, _scene_asset(scene), dur)

    out = OUT_DIR / "pub_30s_LATEST.mp4"
    music = MUSIC_PATH if MUSIC_PATH.exists() else None
    write_pub(parts, out, music)

    PUBS_DIR.mkdir(parents=True, exist_ok=True)
    slug = sb.get("niche", "noviaai").lower().replace(" ", "_")
    pubs_copy = PUBS_DIR / f"pub_{slug}_{framework}_30s_LATEST.mp4"
    shutil.copy2(out, pubs_copy)
    log.info("Pub 30s: %s", out)
    log.info("Copie: %s", pubs_copy)
    return out


def main() -> int:
    load_secrets_into_env()
    ap = argparse.ArgumentParser(description="Assemble pub NoviaAI 30s")
    ap.add_argument("--skip-images", action="store_true", default=True,
                    help="Ne pas appeler GPT Image (defaut)")
    ap.add_argument("--generate-images", action="store_true",
                    help="Generer les images GPT Image manquantes")
    ap.add_argument(
        "--allow-runway",
        action="store_true",
        help="AUTORISER Runway (consomme des credits — approbation explicite)",
    )
    ap.add_argument("--no-reuse-scene1", action="store_true", help="Regenerer scene 1")
    ap.add_argument("--storyboard", type=Path, help="Chemin STORYBOARD_LATEST.json")
    args = ap.parse_args()

    skip_runway = not args.allow_runway
    skip_images = not args.generate_images
    if args.allow_runway:
        grant_runway_approval()
        log.warning("Runway AUTORISE — credits seront consommes")
    else:
        log.info("Runway DESACTIVE par defaut (utilisez --allow-runway pour approuver)")

    global OUT_DIR, STORYBOARD
    if args.storyboard:
        STORYBOARD = args.storyboard
        OUT_DIR = args.storyboard.parent

    log.info("=== Pub NoviaAI 30s ===")
    build_pub_30s(
        skip_images=skip_images,
        skip_runway=skip_runway,
        reuse_scene1=not args.no_reuse_scene1,
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log.exception("Echec: %s", e)
        sys.exit(1)
