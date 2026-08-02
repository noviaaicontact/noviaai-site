"""Runway API — image-to-video (9:16)."""
from __future__ import annotations

import base64
import os
import time
from pathlib import Path
from typing import Any

import requests

from runway_guard import require_runway_approval

BASE_URL = "https://api.dev.runwayml.com/v1"
RUNWAY_VERSION = "2024-11-06"
# image_to_video : gen4_turbo. gen4.5 = text_to_video seulement.
# gen3a_turbo sunset 2026-07-30 — ne plus l'appeler.
DEFAULT_MODEL = os.environ.get("RUNWAY_MODEL", "gen4_turbo")
FALLBACK_MODELS = ("gen4_turbo",)
POLL_INTERVAL = 5
POLL_TIMEOUT = 600


def _api_key() -> str:
    key = os.environ.get("RUNWAY_API_KEY", "").strip()
    if not key:
        raise RuntimeError("RUNWAY_API_KEY manquante (secrets/runway.env)")
    return key


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
        "X-Runway-Version": RUNWAY_VERSION,
    }


def _image_data_uri(path: Path) -> str:
    data = path.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    suffix = path.suffix.lower()
    mime = "image/png" if suffix == ".png" else "image/jpeg"
    return f"data:{mime};base64,{b64}"


def _poll_task(task_id: str) -> dict[str, Any]:
    deadline = time.time() + POLL_TIMEOUT
    while time.time() < deadline:
        r = requests.get(f"{BASE_URL}/tasks/{task_id}", headers=_headers(), timeout=60)
        r.raise_for_status()
        task = r.json()
        status = (task.get("status") or "").upper()
        if status == "SUCCEEDED":
            return task
        if status in ("FAILED", "CANCELLED"):
            msg = task.get("failure") or task.get("failureCode") or status
            raise RuntimeError(f"Runway task echouee: {msg}")
        time.sleep(POLL_INTERVAL)
    raise RuntimeError(f"Runway timeout apres {POLL_TIMEOUT}s (task {task_id})")


def generate_video_from_image(
    image_path: Path,
    prompt_text: str,
    out_path: Path,
    *,
    model: str | None = None,
    ratio: str = "720:1280",
    duration: int = 5,
) -> dict[str, Any]:
    """Anime une image locale en clip vertical via Runway."""
    require_runway_approval(source="runway_video.generate_video_from_image")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    data_uri = _image_data_uri(image_path)
    models = [model] if model else list(FALLBACK_MODELS)
    last_err: str | None = None

    for m in models:
        payload = {
            "model": m,
            "promptImage": data_uri,
            "promptText": prompt_text[:500],
            "ratio": ratio,
            "duration": duration,
        }
        r = requests.post(
            f"{BASE_URL}/image_to_video",
            headers=_headers(),
            json=payload,
            timeout=120,
        )
        if r.status_code != 200:
            last_err = f"[{m}] {r.status_code}: {r.text[:500]}"
            print(f"  runway reject {last_err}", flush=True)
            if r.status_code in (401, 403):
                raise RuntimeError(f"Runway auth ({r.status_code}): {r.text[:300]}")
            continue

        task_id = r.json().get("id")
        if not task_id:
            last_err = "Pas de task id"
            continue

        task = _poll_task(task_id)
        outputs = task.get("output") or []
        if not outputs:
            last_err = "Task reussie sans output"
            continue

        video_url = outputs[0]
        vid = requests.get(video_url, timeout=300)
        vid.raise_for_status()
        out_path.write_bytes(vid.content)

        return {
            "path": str(out_path.resolve()),
            "model": m,
            "task_id": task_id,
            "ratio": ratio,
            "duration": duration,
            "source_url": video_url,
        }

    raise RuntimeError(f"Runway video echouee: {last_err}")
