#!/usr/bin/env python3
"""Améliore UNIQUEMENT la carte CTA finale — sans toucher au corps de la pub.

- Garde pub_noviaai_BEFORE_CTA.mp4 (ou LATEST original) intact jusqu'à la fin
  de la scène 2 (animations SMS, bruitages, musique, qualité).
- Remplace seulement les ~3.4 s de logo final par un CTA Meta.
- Réutilise l'audio de l'ancienne fin sous le nouveau CTA (pas de silence).

Usage:
    python improve_pub_cta.py
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "output" / "noviaai_demo_pme"
WORK = OUT_DIR / "_work"
VP = ROOT.parent / "video-pipeline"
sys.path.insert(0, str(VP))

from config import PUB_FPS, PUB_HEIGHT, PUB_WIDTH  # noqa: E402

NAVY = (19, 50, 91)
NAVY_D = (12, 28, 52)
LIME = (200, 241, 53)
WHITE = (252, 250, 245)
MUTED = (180, 190, 205)

# Durées d'origine (assemble_scenes.py)
SCENE1_DUR = 5.60
SCENE2_DUR = 16.00
SCENE3_DUR = 3.40
BODY_DUR = SCENE1_DUR + SCENE2_DUR  # 21.60
CTA_DUR = 4.0

SOURCE = OUT_DIR / "pub_noviaai_BEFORE_CTA.mp4"
OUT = OUT_DIR / "pub_noviaai_LATEST.mp4"
CTA_MP4 = WORK / "scene3_cta_meta.mp4"
BODY_MP4 = WORK / "body_keep.mp4"
END_AUDIO = WORK / "end_audio_orig.wav"
CTA_AUDIO = WORK / "cta_audio_bed.wav"
CONCAT_LIST = WORK / "concat_body_cta.txt"


def _font(size: int, bold: bool = True):
    paths = [
        Path("C:/Windows/Fonts/segoeuib.ttf") if bold else Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf") if bold else Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for p in paths:
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def render_cta_frame(progress: float = 1.0) -> np.ndarray:
    w, h = PUB_WIDTH, PUB_HEIGHT
    img = Image.new("RGB", (w, h), NAVY_D)
    draw = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        c = tuple(int(NAVY_D[i] * (1 - t) + NAVY[i] * t) for i in range(3))
        draw.line([(0, y), (w, y)], fill=c)

    p = min(max(progress, 0), 1)
    scale = 0.88 + 0.12 * p

    f_brand = _font(int(92 * scale), True)
    novia, ai = "Novia", "AI"
    bb_n = draw.textbbox((0, 0), novia, font=f_brand)
    bb_a = draw.textbbox((0, 0), ai, font=f_brand)
    total = (bb_n[2] - bb_n[0]) + (bb_a[2] - bb_a[0])
    x0 = (w - total) // 2
    by = int(h * 0.28)
    draw.text((x0, by), novia, font=f_brand, fill=WHITE)
    draw.text((x0 + (bb_n[2] - bb_n[0]), by), ai, font=f_brand, fill=LIME)

    rule_y = by + int(110 * scale)
    draw.rectangle([w // 2 - 80, rule_y, w // 2 + 80, rule_y + 4], fill=LIME)

    y = rule_y + 48
    for text, bold, size in (("Essai 14 jours", True, 56), ("Sans engagement", False, 44)):
        f = _font(int(size * scale), bold)
        bb2 = draw.textbbox((0, 0), text, font=f)
        draw.text(((w - (bb2[2] - bb2[0])) // 2, y), text, font=f, fill=WHITE)
        y += int(size * scale) + 18

    pill = "noviaai.ca"
    fp = _font(int(48 * scale), True)
    bbp = draw.textbbox((0, 0), pill, font=fp)
    pw, ph = bbp[2] - bbp[0], bbp[3] - bbp[1]
    px, py = (w - pw) // 2, y + 28
    # Soft pulse on pill
    pulse = 1.0 + 0.04 * abs(np.sin(progress * np.pi))
    pad = int(36 * pulse)
    draw.rounded_rectangle(
        [px - pad, py - 18, px + pw + pad, py + ph + 22],
        radius=28,
        fill=LIME,
    )
    draw.text((px, py), pill, font=fp, fill=NAVY_D)

    hint = "Places fondateur limitées"
    fh = _font(30, False)
    bbh = draw.textbbox((0, 0), hint, font=fh)
    draw.text(((w - (bbh[2] - bbh[0])) // 2, py + ph + 56), hint, font=fh, fill=MUTED)
    return np.array(img)


def build_cta_video() -> None:
    try:
        from moviepy import VideoClip
    except ImportError:
        from moviepy.editor import VideoClip

    def make_frame(t):
        # Entrance + gentle loop pulse for pill
        enter = min(t / 0.35, 1.0)
        enter = 1 - (1 - enter) ** 3
        pulse = 0.5 + 0.5 * abs(np.sin((t / CTA_DUR) * np.pi * 2))
        return render_cta_frame(enter * (0.85 + 0.15 * pulse))

    WORK.mkdir(parents=True, exist_ok=True)
    clip = VideoClip(make_frame, duration=CTA_DUR)
    clip = clip.with_fps(PUB_FPS) if hasattr(clip, "with_fps") else clip.set_fps(PUB_FPS)
    clip.write_videofile(
        str(CTA_MP4),
        fps=PUB_FPS,
        codec="libx264",
        audio=False,
        preset="medium",
        threads=4,
        logger=None,
    )
    clip.close()


def ff(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-v", "error", *args], check=True)


def build_cta_audio_from_original() -> None:
    """Prend l'audio de l'ancienne fin (bruit/musique/VO) et l'étire à CTA_DUR."""
    # Extraire audio fin originale
    ff(
        "-i", str(SOURCE),
        "-ss", f"{BODY_DUR}",
        "-t", f"{SCENE3_DUR}",
        "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2",
        str(END_AUDIO),
    )
    # Pad / trim to CTA_DUR (si plus court: fade + silence; si besoin étirer un peu)
    # Ici: prendre l'audio, fade out, pad jusqu'à CTA_DUR
    ff(
        "-i", str(END_AUDIO),
        "-af", f"apad=pad_dur={CTA_DUR},atrim=0:{CTA_DUR},afade=t=out:st={max(CTA_DUR - 0.6, 0)}:d=0.6",
        "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2",
        str(CTA_AUDIO),
    )


def assemble() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(
            f"Backup introuvable: {SOURCE}\n"
            "Remets pub_noviaai_BEFORE_CTA.mp4 ou restaure l'original."
        )

    # Corps: copie de flux (qualité + animations + audio intacts)
    ff(
        "-i", str(SOURCE),
        "-t", f"{BODY_DUR}",
        "-c", "copy",
        str(BODY_MP4),
    )

    # Mux CTA video + audio d'origine de la fin
    cta_muxed = WORK / "cta_with_audio.mp4"
    ff(
        "-i", str(CTA_MP4),
        "-i", str(CTA_AUDIO),
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        str(cta_muxed),
    )

    # Re-encode léger au raccord seulement (évite freeze concat copy hétérogène)
    # mais on re-encode à CRF 18 pour garder la qualité du corps
    body_norm = WORK / "body_norm.mp4"
    cta_norm = WORK / "cta_norm.mp4"
    common = [
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-r", str(PUB_FPS),
        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
    ]
    ff("-i", str(BODY_MP4), *common, str(body_norm))
    ff("-i", str(cta_muxed), *common, str(cta_norm))

    CONCAT_LIST.write_text(
        f"file '{body_norm.as_posix()}'\nfile '{cta_norm.as_posix()}'\n",
        encoding="utf-8",
    )
    ff(
        "-f", "concat", "-safe", "0",
        "-i", str(CONCAT_LIST),
        "-c", "copy",
        str(OUT),
    )

    # scene3 alias pour futurs assemble
    shutil.copy2(cta_muxed, OUT_DIR / "scene3_logo_LATEST.mp4")

    dur = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(OUT)],
        capture_output=True, text=True,
    ).stdout.strip()
    size_mb = OUT.stat().st_size / (1024 * 1024)
    print(f"OK -> {OUT}")
    print(f"Durée : {float(dur):.2f} s · {size_mb:.1f} Mo")
    print("Corps (0–21.6s) préservé depuis BEFORE_CTA (SFX/animations).")
    print("CTA : Essai 14 jours · Sans engagement · noviaai.ca (+ audio fin originale)")


def main() -> int:
    print("1/3 — CTA visuel…")
    build_cta_video()
    print("2/3 — Audio de fin originale (bruits/musique)…")
    build_cta_audio_from_original()
    print("3/3 — Assemblage sans casser le corps…")
    assemble()
    return 0


if __name__ == "__main__":
    sys.exit(main())
