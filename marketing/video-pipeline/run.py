#!/usr/bin/env python3
"""Orchestration du pipeline vidéo NoviaAI — exécution séquentielle avec reprise."""
from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from config import ROOT, STATE_FILE
from utils import load_json, save_json, setup_logging

log = setup_logging("run", "pipeline.log")

STEPS = [
    {"id": "sms_mockups", "name": "Mockups SMS Novia (local)", "script": "generate_sms_mockups.py"},
    {"id": "fetch", "name": "Récupération clips Pexels", "script": "fetch_clips.py"},
    {"id": "pixabay", "name": "Clips Pixabay (optionnel)", "script": "fetch_pixabay.py"},
    {"id": "unsplash", "name": "Photos Unsplash (optionnel)", "script": "fetch_unsplash.py"},
    {"id": "select", "name": "Sélection OpenCV", "script": "select_clips.py"},
    {"id": "generate", "name": "Génération des pubs", "script": "generate_pubs.py"},
]


def load_state() -> dict:
    return load_json(STATE_FILE, {"completed": [], "last_run": None, "errors": {}}) or {
        "completed": [],
        "last_run": None,
        "errors": {},
    }


def save_state(state: dict) -> None:
    save_json(STATE_FILE, state)


def run_step(script: str, extra_args: list[str] | None = None) -> int:
    path = ROOT / script
    log.info("─── Lancement %s ───", script)
    cmd = [sys.executable, str(path)] + (extra_args or [])
    result = subprocess.run(cmd, cwd=str(ROOT))
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Pipeline vidéo NoviaAI")
    parser.add_argument(
        "--from",
        dest="from_step",
        choices=[s["id"] for s in STEPS],
        help="Reprendre à partir de cette étape",
    )
    parser.add_argument(
        "--only",
        choices=[s["id"] for s in STEPS],
        help="Exécuter une seule étape",
    )
    parser.add_argument("--force", action="store_true", help="Réexécuter même si déjà complétée")
    args = parser.parse_args()

    state = load_state()
    state["last_run"] = datetime.now(timezone.utc).isoformat()

    if args.only:
        steps_to_run = [s for s in STEPS if s["id"] == args.only]
    elif args.from_step:
        idx = next(i for i, s in enumerate(STEPS) if s["id"] == args.from_step)
        steps_to_run = STEPS[idx:]
    else:
        steps_to_run = STEPS

    if args.force:
        state["completed"] = [s for s in state["completed"] if s not in {x["id"] for x in steps_to_run}]

    log.info("Pipeline NoviaAI — %s étape(s) à exécuter", len(steps_to_run))

    for step in steps_to_run:
        sid = step["id"]
        if sid in state["completed"] and not args.force and not args.only:
            log.info("Étape « %s » déjà complétée — ignorée (utilisez --force)", sid)
            continue

        log.info("▶ %s", step["name"])
        extra = ["--force"] if args.force and step["id"] == "generate" else None
        code = run_step(step["script"], extra)
        if code != 0:
            state["errors"][sid] = f"exit code {code}"
            save_state(state)
            log.error("Étape « %s » échouée (code %s). Reprenez avec: python run.py --from %s", sid, code, sid)
            return code

        if sid not in state["completed"]:
            state["completed"].append(sid)
        state["errors"].pop(sid, None)
        save_state(state)
        log.info("✓ %s terminée", step["name"])

    log.info("Pipeline terminé avec succès.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
