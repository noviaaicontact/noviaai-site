#!/usr/bin/env python3
"""Génère 3 pubs style HighLevel (plombier, garage, salon) — sans musique."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

from config import PUBS_DIR
from generate_pub_master import append_dashboard
from generate_pub_highlevel import latest_dashboard_clip
from generate_pubs import build_pub, load_scenes
from utils import setup_logging

log = setup_logging("pubs_3_niches", "pubs_3_niches.log")

NICHES = [
    {
        "slug": "plombier",
        "titre": "Plombier — appels manqués",
        "metier": "plombier",
        "plans": [
            {"scene": "call", "texte": "Fuite à minuit. Personne répond."},
            {"scene": "busy", "texte": "T'es sous l'évier. Pris."},
            {"scene": "sms", "texte": "NoviaAI texte. L'agent IA répond."},
            {"scene": "result", "texte": "RDV booké. Essai gratuit → noviaai.ca"},
        ],
        "pub_index": 0,
        "facebook": (
            "Fuite à minuit et personne répond?\n"
            "NoviaAI envoie un texto automatique + un agent IA qui qualifie le client.\n"
            "Essai gratuit 14 jours → noviaai.ca/signup?utm_source=facebook&utm_campaign=plombier"
        ),
    },
    {
        "slug": "garage",
        "titre": "Garage — appels manqués",
        "metier": "garagiste",
        "plans": [
            {"scene": "call", "texte": "Client sur l'autoroute. Ligne occupée."},
            {"scene": "busy", "texte": "T'es sous le capot. Impossible."},
            {"scene": "sms", "texte": "NoviaAI texte. Il répond quand même."},
            {"scene": "result", "texte": "RDV demain. Essai gratuit → noviaai.ca"},
        ],
        "pub_index": 1,
        "facebook": (
            "Un client appelle depuis l'autoroute. T'es sous un moteur.\n"
            "NoviaAI rattrape l'appel par SMS — 24/7.\n"
            "Essai gratuit 14 jours → noviaai.ca/signup?utm_source=facebook&utm_campaign=garage"
        ),
    },
    {
        "slug": "salon",
        "titre": "Salon — appels manqués",
        "metier": "salon",
        "plans": [
            {"scene": "call", "texte": "Elle veut un RDV. Ça sonne dans le vide."},
            {"scene": "busy", "texte": "T'es en coupe. Pas le temps."},
            {"scene": "sms", "texte": "NoviaAI texte. L'agent book le RDV."},
            {"scene": "result", "texte": "Client contente. Essai gratuit → noviaai.ca"},
        ],
        "pub_index": 2,
        "facebook": (
            "Elle veut un RDV pendant que t'es en coupe avec une cliente?\n"
            "NoviaAI répond par texto et ton agent IA gère la conversation.\n"
            "Essai gratuit 14 jours → noviaai.ca/signup?utm_source=facebook&utm_campaign=salon"
        ),
    },
]


def main() -> int:
    from utils import load_secrets_into_env

    load_secrets_into_env()
    log.info("=== 3 pubs NoviaAI v2 (HD + dashboard, sans musique) ===")
    scenes = load_scenes()
    PUBS_DIR.mkdir(parents=True, exist_ok=True)
    posts_path = PUBS_DIR / "TEXTES-FACEBOOK-3-PUBS.txt"
    dash = latest_dashboard_clip()

    lines = ["TEXTES FACEBOOK — copier-coller avec chaque vidéo", "=" * 50, ""]

    for niche in NICHES:
        slug = niche["slug"]
        out_main = PUBS_DIR / f"pub_{slug}_highlevel.mp4"
        out_complete = PUBS_DIR / f"pub_{slug}_COMPLETE.mp4"
        log.info("▶ %s", niche["titre"])
        build_pub(niche, scenes, pub_index=niche["pub_index"], out_path=out_main)

        latest = PUBS_DIR / f"pub_{slug}_LATEST.mp4"
        if dash and dash.exists():
            log.info("  Fusion dashboard…")
            append_dashboard(out_main, dash, out_complete)
            shutil.copy2(out_complete, latest)
        else:
            log.warning("  Pas de clip dashboard — pub 4 plans seulement")
            shutil.copy2(out_main, latest)

        log.info("✅ %s", latest.name)
        lines += [f"--- pub_{slug}_LATEST.mp4 ---", niche["facebook"], ""]

    posts_path.write_text("\n".join(lines), encoding="utf-8")
    log.info("Textes Facebook → %s", posts_path.name)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log.error("Échec: %s", e)
        sys.exit(1)
