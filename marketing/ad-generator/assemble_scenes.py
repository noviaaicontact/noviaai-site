#!/usr/bin/env python3
"""Assemble les scenes en un seul montage.

La video est concatenee en copie de flux (aucune reencodage, aucune perte).
L'audio, lui, est reconstruit en un seul bloc PCM avant d'etre encode une seule
fois : coller des pistes AAC bout a bout laisse un trou de quelques millisecondes
a chaque raccord (echantillons d'amorce du codec), ce qui casserait les ponts
sonores qui relient les trois scenes.

Usage:
    python assemble_scenes.py
"""
from __future__ import annotations

import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "output" / "noviaai_demo_pme"
WORK = OUT_DIR / "_work"

SCENES = [
    (OUT_DIR / "scene1_garage_LATEST.mp4", WORK / "scene1_audio.wav"),
    (OUT_DIR / "scene2_client_LATEST.mp4", WORK / "scene2_audio.wav"),
    (OUT_DIR / "scene3_logo_LATEST.mp4", WORK / "scene3_audio.wav"),
]
OUT = OUT_DIR / "pub_noviaai_LATEST.mp4"


def read_wav(path: Path) -> tuple[np.ndarray, int, int]:
    with wave.open(str(path), "rb") as f:
        return (np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16),
                f.getframerate(), f.getnchannels())


def main() -> int:
    missing = [p for p, w in SCENES if not p.exists()] + [w for p, w in SCENES if not w.exists()]
    if missing:
        print("Fichiers manquants :", *(f"  {p}" for p in missing), sep="\n")
        return 1

    listing = WORK / "concat_scenes.txt"
    listing.write_text("".join(f"file '{p.as_posix()}'\n" for p, _ in SCENES), encoding="utf-8")

    video = WORK / "scenes_video.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", str(listing), "-an", "-c:v", "copy", str(video)], check=True)

    chunks, sr, ch = [], None, None
    for _, wav in SCENES:
        data, rate, chans = read_wav(wav)
        if sr is None:
            sr, ch = rate, chans
        elif (rate, chans) != (sr, ch):
            print(f"Format audio incoherent dans {wav.name}")
            return 1
        chunks.append(data)

    joined = WORK / "scenes_audio.wav"
    with wave.open(str(joined), "wb") as f:
        f.setnchannels(ch)
        f.setsampwidth(2)
        f.setframerate(sr)
        f.writeframes(np.concatenate(chunks).tobytes())

    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-i", str(joined),
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(OUT)],
                   check=True)

    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(OUT)], capture_output=True, text=True).stdout.strip()
    print(f"OK -> {OUT}  ({float(dur):.2f} s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
