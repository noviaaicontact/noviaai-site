#!/usr/bin/env python3
"""Télécharge des clips supplémentaires depuis Pixabay (gratuit)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import requests

from config import (
    CLIPS_DIR,
    CLIPS_JSON,
    CLIPS_PER_TERM,
    MAX_HEIGHT,
    SCENE_CATALOG,
)
from utils import download_file, load_json, save_json, setup_logging, slug_term

log = setup_logging("fetch_pixabay", "01b_pixabay.log")

PIXABAY_URL = "https://pixabay.com/api/videos/"


def pixabay_search(api_key: str, query: str, page: int = 1) -> list[dict]:
    r = requests.get(
        PIXABAY_URL,
        params={
            "key": api_key,
            "q": query.replace(" ", "+"),
            "video_type": "all",
            "per_page": 50,
            "page": page,
        },
        timeout=60,
    )
    r.raise_for_status()
    return r.json().get("hits") or []


def pick_portrait_mp4(hit: dict) -> tuple[str, int, int] | None:
    videos = hit.get("videos") or {}
    for quality in ("large", "medium", "small", "tiny"):
        v = videos.get(quality) or {}
        url = v.get("url")
        w, h = v.get("width") or 0, v.get("height") or 0
        if not url:
            continue
        if h >= w and h <= MAX_HEIGHT:
            return url, w, h
    for quality in ("large", "medium", "small"):
        v = videos.get(quality) or {}
        url = v.get("url")
        if url:
            return url, v.get("width") or 0, v.get("height") or 0
    return None


def dedupe_clips(clips: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out = []
    for c in clips:
        key = f"{c.get('source')}:{c.get('pixabay_id') or c.get('pexels_id') or c.get('filename')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


def main() -> int:
    api_key = os.environ.get("PIXABAY_API_KEY", "").strip()
    if not api_key:
        log.warning("PIXABAY_API_KEY absente — étape ignorée (gratuit sur pixabay.com/api/docs/)")
        return 0

    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    catalog = load_json(CLIPS_JSON, {"clips": []}) or {"clips": []}
    seen = {
        f"pixabay:{c['pixabay_id']}"
        for c in catalog.get("clips", [])
        if c.get("source") == "pixabay" and c.get("pixabay_id")
    }
    all_clips = dedupe_clips(list(catalog.get("clips", [])))

    for scene, terms in SCENE_CATALOG.items():
        for term in terms:
            slug = slug_term(term)
            log.info("[pixabay][%s] %s", scene, term)
            try:
                hits = pixabay_search(api_key, term)
            except Exception as e:
                log.error("Erreur: %s", e)
                continue

            idx = 0
            for hit in hits:
                pid = hit.get("id")
                key = f"pixabay:{pid}"
                if not pid or key in seen:
                    continue
                picked = pick_portrait_mp4(hit)
                if not picked:
                    continue
                url, width, height = picked
                idx += 1
                filename = f"{scene}_px_{slug}_{idx:02d}.mp4"
                dest = CLIPS_DIR / filename
                if not dest.exists() or dest.stat().st_size < 10000:
                    log.info("  Télécharge %s (%sx%s)", filename, width, height)
                    try:
                        download_file(url, dest, log)
                    except Exception as e:
                        log.error("  Échec: %s", e)
                        continue

                all_clips.append({
                    "filename": filename,
                    "path": str(dest.relative_to(CLIPS_DIR.parent)),
                    "scene": scene,
                    "term": term,
                    "source": "pixabay",
                    "pixabay_id": pid,
                    "duration": hit.get("duration"),
                    "width": width,
                    "height": height,
                })
                seen.add(key)
                if idx >= CLIPS_PER_TERM:
                    break

            save_json(CLIPS_JSON, {"clips": dedupe_clips(all_clips), "scenes": list(SCENE_CATALOG.keys())})

    log.info("Pixabay OK — %s clips total", len(all_clips))
    return 0


if __name__ == "__main__":
    sys.exit(main())
