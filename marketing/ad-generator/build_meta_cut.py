#!/usr/bin/env python3
"""Montage court optimise Meta Ads a partir des scenes deja rendues.

Corrige les cinq points qui plombaient la version longue :
  1. hook lisible des la premiere image      -> scene1_garage.py (CAPTIONS)
  2. chiffre choc « 1 800 $ / mois »          -> scene1_garage.py (CAPTIONS)
  3. plus de temps mort avant la demo         -> scene 2 attaquee apres le raccroche
  4. bulles SMS lisibles dans le fil          -> punch-in fixe sur le telephone
  5. carte CTA recentree, zone sure respectee -> render_cta_frame ci-dessous

Sortie : pub_noviaai_META.mp4 (~18 s) + pub_noviaai_META_15s.mp4

Usage:
    python build_meta_cut.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "output" / "noviaai_demo_pme"
WORK = OUT_DIR / "_work" / "meta"
sys.path.insert(0, str(ROOT.parent / "video-pipeline"))

W, H, FPS = 1080, 1920, 30

NAVY = (19, 50, 91)
NAVY_D = (10, 24, 46)
LIME = (200, 241, 53)
WHITE = (252, 250, 245)
MUTED = (168, 182, 202)

SCENE1 = OUT_DIR / "scene1_garage_LATEST.mp4"
SCENE2 = OUT_DIR / "scene2_client_LATEST.mp4"
OUT = OUT_DIR / "pub_noviaai_META.mp4"
OUT_SHORT = OUT_DIR / "pub_noviaai_META_15s.mp4"

# Scene 2 : on saute l'attente muette (0 -> 3.5 s) qui faisait decrocher,
# on entre direct sur l'appel termine puis le fil de conversation.
S2_IN = 3.50
S2_CUT = 5.95          # bascule vers le fil : on punche pour rendre les SMS lisibles
S2_OUT = 13.70         # juste apres l'envoi du « 9 h demain »
ZOOM = 1.30            # punch-in sur le telephone (centre optique y=1050)
PHONE_CY = 1050

CTA_DUR = 3.6


# --------------------------------------------------------------------- outils
def ff(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-v", "error", *args], check=True)


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def _font(size: int, bold: bool = True):
    for p in (
        Path("C:/Windows/Fonts/segoeuib.ttf") if bold else Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf") if bold else Path("C:/Windows/Fonts/arial.ttf"),
    ):
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


# ------------------------------------------------------------------ carte CTA
def render_cta_frame(t: float) -> np.ndarray:
    """Bloc centre verticalement — Meta masque le bas de l'ecran (boutons, pseudo)."""
    img = Image.new("RGB", (W, H), NAVY_D)
    d = ImageDraw.Draw(img)
    for y in range(H):
        k = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(NAVY_D[i] * (1 - k) + NAVY[i] * k) for i in range(3)))

    enter = min(t / 0.35, 1.0)
    enter = 1 - (1 - enter) ** 3
    scale = 0.93 + 0.07 * enter

    # Le bloc entier est centre sur 45 % de la hauteur : au-dessus des boutons
    # Meta, en dessous du pseudo du compte.
    cy = int(H * 0.45)

    f_brand = _font(int(84 * scale), True)
    bb_n = d.textbbox((0, 0), "Novia", font=f_brand)
    bb_a = d.textbbox((0, 0), "AI", font=f_brand)
    brand_w = (bb_n[2] - bb_n[0]) + (bb_a[2] - bb_a[0])
    brand_y = cy - int(250 * scale)
    x = (W - brand_w) // 2
    d.text((x, brand_y), "Novia", font=f_brand, fill=WHITE)
    d.text((x + (bb_n[2] - bb_n[0]), brand_y), "AI", font=f_brand, fill=LIME)

    f_big = _font(int(86 * scale), True)
    bb = d.textbbox((0, 0), "Essai 14 jours", font=f_big)
    big_y = cy - int(90 * scale)
    d.text(((W - (bb[2] - bb[0])) // 2, big_y), "Essai 14 jours", font=f_big, fill=WHITE)

    f_sub = _font(int(44 * scale), False)
    sub = "Sans contrat · Annulable en un clic"
    bb = d.textbbox((0, 0), sub, font=f_sub)
    sub_y = big_y + int(112 * scale)
    d.text(((W - (bb[2] - bb[0])) // 2, sub_y), sub, font=f_sub, fill=MUTED)

    # Pastille lime — l'element le plus lumineux de la carte
    f_pill = _font(int(56 * scale), True)
    bb = d.textbbox((0, 0), "noviaai.ca", font=f_pill)
    pw, ph = bb[2] - bb[0], bb[3] - bb[1]
    px, py = (W - pw) // 2, sub_y + int(120 * scale)
    pulse = 1 + 0.03 * np.sin(t * 3.4)
    padx, pady = int(54 * pulse), int(26 * pulse)
    d.rounded_rectangle(
        [px - padx, py - pady, px + pw + padx, py + ph + pady + 8],
        radius=int(46 * pulse), fill=LIME,
    )
    d.text((px, py), "noviaai.ca", font=f_pill, fill=NAVY_D)

    f_hint = _font(34, False)
    hint = "Places fondateur limitées"
    bb = d.textbbox((0, 0), hint, font=f_hint)
    d.text(((W - (bb[2] - bb[0])) // 2, py + ph + pady + 64), hint, font=f_hint, fill=MUTED)

    return np.array(img)


def build_cta(path: Path) -> None:
    try:
        from moviepy import VideoClip
    except ImportError:
        from moviepy.editor import VideoClip

    clip = VideoClip(lambda t: render_cta_frame(t), duration=CTA_DUR)
    clip = clip.with_fps(FPS) if hasattr(clip, "with_fps") else clip.set_fps(FPS)
    clip.write_videofile(str(path), fps=FPS, codec="libx264", audio=False,
                         preset="medium", threads=4, logger=None)
    clip.close()


# ------------------------------------------------------------------ segments
ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
       "-r", str(FPS), "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2"]


def cut(src: Path, dst: Path, start: float, end: float, *, zoom: float = 1.0,
        afade_in: float = 0.0, afade_out: float = 0.0) -> None:
    dur = end - start
    vf = [f"fps={FPS}"]
    if zoom > 1.0:
        cw = int(W / zoom) // 2 * 2
        ch = int(H / zoom) // 2 * 2
        cx = (W - cw) // 2
        cy = max(0, min(PHONE_CY - ch // 2, H - ch))
        vf.append(f"crop={cw}:{ch}:{cx}:{cy},scale={W}:{H}:flags=lanczos")
    af = []
    if afade_in:
        af.append(f"afade=t=in:st=0:d={afade_in}")
    if afade_out:
        af.append(f"afade=t=out:st={max(dur - afade_out, 0):.3f}:d={afade_out}")

    args = ["-ss", f"{start}", "-t", f"{dur}", "-i", str(src), "-vf", ",".join(vf)]
    if af:
        args += ["-af", ",".join(af)]
    ff(*args, *ENC, str(dst))


def silent_audio_over(video: Path, bed_src: Path, bed_start: float, dst: Path) -> None:
    """Colle un lit sonore pris ailleurs sous une carte muette."""
    dur = probe_duration(video)
    ff("-i", str(video),
       "-ss", f"{bed_start}", "-t", f"{dur}", "-i", str(bed_src),
       "-map", "0:v:0", "-map", "1:a:0",
       "-af", f"afade=t=out:st={max(dur - 0.9, 0):.3f}:d=0.9,volume=0.75",
       *ENC, "-shortest", str(dst))


def concat(parts: list[Path], dst: Path) -> None:
    listing = WORK / f"concat_{dst.stem}.txt"
    listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    raw = WORK / f"raw_{dst.stem}.mp4"
    ff("-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(raw))
    # Meta normalise autour de -14 LUFS : autant livrer deja au bon niveau.
    ff("-i", str(raw), "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
       "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", str(dst))


def main() -> int:
    for p in (SCENE1, SCENE2):
        if not p.exists():
            raise FileNotFoundError(p)
    WORK.mkdir(parents=True, exist_ok=True)

    print("1/5 — hook + chiffre (scene 1)…")
    a = WORK / "a_hook.mp4"
    cut(SCENE1, a, 0.0, probe_duration(SCENE1), afade_out=0.10)

    print("2/5 — appel terminé + texto NoviaAI…")
    b1 = WORK / "b1_sms.mp4"
    cut(SCENE2, b1, S2_IN, S2_CUT, afade_in=0.10)

    print("3/5 — fil de conversation (punch-in lisibilité)…")
    b2 = WORK / "b2_thread.mp4"
    cut(SCENE2, b2, S2_CUT, S2_OUT, zoom=ZOOM)

    print("4/5 — carte CTA…")
    cta_silent = WORK / "cta_silent.mp4"
    cta = WORK / "cta.mp4"
    build_cta(cta_silent)
    silent_audio_over(cta_silent, SCENE2, S2_OUT, cta)

    print("5/5 — assemblage + normalisation loudness…")
    concat([a, b1, b2, cta], OUT)

    # Variante courte : on coupe dans le fil, le RDV se devine.
    short_b2 = WORK / "b2_short.mp4"
    cut(SCENE2, short_b2, S2_CUT, S2_CUT + 4.6, zoom=ZOOM)
    concat([a, b1, short_b2, cta], OUT_SHORT)

    for p in (OUT, OUT_SHORT):
        print(f"OK -> {p.name}  {probe_duration(p):.2f} s  "
              f"{p.stat().st_size / (1024 * 1024):.1f} Mo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
