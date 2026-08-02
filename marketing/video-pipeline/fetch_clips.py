#!/usr/bin/env python3
"""Étape 1 — Télécharge les clips Pexels (portrait, 5-20 s, max 1080p)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

from config import (
    CLIPS_DIR,
    CLIPS_JSON,
    CLIPS_PER_TERM,
    MAX_DURATION,
    MAX_HEIGHT,
    MIN_DURATION,
    ORIENTATION,
    PEXELS_SEARCH_URL,
    SCENE_CATALOG,
    SEARCH_TERMS,
)
from utils import download_file, load_json, pexels_get, save_json, setup_logging, slug_term

log = setup_logging("fetch_clips", "01_fetch.log")

MIN_HD_HEIGHT = 900


def probe_video_height(path: Path) -> int:
    try:
        import cv2
        cap = cv2.VideoCapture(str(path))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        cap.release()
        return h
    except Exception:
        return 0


def needs_hd_upgrade(dest: Path, new_height: int) -> bool:
    if not dest.exists() or dest.stat().st_size <= 10000:
        return True
    current = probe_video_height(dest)
    if current >= MIN_HD_HEIGHT:
        return False
    return new_height > current


def pick_mp4(video: dict) -> dict | None:
    files = video.get("video_files") or []
    mp4s = [f for f in files if f.get("file_type") == "video/mp4" and f.get("link")]
    if not mp4s:
        return None
    mp4s.sort(key=lambda f: f.get("height") or 0, reverse=True)
    for f in mp4s:
        if (f.get("height") or 9999) <= MAX_HEIGHT:
            return f
    return mp4s[-1]


def score_video(video: dict) -> float:
    dur = float(video.get("duration") or 0)
    if dur < MIN_DURATION or dur > MAX_DURATION:
        return -1
    w, h = video.get("width") or 0, video.get("height") or 0
    portrait_bonus = 2.0 if h > w else 0.0
    mid_dur = 12.0
    dur_score = 1.0 - min(abs(dur - mid_dur) / 10.0, 1.0)
    return portrait_bonus + dur_score + (min(h, MAX_HEIGHT) / MAX_HEIGHT) * 0.5


def fetch_term(term: str, api_key: str, seen_ids: set[int]) -> list[dict]:
    results: list[dict] = []
    page = 1
    while len(results) < CLIPS_PER_TERM * 3 and page <= 4:
        data = pexels_get(
            PEXELS_SEARCH_URL,
            api_key,
            {
                "query": term,
                "orientation": ORIENTATION,
                "per_page": 40,
                "page": page,
            },
        )
        videos = data.get("videos") or []
        if not videos:
            break
        ranked = sorted(
            [v for v in videos if v.get("id") not in seen_ids and score_video(v) >= 0],
            key=score_video,
            reverse=True,
        )
        results.extend(ranked)
        page += 1
        if not data.get("next_page"):
            break
    return results[:CLIPS_PER_TERM]


def dedupe_clips(clips: list[dict]) -> list[dict]:
    seen: set[int] = set()
    out: list[dict] = []
    for c in clips:
        pid = c.get("pexels_id")
        if pid and pid in seen:
            continue
        if pid:
            seen.add(pid)
        out.append(c)
    return out


def main() -> int:
    from utils import load_secrets_into_env

    load_secrets_into_env()
    api_key = os.environ.get("PEXELS_API_KEY", "").strip()
    if not api_key:
        log.error("PEXELS_API_KEY manquante — ajoutez noviaai-site/secrets/pexels.env")
        return 1

    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    existing = load_json(CLIPS_JSON, {"clips": []}) or {"clips": []}
    seen_ids = {c["pexels_id"] for c in existing.get("clips", []) if c.get("pexels_id")}
    all_clips = dedupe_clips(list(existing.get("clips", [])))

    term_to_scene = {t: s for s, terms in SCENE_CATALOG.items() for t in terms}

    for scene, terms in SCENE_CATALOG.items():
        for term in terms:
            slug = slug_term(term)
            log.info("[%s] Recherche: %s", scene, term)
            try:
                candidates = fetch_term(term, api_key, seen_ids)
            except Exception as e:
                log.error("Erreur recherche « %s »: %s", term, e)
                continue

            idx = 0
            for video in candidates:
                vid = video.get("id")
                if not vid or vid in seen_ids:
                    continue
                file_info = pick_mp4(video)
                if not file_info:
                    log.warning("Pas de MP4 ≤1080p pour id=%s", vid)
                    continue

                idx += 1
                filename = f"{scene}_{slug}_{idx:02d}.mp4"
                dest = CLIPS_DIR / filename
                new_h = file_info.get("height") or 0
                if needs_hd_upgrade(dest, new_h):
                    log.info("  Télécharge %s (%.1fs, %sp)", filename, video.get("duration", 0), new_h)
                    try:
                        download_file(file_info["link"], dest, log)
                    except Exception as e:
                        log.error("  Échec %s: %s", filename, e)
                        continue
                else:
                    log.info("  HD OK: %s (%sp)", filename, probe_video_height(dest) or new_h)

                meta = {
                    "filename": filename,
                    "path": str(dest.relative_to(CLIPS_DIR.parent)),
                    "scene": scene,
                    "term": term,
                    "pexels_id": vid,
                    "pexels_url": video.get("url"),
                    "duration": video.get("duration"),
                    "width": file_info.get("width"),
                    "height": probe_video_height(dest) or file_info.get("height"),
                    "quality": file_info.get("quality"),
                }
                all_clips.append(meta)
                seen_ids.add(vid)
                if idx >= CLIPS_PER_TERM:
                    break

            save_json(CLIPS_JSON, {"clips": dedupe_clips(all_clips), "scenes": list(SCENE_CATALOG.keys())})
            log.info("Terme « %s » terminé (%s clips cumulés)", term, len(all_clips))

    save_json(CLIPS_JSON, {"clips": dedupe_clips(all_clips), "scenes": list(SCENE_CATALOG.keys())})
    log.info("Étape 1 OK — %s clips dans %s", len(all_clips), CLIPS_DIR)
    return 0


if __name__ == "__main__":
    sys.exit(main())
