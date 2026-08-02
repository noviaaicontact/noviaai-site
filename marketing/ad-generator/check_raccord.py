#!/usr/bin/env python3
"""Mesure les raccords sonores entre les scenes.

Chaque scene est normalisee separement, donc une meme note synthetisee peut sortir
a des niveaux differents de part et d'autre d'une coupe. Ce script compare
l'energie de la bande grave (60-260 Hz, la ou vit la nappe) juste avant et juste
apres chaque raccord, et propose le PAD_GAIN a corriger.

Usage:
    python check_raccord.py
"""
from __future__ import annotations

import sys
import wave
from pathlib import Path

import numpy as np

import scene1_garage as s1
import scene2_client as s2
import scene3_logo as s3

WINDOW = 0.30           # duree analysee de chaque cote de la coupe
BAND = (60.0, 260.0)    # bande de la nappe grave

SCENES = [
    ("scene 1", lambda p: s1.synth_audio(p, "moderne"), None),
    ("scene 2", s2.synth_audio, "scene2_client.py"),
    ("scene 3", s3.synth_audio, "scene3_logo.py"),
]
GAINS = {"scene 2": s2.PAD_GAIN, "scene 3": s3.PAD_GAIN}


def read_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as f:
        sr, ch = f.getframerate(), f.getnchannels()
        raw = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16)
    data = raw.reshape(-1, ch).mean(axis=1)
    return data.astype(np.float32) / 32768.0, sr


def band_energy(seg: np.ndarray, sr: int) -> float:
    if seg.size == 0:
        return 0.0
    spectrum = np.abs(np.fft.rfft(seg * np.hanning(seg.size)))
    freqs = np.fft.rfftfreq(seg.size, 1 / sr)
    mask = (freqs >= BAND[0]) & (freqs <= BAND[1])
    return float(np.sqrt(np.mean(spectrum[mask] ** 2)))


def main() -> int:
    WORK = s2.WORK
    WORK.mkdir(parents=True, exist_ok=True)

    tracks = []
    for name, synth, _ in SCENES:
        wav = WORK / f"_raccord_{name.replace(' ', '')}.wav"
        synth(wav)
        tracks.append((name, *read_mono(wav)))
        wav.unlink(missing_ok=True)

    print(f"Bande {BAND[0]:.0f}-{BAND[1]:.0f} Hz sur {WINDOW * 1000:.0f} ms de chaque cote\n")
    ok = True
    for (n1, a1, sr), (n2, a2, _) in zip(tracks, tracks[1:]):
        n = int(WINDOW * sr)
        before, after = band_energy(a1[-n:], sr), band_energy(a2[:n], sr)
        if before <= 0 or after <= 0:
            print(f"{n1} -> {n2} : mesure impossible (silence d'un cote)")
            ok = False
            continue
        delta = 20 * np.log10(after / before)
        verdict = "inaudible" if abs(delta) <= 1.0 else "AUDIBLE"
        print(f"{n1} -> {n2} : {20 * np.log10(before):6.2f} dB | "
              f"{20 * np.log10(after):6.2f} dB | ecart {delta:+6.2f} dB  ({verdict})")
        if abs(delta) > 1.0:
            ok = False
            fichier = dict((s[0], s[2]) for s in SCENES)[n2]
            print(f"    -> mettre PAD_GAIN = {GAINS[n2] / (10 ** (delta / 20)):.3f} "
                  f"dans {fichier}")

    print("\nTous les raccords tiennent." if ok else "\nAu moins un raccord se corrige.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
