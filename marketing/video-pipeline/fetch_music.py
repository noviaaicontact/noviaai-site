#!/usr/bin/env python3
"""Télécharge musique libre pour pubs GHL — plusieurs sources."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import requests

from utils import download_file, setup_logging

log = setup_logging("fetch_music", "fetch_music.log")

SITE_ROOT = Path(__file__).resolve().parent.parent.parent
OUT = SITE_ROOT / "marketing" / "assets-pub" / "ghl-bg.mp3"
PIXABAY_AUDIO = "https://pixabay.com/api/audio/"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
HEADERS = {"User-Agent": UA, "Accept": "*/*"}

# Pistes libres — URLs directes stables
DIRECT_TRACKS = [
    (
        "mixkit-driving-ambition",
        "https://assets.mixkit.co/music/preview/mixkit-driving-ambition-32.mp3",
    ),
    (
        "mixkit-tech-house",
        "https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3",
    ),
    (
        "soundhelix-16",
        "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-16.mp3",
    ),
]


def try_pixabay(key: str) -> bool:
    for query in ("corporate", "motivation", "background"):
        log.info("Pixabay audio: %s", query)
        r = requests.get(
            PIXABAY_AUDIO,
            params={"key": key, "q": query, "per_page": 5},
            headers=HEADERS,
            timeout=60,
        )
        if r.status_code == 403:
            log.warning("Pixabay audio API refusée (403) — clé vidéo seulement?")
            return False
        r.raise_for_status()
        for hit in r.json().get("hits") or []:
            url = hit.get("audio") or hit.get("previewURL")
            if url and _save_url(url, hit.get("name", "pixabay")):
                return True
    return False


def _save_url(url: str, label: str) -> bool:
    log.info("Télécharge %s…", label)
    try:
        r = requests.get(url, headers=HEADERS, timeout=120, stream=True)
        r.raise_for_status()
        OUT.parent.mkdir(parents=True, exist_ok=True)
        data = r.content if not hasattr(r, "iter_content") else b"".join(r.iter_content(65536))
        if len(data) < 50000:
            return False
        OUT.write_bytes(data)
        log.info("OK → %s (%d Ko)", OUT, len(data) // 1024)
        return True
    except Exception as e:
        log.warning("Échec %s: %s", label, e)
        return False


def try_direct() -> bool:
    for label, url in DIRECT_TRACKS:
        if _save_url(url, label):
            return True
    return False


def main() -> int:
    from utils import load_secrets_into_env

    load_secrets_into_env()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists() and OUT.stat().st_size > 50000:
        log.info("Musique déjà présente: %s", OUT)
        return 0

    key = os.environ.get("PIXABAY_API_KEY", "").strip()
    if key:
        try:
            if try_pixabay(key):
                return 0
        except Exception as e:
            log.warning("Pixabay: %s", e)

    if try_direct():
        return 0

    log.error("Aucune piste téléchargée")
    return 1


if __name__ == "__main__":
    sys.exit(main())

