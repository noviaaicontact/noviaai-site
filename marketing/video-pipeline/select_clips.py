#!/usr/bin/env python3
"""Étape 2 — Sélection du meilleur clip par scène narrative."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import cv2
import numpy as np

from config import CLIPS_DIR, CLIPS_JSON, SCENE_CATALOG, SELECTION_DIR, SELECTION_JSON, TOP_PER_SCENE
from utils import load_json, save_json, setup_logging

log = setup_logging("select_clips", "02_select.log")

# Pexels « plumber under sink » renvoie souvent de la vaisselle — exclure
CLIP_BLOCKLIST = (
    "washing",
    "dishes",
    "dish",
    "cup",
    "elderly",
    "cleaning",
    "vaisselle",
    "9474125",
    "7477416",
    "7477419",
    "7477598",
)


def is_blocked_clip(clip: dict) -> bool:
    blob = " ".join(
        str(clip.get(k, "")) for k in ("filename", "term", "pexels_url", "path")
    ).lower()
    return any(b in blob for b in CLIP_BLOCKLIST)

HAS_TESSERACT = False
HAS_EASYOCR = False
try:
    import pytesseract
    HAS_TESSERACT = True
except ImportError:
    pass

try:
    import easyocr  # noqa: F401
    HAS_EASYOCR = True
    _easyocr_reader = None
except ImportError:
    pass


def _get_easyocr_reader():
    global _easyocr_reader
    if _easyocr_reader is None:
        import easyocr
        _easyocr_reader = easyocr.Reader(["en", "fr"], gpu=False, verbose=False)
    return _easyocr_reader


def sample_frames(cap: cv2.VideoCapture, n: int = 12) -> list[np.ndarray]:
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total <= 0:
        return []
    indices = np.linspace(0, max(total - 1, 0), num=min(n, total), dtype=int)
    frames = []
    for i in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, frame = cap.read()
        if ok and frame is not None:
            frames.append(frame)
    return frames


def sharpness(gray: np.ndarray) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def stability(frames: list[np.ndarray]) -> float:
    if len(frames) < 2:
        return 0.0
    flows = []
    prev = cv2.cvtColor(frames[0], cv2.COLOR_BGR2GRAY)
    for frame in frames[1:]:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        flow = cv2.calcOpticalFlowFarneback(prev, gray, None, 0.5, 3, 15, 3, 5, 1.2, 0)
        mag = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
        flows.append(float(np.mean(mag)))
        prev = gray
    avg_flow = np.mean(flows)
    return max(0.0, 1.0 - min(avg_flow / 8.0, 1.0))


def contrast_brightness(frames: list[np.ndarray]) -> tuple[float, float]:
    vals = []
    for f in frames:
        gray = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        vals.append(gray)
    stack = np.concatenate(vals)
    mean = float(np.mean(stack))
    std = float(np.std(stack))
    brightness_score = 1.0 - min(abs(mean - 120) / 120.0, 1.0)
    contrast_score = min(std / 60.0, 1.0)
    return contrast_score, brightness_score


def text_overlay_score(frames: list[np.ndarray]) -> float:
    scores = []
    for frame in frames[:: max(1, len(frames) // 4)]:
        h, w = frame.shape[:2]
        regions = [frame[int(h * 0.70) : h, :], frame[int(h * 0.35) : int(h * 0.65), :]]
        region_scores = []
        for reg in regions:
            gray = cv2.cvtColor(reg, cv2.COLOR_BGR2GRAY)
            if HAS_EASYOCR:
                try:
                    reader = _get_easyocr_reader()
                    results = reader.readtext(reg, detail=0, paragraph=True)
                    chars = sum(len(t.strip()) for t in results if t and t.strip())
                    region_scores.append(min(chars / 40.0, 1.0))
                    continue
                except Exception:
                    pass
            if HAS_TESSERACT:
                try:
                    data = pytesseract.image_to_data(gray, output_type=pytesseract.Output.DICT, config="--psm 11")
                    chars = sum(len(t.strip()) for t in data.get("text", []) if t and t.strip())
                    region_scores.append(min(chars / 40.0, 1.0))
                except Exception:
                    region_scores.append(_heuristic_text(gray))
            else:
                region_scores.append(_heuristic_text(gray))
        scores.append(max(region_scores) if region_scores else 0)
    return float(np.mean(scores)) if scores else 0.0


def _heuristic_text(gray: np.ndarray) -> float:
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blur, 80, 200)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    ratio = np.count_nonzero(closed) / closed.size
    return min(ratio * 12.0, 1.0)


def analyze_clip(path: Path) -> dict | None:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None
    frames = sample_frames(cap)
    cap.release()
    if len(frames) < 2:
        return None

    sharp = np.mean([sharpness(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)) for f in frames])
    stab = stability(frames)
    contrast, bright = contrast_brightness(frames)
    text = text_overlay_score(frames)
    sharp_n = min(sharp / 500.0, 1.0)
    total = stab * 0.30 + sharp_n * 0.25 + contrast * 0.20 + bright * 0.15 + (1.0 - text) * 0.10
    if text > 0.55:
        total *= 0.3

    return {
        "sharpness": round(sharp, 2),
        "stability": round(stab, 4),
        "contrast": round(contrast, 4),
        "brightness": round(bright, 4),
        "text_overlay": round(text, 4),
        "score": round(total, 4),
    }


def infer_scene(clip: dict) -> str:
    if clip.get("scene") in SCENE_CATALOG:
        return clip["scene"]
    name = clip.get("filename", "")
    for scene in SCENE_CATALOG:
        if name.startswith(f"{scene}_"):
            return scene
    return "unknown"


def main() -> int:
    catalog = load_json(CLIPS_JSON)
    if not catalog or not catalog.get("clips"):
        log.error("clips.json vide — lancez fetch_clips.py d'abord")
        return 1

    by_scene: dict[str, list] = {s: [] for s in SCENE_CATALOG}

    for clip in catalog["clips"]:
        if is_blocked_clip(clip):
            log.info("  [skip] %s — clip exclu (hors-sujet)", clip.get("filename"))
            continue
        path = Path(__file__).parent / clip.get("path", "")
        if not path.exists():
            path = CLIPS_DIR / clip.get("filename", "")
        if not path.exists():
            continue
        metrics = analyze_clip(path)
        if not metrics:
            continue
        scene = infer_scene(clip)
        if scene not in by_scene:
            continue
        entry = {**clip, **metrics, "source_path": str(path), "scene": scene}
        by_scene[scene].append(entry)
        log.info("  [%s] %s — score=%.3f", scene, clip["filename"], metrics["score"])

    def rank_key(c: dict) -> float:
        bonus = float(c.get("priority") or 0)
        if c.get("source") == "local":
            bonus += 50.0
        if "novia" in c.get("filename", "").lower():
            bonus += 40.0
        h = int(c.get("height") or 0)
        if h >= 1080:
            bonus += 20.0
        elif h >= 720:
            bonus += 10.0
        elif h > 0 and h < 720:
            bonus -= 15.0
        return c["score"] + bonus

    NICHE_HINTS = {
        "busy": [
            ["plumb", "sink", "pipe"],
            ["mechanic", "garage", "hood", "car"],
            ["hair", "stylist", "salon", "cut"],
        ],
        "result": [
            ["plumb", "contractor"],
            ["mechanic", "garage", "customer"],
            ["salon", "hair", "woman"],
        ],
    }

    def pick_top_with_niches(ranked: list[dict], scene: str) -> list[dict]:
        hints_groups = NICHE_HINTS.get(scene)
        if not hints_groups:
            return ranked[:TOP_PER_SCENE]
        picked: list[dict] = []
        used: set[str] = set()

        def blob(c: dict) -> str:
            return " ".join(str(c.get(k, "")) for k in ("filename", "term", "path")).lower()

        for hints in hints_groups:
            for c in ranked:
                fn = c.get("filename", "")
                if fn in used or is_blocked_clip(c):
                    continue
                if any(h in blob(c) for h in hints):
                    picked.append(c)
                    used.add(fn)
                    break

        for c in ranked:
            if len(picked) >= TOP_PER_SCENE:
                break
            fn = c.get("filename", "")
            if fn not in used:
                picked.append(c)
                used.add(fn)
        return picked[:TOP_PER_SCENE]

    SELECTION_DIR.mkdir(parents=True, exist_ok=True)
    for old in SELECTION_DIR.glob("*.mp4"):
        try:
            old.unlink()
        except PermissionError:
            log.warning("Fichier verrouillé, ignoré: %s (fermez le lecteur vidéo)", old.name)

    scenes_out: dict[str, list] = {}
    total = 0
    for scene in SCENE_CATALOG:
        ranked = sorted(by_scene[scene], key=rank_key, reverse=True)
        top = pick_top_with_niches(ranked, scene)
        scenes_out[scene] = []
        for i, clip in enumerate(top, 1):
            src = Path(clip["source_path"])
            dest = SELECTION_DIR / f"{scene}_{i:02d}.mp4"
            shutil.copy2(src, dest)
            clip["selection_file"] = dest.name
            clip["selection_rank"] = i
            scenes_out[scene].append(clip)
            total += 1
            log.info("  → %s (score %.3f)", dest.name, clip["score"])

    save_json(SELECTION_JSON, {"scenes": scenes_out, "top_per_scene": TOP_PER_SCENE})
    if total < len(SCENE_CATALOG):
        log.error("Scènes manquantes — relancez fetch_clips.py")
        return 1
    log.info("Étape 2 OK — %s clips (%s/scène) dans %s", total, TOP_PER_SCENE, SELECTION_DIR)
    return 0


if __name__ == "__main__":
    sys.exit(main())
