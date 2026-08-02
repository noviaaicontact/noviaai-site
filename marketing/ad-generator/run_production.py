#!/usr/bin/env python3
"""
Pipeline complet de production pub vidéo NoviaAI.

Usage :
  python run_production.py --niche plombier \\
    --probleme "appels manqués" \\
    --objectif "obtenir des démos"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PIPELINE = ROOT.parent / "video-pipeline"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(PIPELINE))

from production_pipeline import run_production_pipeline  # noqa: E402
from utils import load_secrets_into_env, setup_logging  # noqa: E402

log = setup_logging("production", "production.log")


def _safe_print(text: str) -> None:
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode("ascii", errors="replace").decode("ascii"))


def main() -> int:
    load_secrets_into_env()

    ap = argparse.ArgumentParser(
        description="Pipeline production pub NoviaAI (framework + storyboard + dossier)",
    )
    ap.add_argument("--niche", "-n", required=True, help="plombier, garage, salon, electricien…")
    ap.add_argument("--probleme", "-p", required=True, help="Ex: appels manqués, clients perdus")
    ap.add_argument(
        "--objectif", "-o", required=True,
        help="Ex: obtenir des démos, générer des leads, augmenter les RDV",
    )
    ap.add_argument("--traffic", default="cold", choices=["cold", "warm", "retargeting"])
    ap.add_argument("--framework", "-f", help="Forcer un framework (skip sélection auto)")
    args = ap.parse_args()

    _safe_print("")
    _safe_print("=== Pipeline production NoviaAI ===")
    _safe_print(f"  Niche     : {args.niche}")
    _safe_print(f"  Probleme  : {args.probleme}")
    _safe_print(f"  Objectif  : {args.objectif}")
    _safe_print("")
    _safe_print("Etape 1/2 — Selection framework + plan 30s…")
    _safe_print("Etape 2/2 — Generation storyboard OpenAI…")
    _safe_print("")

    folder = run_production_pipeline(
        args.niche,
        args.objectif,
        args.probleme,
        traffic=args.traffic,
        framework_override=args.framework,
    )

    readme = (folder / "README.md").read_text(encoding="utf-8")
    _safe_print(readme)
    _safe_print("")
    _safe_print("=== Pipeline termine ===")
    _safe_print(f"Dossier : {folder}")
    _safe_print("")
    _safe_print("Fichiers cles :")
    for name in (
        "PRODUCTION.json",
        "02_hook.txt",
        "03_script_voix_off.txt",
        "04_textes_ecran.txt",
        "05_ordre_montage.json",
        "prompts/prompts_images.txt",
        "prompts/prompts_video.txt",
    ):
        p = folder / name
        if p.exists():
            _safe_print(f"  [OK] {name}")
    _safe_print(f"  [OK] scenes/ ({len(list((folder / 'scenes').glob('*.json')))} fichiers)")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log.exception("Echec pipeline: %s", e)
        print(f"ERREUR: {e}", file=sys.stderr)
        sys.exit(1)
