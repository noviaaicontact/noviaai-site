#!/usr/bin/env python3
"""Pub style GoHighLevel — stats + cuts rapides + SMS plein écran + dashboard iPhone."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

from config import CLIPS_DIR, LOCAL_CLIPS_DIR, PUBS_DIR, SELECTION_DIR
from generate_pub_highlevel import latest_dashboard_clip
from generate_pubs import load_scenes, pick_clip
from select_clips import CLIP_BLOCKLIST, is_blocked_clip
from ghl_compositor import (
    broll_clip,
    cta_clip,
    dashboard_clip_for_source,
    karaoke_caption_clip,
    overlay_on_clip,
    product_fallback_clip,
    stat_clip,
    write_pub,
)
from utils import load_json, setup_logging

log = setup_logging("pub_ghl", "pub_ghl.log")

SITE_ROOT = Path(__file__).resolve().parent.parent.parent
ASSETS_DIR = SITE_ROOT / "marketing" / "assets-pub"
MUSIC_PATH = ASSETS_DIR / "ghl-bg.mp3"

GHL_PLOMBIER = {
    "slug": "plombier",
    "metier": "plombier",
    "sms_clip": "sms_novia_plombier_01.mp4",
    "segments": [
        {"type": "stat", "big": "60%", "sub": "de vos clients\nne rappellent jamais", "dur": 2.5, "hook": "Tu perds des jobs chaque semaine"},
        {"type": "broll", "scene": "busy", "caption": "Pendant que t'es en job…", "dur": 2.5},
        {"type": "sms", "dur": 7.0, "hook": "Texto automatique en 8 secondes"},
        {"type": "stat", "big": "8 sec", "sub": "NoviaAI envoie le texto\nautomatiquement", "dur": 2.5},
        {"type": "dashboard", "dur": 12.0, "hook": "Ton dashboard en direct"},
        {"type": "cta", "line1": "Essai gratuit 14 jours", "line2": "noviaai.ca", "dur": 2.5},
    ],
}


PLUMBER_TAGS = ("plumb", "pipe", "faucet", "repair", "plombier")
MANUAL_WORKER_TAGS = (
    "construction", "mechanic", "worker", "tools", "garage", "hood",
    "electric", "wire", "repair", "chantier", "toolbox", "manual",
    "contractor", "trades", "artisan",
)


def _clip_path(clip: dict, root: Path) -> Path | None:
    path = root / clip.get("path", "")
    if not path.exists():
        path = CLIPS_DIR / clip.get("filename", "")
    return path if path.exists() else None


def _rank_clips(clips: list[dict], tags: tuple[str, ...], root: Path) -> list[tuple[int, Path]]:
    out: list[tuple[int, Path]] = []
    for clip in clips:
        if is_blocked_clip(clip):
            continue
        blob = " ".join(str(clip.get(k, "")) for k in ("filename", "term", "path")).lower()
        if not any(t in blob for t in tags):
            continue
        path = _clip_path(clip, root)
        if not path:
            continue
        h = int(clip.get("height") or 0)
        bonus = 500 if clip.get("source") == "pixabay" else 0
        out.append((h + bonus, path))
    out.sort(reverse=True)
    return out


def resolve_plumber_broll() -> Path:
    """Plombier d'abord, sinon travailleur manuel (construction, mécanicien…)."""
    root = Path(__file__).resolve().parent
    catalog = load_json(root / "clips.json", {"clips": []}).get("clips", [])

    for tags, label in ((PLUMBER_TAGS, "plombier"), (MANUAL_WORKER_TAGS, "travailleur manuel")):
        ranked = _rank_clips(catalog, tags, root)
        if ranked:
            best = ranked[0][1]
            log.info("B-roll %s: %s", label, best.name)
            return best

    scenes = load_scenes()
    return pick_clip(scenes, "busy", 0, 0, "plombier")


def ensure_music() -> Path | None:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    if MUSIC_PATH.exists() and MUSIC_PATH.stat().st_size > 50000:
        return MUSIC_PATH
    try:
        import subprocess
        r = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "fetch_music.py")],
            cwd=str(Path(__file__).parent),
            capture_output=True,
            text=True,
        )
        if MUSIC_PATH.exists() and MUSIC_PATH.stat().st_size > 50000:
            return MUSIC_PATH
        log.warning("Pixabay musique: %s", r.stderr or r.stdout)
    except Exception as e:
        log.warning("Musique ignorée: %s", e)
    return None


def _maybe_hook(clip, seg: dict):
    hook = seg.get("hook")
    if not hook:
        return clip
    cap = karaoke_caption_clip(hook, clip.duration)
    return overlay_on_clip(clip, cap)


def build_ghl_pub(spec: dict) -> Path:
    from ghl_compositor import _import_moviepy

    _, _, _, VideoFileClip, _ = _import_moviepy()
    scenes = load_scenes()
    parts = []
    opened = []

    for seg in spec["segments"]:
        kind = seg["type"]
        dur = float(seg["dur"])

        if kind == "stat":
            clip = stat_clip(seg["big"], seg["sub"], dur)
        elif kind == "broll":
            path = resolve_plumber_broll()
            clip = broll_clip(path, dur, seg.get("caption", ""))
        elif kind == "sms":
            sms_path = LOCAL_CLIPS_DIR / spec["sms_clip"]
            if not sms_path.exists():
                raise FileNotFoundError(f"Mockup SMS manquant: {sms_path}")
            from ghl_compositor import _no_audio, _subclip, _with_fps

            raw = VideoFileClip(str(sms_path))
            if raw.duration >= dur:
                start = max(0.0, (raw.duration - dur) / 2)
                clip = _subclip(raw, start, start + dur)
            else:
                clip = _subclip(raw, 0, raw.duration)
            clip = _with_fps(_no_audio(clip), 30)
            opened.append(raw)
        elif kind == "dashboard":
            dash = latest_dashboard_clip()
            if dash and dash.exists():
                log.info("Dashboard vidéo: %s", dash.name)
                inner = VideoFileClip(str(dash))
                clip = dashboard_clip_for_source(inner, "Ton dashboard NoviaAI", dur)
                if clip.duration > dur:
                    clip = clip.subclipped(0, dur) if hasattr(clip, "subclipped") else clip.subclip(0, dur)
                opened.append(inner)
            else:
                log.info("Pas de démo dashboard — slide produit animé")
                clip = product_fallback_clip(dur)
        elif kind == "cta":
            clip = cta_clip(seg["line1"], seg["line2"], dur)
        else:
            raise ValueError(f"Segment inconnu: {kind}")

        clip = _maybe_hook(clip, seg)
        parts.append(clip)
        opened.append(clip)
        log.info("  + %s (%.0fs)", kind, dur)

    slug = spec["slug"]
    out = PUBS_DIR / f"pub_{slug}_ghl.mp4"
    music = ensure_music()
    write_pub(parts, out, music)
    for c in opened:
        try:
            c.close()
        except Exception:
            pass
    return out


def main() -> int:
    from utils import load_secrets_into_env

    load_secrets_into_env()
    log.info("=== Pub GHL — plombier ===")
    PUBS_DIR.mkdir(parents=True, exist_ok=True)

    out = build_ghl_pub(GHL_PLOMBIER)
    latest = PUBS_DIR / "pub_plombier_GHL_LATEST.mp4"
    shutil.copy2(out, latest)
    log.info("✅ %s", latest)

    txt = PUBS_DIR / "TEXTE-FACEBOOK-PLOMBIER-GHL.txt"
    txt.write_text(
        "Fuite à minuit et personne répond?\n"
        "60% de tes clients ne rappellent jamais.\n"
        "NoviaAI envoie un texto en 8 sec + agent IA qui qualifie.\n"
        "Essai gratuit 14 jours → noviaai.ca/signup?utm_source=facebook&utm_campaign=plombier-ghl\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log.exception("Échec: %s", e)
        sys.exit(1)
