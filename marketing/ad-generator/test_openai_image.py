#!/usr/bin/env python3
"""Test clé OpenAI — API Images (GPT Image)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PIPELINE = ROOT.parent / "video-pipeline"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(PIPELINE))

from openai_image import generate_image  # noqa: E402
from utils import load_secrets_into_env, setup_logging  # noqa: E402

log = setup_logging("openai_image_test", "openai_image_test.log")
OUT = ROOT / "output" / "images" / "test_openai_image.png"
PROMPT = (
    "Minimal test image for NoviaAI SaaS: smartphone showing SMS notification "
    "on a plumber workshop background, vertical 9:16 style, clean modern design, "
    "navy blue and lime green accent colors, no text logos"
)


def main() -> int:
    load_secrets_into_env()
    print("Test API OpenAI Images…")
    meta = generate_image(PROMPT, OUT)
    print(f"OK — modele: {meta['model']}")
    print(f"Image: {meta['path']}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"ERREUR: {e}")
        sys.exit(1)
