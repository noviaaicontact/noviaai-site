#!/usr/bin/env python3
"""Pub style HighLevel — vrais clips Pexels + mockup SMS + démo dashboard."""
from __future__ import annotations

import shutil
import sys
from datetime import datetime
from pathlib import Path

from config import PUBS_DIR
from generate_pubs import build_pub, load_scenes
from generate_pub_master import append_dashboard
from utils import setup_logging

log = setup_logging("pub_highlevel", "pub_highlevel.log")
SITE_ROOT = Path(__file__).resolve().parent.parent.parent

HIGHLEVEL_SCRIPT = {
    "id": "highlevel",
    "titre": "Style HighLevel — appels + vie",
    "metier": "plombier",
    "plans": [
        {"scene": "call", "texte": "Tes clients appellent. Toi, t'as une vie."},
        {"scene": "busy", "texte": "T'es en job. Personne ne répond."},
        {"scene": "sms", "texte": "NoviaAI envoie un texto. L'agent IA répond."},
        {"scene": "result", "texte": "RDV booké. Essai gratuit → noviaai.ca"},
    ],
}


def latest_dashboard_clip() -> Path | None:
    demo_dir = SITE_ROOT / "marketing" / "demo-videos"
    if not demo_dir.exists():
        return None
    files = sorted(demo_dir.glob("demo-appel-manque-*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def main() -> int:
    from utils import load_secrets_into_env

    load_secrets_into_env()
    log.info("=== Pub NoviaAI style HighLevel ===")
    scenes = load_scenes()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    PUBS_DIR.mkdir(parents=True, exist_ok=True)

    pub_main = PUBS_DIR / f"pub_highlevel_{stamp}.mp4"
    build_pub(HIGHLEVEL_SCRIPT, scenes, pub_index=0, out_path=pub_main)

    dash = latest_dashboard_clip()
    pub_final = PUBS_DIR / f"pub_highlevel_COMPLETE_{stamp}.mp4"

    if dash and dash.exists():
        log.info("Fusion avec démo dashboard…")
        append_dashboard(pub_main, dash, pub_final)
        latest = PUBS_DIR / "pub_highlevel_LATEST.mp4"
        shutil.copy2(pub_final, latest)
        log.info("✅ %s", latest)
    else:
        latest = PUBS_DIR / "pub_highlevel_LATEST.mp4"
        shutil.copy2(pub_main, latest)
        log.info("✅ %s (sans dashboard)", latest)

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log.error("Échec: %s", e)
        sys.exit(1)
