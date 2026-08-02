#!/usr/bin/env python3
"""Télécharge des photos portrait Unsplash pour B-roll pub (gratuit avec clé API)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import requests

from config import CLIPS_DIR, IMAGES_PER_TERM, UNSPLASH_CATALOG, UNSPLASH_JSON
from utils import download_file, load_json, save_json, setup_logging, slug_term

log = setup_logging("fetch_unsplash", "01c_unsplash.log")

UNSPLASH_SEARCH = "https://api.unsplash.com/search/photos"


def unsplash_search(access_key: str, query: str, page: int = 1) -> list[dict]:
    r = requests.get(
        UNSPLASH_SEARCH,
        headers={"Authorization": f"Client-ID {access_key}", "Accept-Version": "v1"},
        params={"query": query, "page": page, "per_page": 30, "orientation": "portrait"},
        timeout=60,
    )
    if r.status_code == 403:
        log.error("Clé Unsplash invalide ou rate limit — https://unsplash.com/developers")
        r.raise_for_status()
    r.raise_for_status()
    return r.json().get("results") or []


def trigger_download(access_key: str, download_location: str) -> None:
    """Requis par les conditions Unsplash lors du téléchargement."""
    try:
        requests.get(
            download_location,
            headers={"Authorization": f"Client-ID {access_key}"},
            timeout=30,
        )
    except requests.RequestException:
        pass


def main() -> int:
    from utils import load_secrets_into_env

    load_secrets_into_env()
    access_key = os.environ.get("UNSPLASH_ACCESS_KEY", "").strip()
    if not access_key:
        log.warning(
            "UNSPLASH_ACCESS_KEY absente — ajoutez noviaai-site/secrets/unsplash.env"
        )
        return 0

    out_dir = CLIPS_DIR / "unsplash"
    out_dir.mkdir(parents=True, exist_ok=True)
    catalog = load_json(UNSPLASH_JSON, {"images": []}) or {"images": []}
    seen = {f"unsplash:{i['unsplash_id']}" for i in catalog.get("images", []) if i.get("unsplash_id")}
    all_images = list(catalog.get("images", []))

    for scene, terms in UNSPLASH_CATALOG.items():
        for term in terms:
            slug = slug_term(term)
            log.info("[unsplash][%s] %s", scene, term)
            try:
                results = unsplash_search(access_key, term)
            except Exception as e:
                log.error("Erreur recherche: %s", e)
                continue

            idx = 0
            for photo in results:
                pid = photo.get("id")
                key = f"unsplash:{pid}"
                if not pid or key in seen:
                    continue
                urls = photo.get("urls") or {}
                img_url = urls.get("regular") or urls.get("small")
                if not img_url:
                    continue
                w = photo.get("width") or 0
                h = photo.get("height") or 0
                if h and w and h < w:
                    continue

                idx += 1
                filename = f"{scene}_us_{slug}_{idx:02d}.jpg"
                dest = out_dir / filename
                if not dest.exists() or dest.stat().st_size < 5000:
                    dl = photo.get("links", {}).get("download_location")
                    if dl:
                        trigger_download(access_key, dl)
                    log.info("  Télécharge %s (%sx%s)", filename, w, h)
                    try:
                        download_file(img_url, dest, log)
                    except Exception as e:
                        log.error("  Échec: %s", e)
                        continue

                user = (photo.get("user") or {}).get("name") or "Unsplash"
                all_images.append({
                    "filename": filename,
                    "path": str(dest.relative_to(CLIPS_DIR.parent)),
                    "scene": scene,
                    "term": term,
                    "source": "unsplash",
                    "unsplash_id": pid,
                    "width": w,
                    "height": h,
                    "author": user,
                    "author_url": (photo.get("user") or {}).get("links", {}).get("html"),
                })
                seen.add(key)
                if idx >= IMAGES_PER_TERM:
                    break

            save_json(UNSPLASH_JSON, {"images": all_images, "scenes": list(UNSPLASH_CATALOG.keys())})

    log.info("Unsplash OK — %s images", len(all_images))
    return 0


if __name__ == "__main__":
    sys.exit(main())
