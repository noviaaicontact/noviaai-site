"""Génération d'images via GPT Image (OpenAI)."""
from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any

import requests

IMAGES_URL = "https://api.openai.com/v1/images/generations"
DEFAULT_IMAGE_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1-mini")
FALLBACK_MODELS = ("gpt-image-1-mini", "gpt-image-1", "gpt-image-1.5")


def _api_key() -> str:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY manquante (secrets/openai.env)")
    return key


def generate_image(
    prompt: str,
    out_path: Path,
    *,
    model: str | None = None,
    size: str = "1024x1536",
    quality: str = "low",
) -> dict[str, Any]:
    """Envoie un prompt à GPT Image et sauvegarde le PNG."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    key = _api_key()
    models = [model] if model else list(FALLBACK_MODELS)
    last_err: str | None = None

    for m in models:
        payload = {
            "model": m,
            "prompt": prompt,
            "n": 1,
            "size": size,
            "quality": quality,
            "output_format": "png",
        }
        r = requests.post(
            IMAGES_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=payload,
            timeout=180,
        )
        if r.status_code != 200:
            last_err = r.text[:400]
            if r.status_code in (401, 403):
                raise RuntimeError(f"OpenAI Images auth ({r.status_code})")
            continue

        item = r.json()["data"][0]
        if item.get("b64_json"):
            out_path.write_bytes(base64.b64decode(item["b64_json"]))
        elif item.get("url"):
            img = requests.get(item["url"], timeout=120)
            img.raise_for_status()
            out_path.write_bytes(img.content)
        else:
            last_err = "Réponse sans image"
            continue

        return {
            "path": str(out_path.resolve()),
            "model": m,
            "size": size,
            "revised_prompt": item.get("revised_prompt", ""),
        }

    raise RuntimeError(f"Génération image échouée: {last_err}")
