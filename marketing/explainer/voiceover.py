"""Génère la voix-off française de la vidéo explicative (OpenAI TTS).

Une piste MP3 par scène + durations.json, lu ensuite par assemble.py.
Les fichiers déjà présents ne sont pas régénérés (utiliser --force pour tout refaire).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv
from moviepy import AudioFileClip

HERE = Path(__file__).parent
VOICE_DIR = HERE / "voice"
BOARD = json.loads((HERE / "storyboard.json").read_text(encoding="utf-8"))

ENDPOINT = "https://api.openai.com/v1/audio/speech"

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def api_key() -> str:
    for env_path in (
        HERE.parents[2] / "rattrapeur-sms" / ".env",
        HERE.parents[1] / ".env",
    ):
        if env_path.exists():
            load_dotenv(env_path, override=False)
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        sys.exit("OPENAI_API_KEY introuvable (cherché dans rattrapeur-sms/.env)")
    return key


def synth(key: str, text: str, out: Path) -> None:
    voice = BOARD["voice"]
    payload = {
        "model": voice["model"],
        "voice": voice["name"],
        "input": text,
        "response_format": "mp3",
        "instructions": voice["instructions"],
    }
    res = requests.post(
        ENDPOINT,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=payload,
        timeout=180,
    )
    if res.status_code != 200:
        raise RuntimeError(f"TTS {res.status_code} — {res.text[:300]}")
    out.write_bytes(res.content)


def main() -> None:
    force = "--force" in sys.argv
    key = api_key()
    VOICE_DIR.mkdir(exist_ok=True)

    durations = {}
    total = 0.0
    for scene in BOARD["scenes"]:
        out = VOICE_DIR / f"{scene['id']}.mp3"
        if force or not out.exists():
            print(f"  → {scene['id']} … ", end="", flush=True)
            synth(key, scene["vo"], out)
            print("ok")
        with AudioFileClip(str(out)) as clip:
            durations[scene["id"]] = round(clip.duration, 3)
        total += durations[scene["id"]]

    (VOICE_DIR / "durations.json").write_text(
        json.dumps(durations, indent=2), encoding="utf-8"
    )
    mins, secs = divmod(total, 60)
    print(f"\n{len(durations)} pistes · narration {int(mins)} min {secs:04.1f} s")


if __name__ == "__main__":
    main()
