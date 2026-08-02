#!/usr/bin/env python3
"""NoviaAI — scene 3 : carton final logo.

Il n'existe aucun fichier de logo dans le projet : sur le site, la marque est un
mot-symbole en texte (« Novia » en marine + « AI » en accent lime, graisse 800,
interlettrage resserre — voir .landing-logo dans assets/landing.css). Il est donc
reconstruit ici avec les couleurs exactes de la charte, sur le degrade de marque
inverse pour un fond sombre.

Le son enchaine l'accord de la scene 2 sans coupure, comme entre les scenes 1 et 2.

Usage:
    python scene3_logo.py [--preview] [--no-audio]
"""
from __future__ import annotations

import argparse
import math
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import scene1_garage as s1
from scene1_garage import W, H, FPS, LIME, WHITE, ease_out, font, smoothstep

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "output" / "noviaai_demo_pme"
WORK = OUT_DIR / "_work"

DURATION = 3.40
NFRAMES = int(DURATION * FPS)
SR = s1.SR

# Voir PAD_GAIN dans scene2_client.py : calibre par `python check_raccord.py`
PAD_GAIN = 0.120

# ---------------------------------------------------------------- beat sheet
T_LOGO = 0.18            # le mot-symbole se pose
T_RULE = 0.95            # le trait lime se trace
T_LINE = 1.25            # la promesse
T_URL = 2.00             # l'adresse

TAGLINE = "Ne manquez plus un seul appel."
URL = "noviaai.ca"

# Degrade de marque (landing.css) : #0a1628 -> #13325b a 55 % -> #1c4a86
G_TOP = np.array([10, 22, 40], np.float32)
G_MID = np.array([19, 50, 91], np.float32)
G_BOT = np.array([28, 74, 134], np.float32)


def background(t: float) -> Image.Image:
    """Degrade de marque en diagonale, avec une derive tres lente."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    # axe diagonal equivalent au 160deg du CSS, legerement anime
    drift = 0.02 * math.sin(t * 0.55)
    p = np.clip((yy / H) * 0.88 + (xx / W) * 0.12 + drift, 0, 1)
    lo = p / 0.55
    hi = (p - 0.55) / 0.45
    grad = np.where(
        p[..., None] < 0.55,
        G_TOP + (G_MID - G_TOP) * np.clip(lo, 0, 1)[..., None],
        G_MID + (G_BOT - G_MID) * np.clip(hi, 0, 1)[..., None],
    )
    img = Image.fromarray(np.clip(grad, 0, 255).astype(np.uint8))

    # halo lime tres diffus derriere le logo, qui respire
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    breathe = 0.5 + 0.5 * math.sin(t * 1.5 - 1.2)
    r = int(430 + 24 * breathe)
    cy = int(H * 0.415)
    gd.ellipse([W // 2 - r, cy - int(r * 0.62), W // 2 + r, cy + int(r * 0.62)],
               fill=(*LIME, int(30 + 12 * breathe)))
    glow = glow.filter(ImageFilter.GaussianBlur(150))
    return Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")


def _spaced_width(d: ImageDraw.ImageDraw, parts, f, extra: float) -> float:
    total = 0.0
    for text, _ in parts:
        for ch in text:
            total += d.textlength(ch, font=f) + extra
    return total - extra


def wordmark(t: float) -> Image.Image:
    """« Novia » blanc + « AI » lime. L'interlettrage se resserre en se posant."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    a = smoothstep((t - T_LOGO) / 0.45)
    if a <= 0.01:
        return layer

    d = ImageDraw.Draw(layer)
    f = font(140, True)
    parts = [("Novia", WHITE), ("AI", LIME)]

    settle = ease_out((t - T_LOGO) / 0.95)
    extra = 30 * (1 - settle)           # l'interlettrage part large et se resserre
    rise = 18 * (1 - settle)

    x = (W - _spaced_width(d, parts, f, extra)) / 2
    y = H * 0.355 + rise
    for text, color in parts:
        for ch in text:
            d.text((x, y), ch, font=f, fill=(*color, int(255 * a)))
            x += d.textlength(ch, font=f) + extra

    # balayage speculaire, contenu dans le trace des lettres
    sweep = smoothstep((t - T_LOGO - 0.55) / 0.85)
    if 0.01 < sweep < 0.99:
        band = Image.new("L", (W, H), 0)
        bd = ImageDraw.Draw(band)
        cx = int(-260 + (W + 520) * sweep)
        for i in range(-110, 111):
            v = int(190 * math.cos(i / 110 * math.pi / 2) ** 2)
            bd.line([(cx + i + 150, 0), (cx + i - 150, H)], fill=v, width=3)
        band = band.filter(ImageFilter.GaussianBlur(18))
        shine = Image.new("RGBA", (W, H), (255, 255, 255, 0))
        shine.putalpha(Image.fromarray(
            (np.asarray(band, np.float32) * np.asarray(layer.getchannel("A"), np.float32)
             / 255.0 * 0.55).astype(np.uint8)))
        layer = Image.alpha_composite(layer, shine)

    return layer


def furniture(t: float) -> Image.Image:
    """Trait lime, promesse, adresse."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    ry = int(H * 0.487)
    rule = ease_out((t - T_RULE) / 0.55)
    if rule > 0.01:
        half = int(150 * rule)
        d.rounded_rectangle([W // 2 - half, ry, W // 2 + half, ry + 5], radius=3,
                            fill=(*LIME, int(235 * min(rule * 2, 1))))

    a = smoothstep((t - T_LINE) / 0.45)
    if a > 0.01:
        f = font(50, False)
        y = int(H * 0.535 + 12 * (1 - ease_out((t - T_LINE) / 0.6)))
        d.text((W // 2, y), TAGLINE, font=f, fill=(*WHITE, int(232 * a)), anchor="ma")

    a = smoothstep((t - T_URL) / 0.45)
    if a > 0.01:
        f = font(44, True)
        y = int(H * 0.612 + 10 * (1 - ease_out((t - T_URL) / 0.6)))
        d.text((W // 2, y), URL, font=f, fill=(*LIME, int(245 * a)), anchor="ma")

    return layer


def finish(arr: np.ndarray, t: float) -> np.ndarray:
    """Vignette + grain seulement : pas d'etalonnage teal-orange, le fond est deja
    a la couleur de la marque et un virage le salirait."""
    x = arr.astype(np.float32) / 255.0

    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    x *= np.clip(1.0 - 0.34 * np.clip(r - 0.45, 0, None) ** 1.5, 0, 1)[..., None]

    rng = np.random.default_rng(int(t * 1000) & 0xFFFF)
    x += rng.normal(0, 0.008, x.shape).astype(np.float32)
    return np.clip(x * 255, 0, 255).astype(np.uint8)


def compose(t: float) -> Image.Image:
    img = background(t).convert("RGBA")
    img = Image.alpha_composite(img, wordmark(t))
    img = Image.alpha_composite(img, furniture(t))
    return Image.fromarray(finish(np.asarray(img.convert("RGB")), t))


# ------------------------------------------------------------------- audio
def synth_audio(path: Path) -> None:
    n = int(DURATION * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(23)
    mix = np.zeros(n, np.float32)

    # air propre, plus large que l'habitacle de la scene 2
    brown = np.cumsum(rng.normal(0, 1, n).astype(np.float32))
    brown /= np.max(np.abs(brown)) + 1e-9
    mix += brown * 0.05

    # Pont sonore avec la scene 2 : le meme accord, au meme niveau, sans fondu.
    pad = (np.sin(2 * np.pi * 82.4 * t) * 0.50 + np.sin(2 * np.pi * 164.8 * t) * 0.22
           + np.sin(2 * np.pi * 246.0 * t) * 0.08 + np.sin(2 * np.pi * 123.5 * t) * 0.14)
    bright = np.sin(2 * np.pi * 207.65 * t) * 0.30 + np.sin(2 * np.pi * 311.1 * t) * 0.14
    mix += ((pad * 1.80 + bright * 1.35 * 0.70) * PAD_GAIN).astype(np.float32)

    # l'octave superieure s'ouvre sur le logo : la resolution
    top = np.sin(2 * np.pi * 415.3 * t) * 0.18 + np.sin(2 * np.pi * 622.25 * t) * 0.08
    mix += (top * np.clip((t - T_LOGO) / 1.20, 0, 1) * PAD_GAIN * 1.6).astype(np.float32)

    # signature : deux notes claires quand le mot-symbole se pose
    i0 = int(T_LOGO * SR)
    ln = min(int(1.60 * SR), n - i0)
    lt = np.arange(ln) / SR
    sig = np.zeros(ln, np.float32)
    for offset, freq, lvl in ((0.0, 1244.5, 1.0), (0.14, 1661.2, 0.72)):
        k = int(offset * SR)
        seg = np.arange(ln - k) / SR
        sig[k:] += (lvl * (np.sin(2 * np.pi * freq * seg) * np.exp(-seg * 3.2)
                           + 0.22 * np.sin(2 * np.pi * freq * 2 * seg)
                           * np.exp(-seg * 7))).astype(np.float32)
    mix[i0:i0 + ln] += sig * 0.16

    head = int(0.015 * SR)
    mix[:head] *= np.linspace(0, 1, head)
    tail = int(0.55 * SR)          # la publicite se termine : fondu franc
    mix[-tail:] *= np.linspace(1, 0, tail) ** 1.5

    mix /= max(np.max(np.abs(mix)), 1e-6)
    mix *= 0.85
    stereo = np.stack([mix, mix * 0.98], axis=1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)

    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())


# -------------------------------------------------------------------- main
def render(with_audio: bool = True, preview: bool = False) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)

    silent = WORK / "scene3_silent.mp4"
    print(f"[1/3] Rendu de {NFRAMES} images...")
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
         str(silent)],
        stdin=subprocess.PIPE,
    )
    preview_at = {int(x * FPS) for x in (0.5, 1.1, 1.6, 2.4, 3.2)}
    for i in range(NFRAMES):
        t = i / FPS
        img = compose(t)
        if preview and i in preview_at:
            img.save(OUT_DIR / f"scene3_frame_{t:.1f}s.jpg", quality=92)
        proc.stdin.write(np.asarray(img, dtype=np.uint8).tobytes())
        if i % 30 == 0:
            print(f"      {i}/{NFRAMES}", flush=True)
    proc.stdin.close()
    proc.wait()

    out = OUT_DIR / "scene3_logo_LATEST.mp4"
    if with_audio:
        print("[2/3] Synthese du son...")
        wav = WORK / "scene3_audio.wav"
        synth_audio(wav)
        print("[3/3] Mixage...")
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(silent), "-i", str(wav),
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(out)],
            check=True,
        )
    else:
        silent.replace(out)

    print(f"OK -> {out}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Rendu du carton final NoviaAI")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()
    render(with_audio=not args.no_audio, preview=args.preview)
    return 0


if __name__ == "__main__":
    sys.exit(main())
