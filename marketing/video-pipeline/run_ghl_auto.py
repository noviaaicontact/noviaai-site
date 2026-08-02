#!/usr/bin/env python3
"""
Pipeline GHL 100 % automatique — zéro CapCut, zéro face cam.
1. Clés API (secrets/)
2. Mockups SMS si manquants
3. Serveur local + capture dashboard Playwright
4. Musique Pixabay
5. Assemblage pub style GoHighLevel
"""
from __future__ import annotations

import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

from config import LOCAL_CLIPS_DIR, PUBS_DIR
from utils import load_secrets_into_env, setup_logging

log = setup_logging("ghl_auto", "ghl_auto.log")

ROOT = Path(__file__).resolve().parent
SITE = ROOT.parent.parent
PORT = 8888
SERVE_PROC: subprocess.Popen | None = None


def port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=1.5):
            return True
    except OSError:
        return False


def ensure_server() -> None:
    global SERVE_PROC
    if port_open("127.0.0.1", PORT):
        log.info("Serveur déjà actif sur :%s", PORT)
        return
    log.info("Démarrage serveur statique sur :%s…", PORT)
    SERVE_PROC = subprocess.Popen(
        ["npx", "serve", ".", "-p", str(PORT), "--no-clipboard"],
        cwd=str(SITE),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        shell=True,
    )
    for _ in range(40):
        if port_open("127.0.0.1", PORT):
            log.info("Serveur prêt")
            return
        time.sleep(1)
    raise RuntimeError(f"Impossible de démarrer le serveur sur :{PORT}")


def run_cmd(args: list[str], cwd: Path, label: str) -> None:
    log.info("→ %s", label)
    r = subprocess.run(args, cwd=str(cwd), shell=isinstance(args[0], str) and args[0].endswith(".bat"))
    if r.returncode != 0:
        raise RuntimeError(f"{label} échoué (code {r.returncode})")


def ensure_sms_mockups() -> None:
    needed = ["sms_novia_plombier_01.mp4"]
    missing = [n for n in needed if not (LOCAL_CLIPS_DIR / n).exists()]
    if not missing:
        log.info("Mockups SMS OK")
        return
    run_cmd(
        [str(ROOT / ".venv" / "Scripts" / "python"), "generate_sms_mockups.py"],
        ROOT,
        "Génération mockups SMS",
    )


def capture_dashboard() -> None:
    run_cmd(["node", "scripts/demo-missed-call-video.mjs"], SITE, "Capture dashboard Playwright")


def fetch_music() -> None:
    r = subprocess.run(
        [str(ROOT / ".venv" / "Scripts" / "python"), "fetch_music.py"],
        cwd=str(ROOT),
    )
    if r.returncode != 0:
        log.warning("Musique non disponible — pub sans son")


def build_pub() -> Path:
    from generate_pub_ghl import GHL_PLOMBIER, build_ghl_pub

    out = build_ghl_pub(GHL_PLOMBIER)
    latest = PUBS_DIR / "pub_plombier_GHL_LATEST.mp4"
    shutil.copy2(out, latest)
    return latest


def cleanup() -> None:
    global SERVE_PROC
    if SERVE_PROC and SERVE_PROC.poll() is None:
        SERVE_PROC.terminate()
        SERVE_PROC = None


def main() -> int:
    try:
        load_secrets_into_env()
        log.info("=== Pipeline GHL automatique ===")
        PUBS_DIR.mkdir(parents=True, exist_ok=True)

        ensure_sms_mockups()
        ensure_server()
        capture_dashboard()
        fetch_music()
        latest = build_pub()

        txt = PUBS_DIR / "TEXTE-FACEBOOK-PLOMBIER-GHL.txt"
        txt.write_text(
            "Fuite à minuit et personne répond?\n"
            "60% de tes clients ne rappellent jamais.\n"
            "NoviaAI envoie un texto en 8 sec + agent IA qui qualifie.\n"
            "Essai gratuit 14 jours → noviaai.ca/signup?utm_source=facebook&utm_campaign=plombier-ghl\n",
            encoding="utf-8",
        )
        log.info("✅ Pub prête: %s", latest)
        return 0
    finally:
        cleanup()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log.exception("Échec pipeline: %s", e)
        cleanup()
        sys.exit(1)
