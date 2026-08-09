#!/usr/bin/env python3
"""Scene 1 « L'appel manqué » — garage. Rendu 100% local, sans Runway.

Plaque video reelle (Pexels 4K) + telephone compose en PIL + design sonore
synthetise en numpy. Sortie 1080x1920 @30fps, ~5.6 s.

Usage:
    python scene1_garage.py [--no-audio] [--preview]
"""
from __future__ import annotations

import argparse
import math
import struct
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
CLIPS = ROOT.parent / "video-pipeline" / "clips"
OUT_DIR = ROOT / "output" / "noviaai_demo_pme"
WORK = OUT_DIR / "_work"

SOURCE = CLIPS / "busy_px_garage_mechanic_working_01.mp4"
SRC_START = 2.6          # seconde du plan source ou le mecanicien est en action
PLATE = WORK / "plate_garage.mp4"

W, H, FPS = 1080, 1920, 30
DURATION = 5.6
NFRAMES = int(DURATION * FPS)

PLATE_W, PLATE_H = 1350, 2400   # marge pour le push-in

NAVY = (19, 50, 91)
LIME = (200, 241, 53)
WHITE = (252, 250, 245)

# ---------------------------------------------------------------- beat sheet
T_RING_ON = 1.40         # l'ecran s'allume, 1re vibration
T_FOCUS_START = 2.30     # debut du rack focus vers le telephone
T_FOCUS_END = 3.60
T_MISSED = 4.20          # la sonnerie s'arrete net
T_BADGE = 4.80           # « Appel manque » apparait

# Cadence de sonnerie : deux salves, la seconde coupee net a 4,20 s.
# Sert a la fois au son et au tremblement du telephone sur l'acier.
BUZZ_CYCLES = [(1.40, 2.70), (3.00, 4.20)]

CAPTIONS = [
    # (t_in, t_out, [(mot, couleur), ...])
    # Le hook doit etre lisible des la premiere image : sur Meta la majorite du
    # trafic decroche avant 3 s, un fondu d'entree coute plus cher qu'il rapporte.
    (-0.30, 3.60, [("Trop occupé pour", WHITE), ("répondre?", WHITE)]),
    # Tient sur une seule ligne a 70 px : un chiffre coupe en deux perd sa force.
    (3.85, 5.60, [("1 800 $", LIME), ("perdus par mois", WHITE)]),
]


# ------------------------------------------------------------------- helpers
def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/segoeuisb.ttf" if not bold else "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def ease_out(x: float) -> float:
    x = min(max(x, 0.0), 1.0)
    return 1 - (1 - x) ** 3


def smoothstep(x: float) -> float:
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def buzz_amount(t: float) -> float:
    """1.0 pendant une salve de vibration, 0 sinon (avec attaque/chute courtes)."""
    for start, end in BUZZ_CYCLES:
        if start <= t < end:
            ramp_in = smoothstep((t - start) / 0.06)
            ramp_out = 1.0 if end >= T_MISSED else smoothstep((end - t) / 0.08)
            return ramp_in * ramp_out
    return 0.0


def screen_on(t: float) -> float:
    if t < T_RING_ON:
        return 0.0
    if t < T_MISSED:
        return smoothstep((t - T_RING_ON) / 0.12)
    if t < T_BADGE:
        return max(0.0, 1.0 - (t - T_MISSED) / 0.18) * 0.0   # ecran noir
    return smoothstep((t - T_BADGE) / 0.25) * 0.55           # badge, plus sombre


# ------------------------------------------------------------------- plaque
def build_plate() -> None:
    """Extrait et normalise la fenetre utile du clip source."""
    WORK.mkdir(parents=True, exist_ok=True)
    if PLATE.exists():
        return
    if not SOURCE.exists():
        raise FileNotFoundError(f"Clip source introuvable: {SOURCE}")
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-ss", str(SRC_START), "-t", str(DURATION + 0.4),
        "-i", str(SOURCE),
        "-vf", f"scale={PLATE_W}:{PLATE_H}:flags=lanczos,fps={FPS}",
        "-an", "-c:v", "libx264", "-crf", "12", "-preset", "medium",
        str(PLATE),
    ]
    subprocess.run(cmd, check=True)


def load_plate_frames() -> list[np.ndarray]:
    from moviepy import VideoFileClip

    clip = VideoFileClip(str(PLATE))
    frames = []
    for i in range(NFRAMES):
        t = min(i / FPS, max(clip.duration - 1e-3, 0))
        frames.append(clip.get_frame(t))
    clip.close()
    return frames


# -------------------------------------------------------------------- camera
def camera_crop(frame: np.ndarray, t: float) -> Image.Image:
    """Travelling lateral lent + leger push-in, sur la plaque haute resolution."""
    p = t / DURATION
    scale = 1.24 - 0.13 * ease_out(p)          # push-in progressif
    drift = 0.465 + 0.075 * smoothstep(p)      # derive laterale gauche -> droite
    # micro-instabilite type epaule stabilisee
    jitter_x = math.sin(t * 2.1) * 3 + math.sin(t * 5.7) * 1.5
    jitter_y = math.cos(t * 1.7) * 3 + math.cos(t * 4.3) * 1.2

    cw, ch = W * scale, H * scale
    cx = PLATE_W * drift + jitter_x
    cy = PLATE_H * 0.50 + jitter_y
    x0 = int(round(min(max(cx - cw / 2, 0), PLATE_W - cw)))
    y0 = int(round(min(max(cy - ch / 2, 0), PLATE_H - ch)))
    img = Image.fromarray(frame).crop((x0, y0, x0 + int(cw), y0 + int(ch)))
    return img.resize((W, H), Image.LANCZOS)


def focus_amount(t: float) -> float:
    """0 = nettete sur le mecanicien, 1 = nettete sur le telephone."""
    return smoothstep((t - T_FOCUS_START) / (T_FOCUS_END - T_FOCUS_START))


def rack_focus(img: Image.Image, t: float) -> Image.Image:
    """L'arriere-plan sort du plan focal a mesure que la mise au point descend."""
    amount = focus_amount(t)
    if amount <= 0.01:
        return img
    return img.filter(ImageFilter.GaussianBlur(radius=7.5 * amount))


# --------------------------------------------------------------------- grade
def grade(arr: np.ndarray, t: float) -> np.ndarray:
    """Etalonnage teal & orange discret + vignette + grain."""
    x = arr.astype(np.float32) / 255.0
    x = np.clip(x * 1.10 + 0.020, 0, 1)                       # le plan source est tres sombre
    luma = (x[..., 0] * 0.299 + x[..., 1] * 0.587 + x[..., 2] * 0.114)[..., None]

    shadow_tint = np.array([0.10, 0.20, 0.42], np.float32)   # navy dans les noirs
    highlight_tint = np.array([1.00, 0.72, 0.38], np.float32)  # ambre dans les hautes
    x = x + shadow_tint * ((1 - luma) ** 2) * 0.085
    x = x + highlight_tint * (luma**2.2) * 0.06

    x = (x - 0.5) * 1.14 + 0.5                                # contraste
    grey = x.mean(axis=2, keepdims=True)
    x = grey + (x - grey) * 0.90                              # legere desaturation
    x = np.clip(x, 0, 1)

    # vignette
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    x *= np.clip(1.0 - 0.30 * np.clip(r - 0.55, 0, None) ** 1.6, 0, 1)[..., None]

    # grain 35 mm
    rng = np.random.default_rng(int(t * 1000) & 0xFFFF)
    x += rng.normal(0, 0.010, x.shape).astype(np.float32)

    return np.clip(x * 255, 0, 255).astype(np.uint8)


# ------------------------------------------------------------------ telephone
# Le telephone est un objet d'avant-plan, proche de la camera : grand, decadre
# a gauche, flou tant que la mise au point est restee sur le mecanicien.
PHONE_W, PHONE_H = 372, 768
PHONE_CX, PHONE_CY = 286, 1348
PHONE_ANGLE = -17


def handset_icon(angle: float, size: int = 20) -> Image.Image:
    """Combine telephonique dessine en formes pleines, puis pivote."""
    ss = 4                                    # anticrenelage par suréchantillonnage
    box = size * ss * 2
    img = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = box // 2
    bw = int(11 * ss)        # demi-largeur du combine
    bh = int(7.5 * ss)       # cambrure du manche
    th = int(4.5 * ss)       # epaisseur du manche
    ear = int(5.5 * ss)      # rayon des pavillons

    # manche cambre : anneau elliptique dont on ne garde que la moitie haute
    d.ellipse([c - bw, c - bh, c + bw, c + bh], fill=(255, 255, 255, 255))
    d.ellipse([c - bw + th, c - bh + th, c + bw - th, c + bh - th], fill=(0, 0, 0, 0))
    for sx in (-1, 1):
        ex = c + sx * (bw - th // 2)
        d.ellipse([ex - ear, c - ear - ss, ex + ear, c + ear - ss], fill=(255, 255, 255, 255))
    d.rectangle([0, c + ss, box, box], fill=(0, 0, 0, 0))
    img = img.rotate(angle, resample=Image.BICUBIC)
    return img.resize((size * 2, size * 2), Image.LANCZOS)


def draw_accept_icon(img: Image.Image, cx: int, cy: int) -> None:
    icon = handset_icon(-45)
    img.paste(icon, (cx - icon.width // 2, cy - icon.height // 2), icon)


def draw_decline_icon(img: Image.Image, cx: int, cy: int) -> None:
    icon = handset_icon(135)
    img.paste(icon, (cx - icon.width // 2, cy - icon.height // 2), icon)


def render_screen(t: float) -> Image.Image:
    """Contenu de l'ecran — appel entrant en francais, puis appel manque."""
    sw, sh = PHONE_W - 26, PHONE_H - 26
    img = Image.new("RGB", (sw, sh), (6, 7, 10))
    d = ImageDraw.Draw(img)

    if T_RING_ON <= t < T_MISSED:
        for y in range(sh):                                   # fond d'appel iOS
            k = y / sh
            d.line([(0, y), (sw, y)], fill=(int(14 + 16 * k), int(20 + 26 * k), int(32 + 44 * k)))

        d.text((sw // 2, 96), "Appel entrant", font=font(19, False), fill=(168, 182, 200), anchor="mm")
        d.text((sw // 2, 146), "Numéro inconnu", font=font(30, True), fill=(240, 244, 250), anchor="mm")
        d.text((sw // 2, 182), "mobile", font=font(17, False), fill=(140, 152, 170), anchor="mm")

        pulse = 0.5 + 0.5 * math.sin((t - T_RING_ON) * 7.5)
        cy = sh - 118
        r = 33
        d.ellipse([56 - r, cy - r, 56 + r, cy + r], fill=(198, 52, 48))
        g = int(38 + 40 * pulse)
        d.ellipse([sw - 56 - r, cy - r, sw - 56 + r, cy + r], fill=(g, 190, 90))
        draw_decline_icon(img, 56, cy)
        draw_accept_icon(img, sw - 56, cy)

    elif t >= T_BADGE:
        a = smoothstep((t - T_BADGE) / 0.25)
        d.rectangle([0, 0, sw, sh], fill=(4, 5, 7))
        bx0, bx1 = 20, sw - 20
        by0, by1 = sh // 2 - 66, sh // 2 + 66
        d.rounded_rectangle([bx0, by0, bx1, by1], radius=24,
                            fill=(int(24 * a) + 4, int(26 * a) + 4, int(32 * a) + 5))
        d.ellipse([bx0 + 26, sh // 2 - 32, bx0 + 58, sh // 2], fill=(int(214 * a), int(58 * a), int(52 * a)))
        c = int(235 * a)
        d.text((bx0 + 76, sh // 2 - 22), "Appel manqué", font=font(24, True), fill=(c, c, c))
        c2 = int(150 * a)
        d.text((bx0 + 76, sh // 2 + 12), "Numéro inconnu", font=font(18, False), fill=(c2, c2, c2))

    return img


def render_phone(t: float) -> Image.Image:
    """Corps du telephone + ecran + reflet, en RGBA prêt a composer."""
    body = Image.new("RGBA", (PHONE_W, PHONE_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(body)
    d.rounded_rectangle([0, 0, PHONE_W - 1, PHONE_H - 1], radius=44, fill=(16, 17, 20, 255),
                        outline=(58, 62, 70, 255), width=3)
    d.rounded_rectangle([9, 9, PHONE_W - 10, PHONE_H - 10], radius=36, fill=(3, 3, 5, 255))
    body.paste(render_screen(t), (13, 13))

    # reflet diagonal sur la vitre
    gloss = Image.new("RGBA", (PHONE_W, PHONE_H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gd.polygon([(0, 130), (PHONE_W, -70), (PHONE_W, 90), (0, 300)], fill=(255, 255, 255, 16))
    gloss = gloss.filter(ImageFilter.GaussianBlur(10))
    body = Image.alpha_composite(body, gloss)

    return body.rotate(PHONE_ANGLE, resample=Image.BICUBIC, expand=True)


def composite_phone(base: Image.Image, t: float) -> Image.Image:
    phone = render_phone(t)
    # avant-plan hors du plan focal au depart, il devient net quand la mise au
    # point descend vers lui : c'est ce qui vend le rack focus
    defocus = 8.0 * (1.0 - focus_amount(t))
    if defocus > 0.4:
        pad = int(defocus * 3)
        padded = Image.new("RGBA", (phone.width + pad * 2, phone.height + pad * 2), (0, 0, 0, 0))
        padded.paste(phone, (pad, pad), phone)
        phone = padded.filter(ImageFilter.GaussianBlur(defocus))
    shake = buzz_amount(t)
    # vibration : oscillation rapide + micro-glissement sur l'acier
    ox = shake * (math.sin(t * 92) * 1.7 + math.sin(t * 151) * 0.9)
    oy = shake * (math.cos(t * 88) * 1.3)
    creep = 0.0
    for start, end in BUZZ_CYCLES:
        if t >= start:
            creep += min(t, end) - start
    ox += creep * 2.2

    px = int(PHONE_CX - phone.width / 2 + ox)
    py = int(PHONE_CY - phone.height / 2 + oy)

    out = base.convert("RGBA")

    # lueur froide de l'ecran projetee sur la surface
    glow_level = 0.0
    if T_RING_ON <= t < T_MISSED:
        glow_level = 1.0 * smoothstep((t - T_RING_ON) / 0.15)
    elif T_BADGE <= t:
        glow_level = 0.30 * smoothstep((t - T_BADGE) / 0.3)
    if glow_level > 0:
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        r = 330
        gd.ellipse([PHONE_CX - r, PHONE_CY - r * 0.8, PHONE_CX + r, PHONE_CY + r * 0.8],
                   fill=(74, 132, 214, int(64 * glow_level)))
        glow = glow.filter(ImageFilter.GaussianBlur(90))
        out = Image.alpha_composite(out, glow)

    # ombre de contact sous l'appareil
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse([px + 30, py + phone.height - 130, px + phone.width - 30, py + phone.height - 10],
               fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(34))
    out = Image.alpha_composite(out, shadow)

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    layer.paste(phone, (px, py), phone)
    return Image.alpha_composite(out, layer).convert("RGB")


# ------------------------------------------------------------------- captions
def wrap_tokens(tokens: list[tuple[str, tuple]], f: ImageFont.FreeTypeFont, max_w: int):
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    lines: list[list[tuple[str, tuple]]] = [[]]
    for word, color in tokens:
        candidate = " ".join([w for w, _ in lines[-1]] + [word])
        if probe.textlength(candidate, font=f) <= max_w or not lines[-1]:
            lines[-1].append((word, color))
        else:
            lines.append([(word, color)])
    return lines


def draw_caption(img: Image.Image, t: float, captions: list | None = None,
                 duration: float = DURATION) -> Image.Image:
    for t_in, t_out, tokens in (CAPTIONS if captions is None else captions):
        if not (t_in - 0.01 <= t <= t_out):
            continue
        fade_in = smoothstep((t - t_in) / 0.25)
        fade_out = smoothstep((t_out - t) / 0.20) if t_out < duration else 1.0
        alpha = fade_in * fade_out
        if alpha <= 0.01:
            continue
        rise = int(10 * (1 - ease_out((t - t_in) / 0.35)))

        f = font(70, True)
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        # eclatement en mots pour permettre un mot en lime
        flat: list[tuple[str, tuple]] = []
        for chunk, color in tokens:
            for word in chunk.split():
                flat.append((word, color))
        lines = wrap_tokens(flat, f, W - 200)

        y0 = int(H * 0.20) + rise

        # Voile sombre derriere le bloc : le plan garage est contraste, sans lui
        # le texte se perd sur les zones eclairees par la lampe.
        widest = max(d.textlength(" ".join(w for w, _ in line), font=f) for line in lines)
        scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(scrim).rounded_rectangle(
            [int((W - widest) / 2) - 46, y0 - 34,
             int((W + widest) / 2) + 46, y0 + 86 * len(lines) + 6],
            radius=44,
            fill=(0, 0, 0, int(120 * alpha)),
        )
        layer = Image.alpha_composite(scrim.filter(ImageFilter.GaussianBlur(26)), layer)
        d = ImageDraw.Draw(layer)

        y = y0
        for line in lines:
            total = d.textlength(" ".join(w for w, _ in line), font=f)
            x = (W - total) / 2
            for word, color in line:
                for dx, dy in ((-3, 0), (3, 0), (0, -3), (0, 3), (-2, -2), (2, 2)):
                    d.text((x + dx, y + dy), word, font=f, fill=(0, 0, 0, int(170 * alpha)))
                d.text((x, y), word, font=f, fill=(*color, int(255 * alpha)))
                x += d.textlength(word + " ", font=f)
            y += 86
        img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    return img


# ---------------------------------------------------------------- sound design
SR = 44100

# --- Anatomie d'une sonnerie de telephone -----------------------------------
# « moderne » : sonnerie de smartphone par defaut, timbre marimba. Une lame de
#   marimba est accordee pour que son 1er partiel soit 2 octaves au-dessus du
#   fondamental (x4), d'ou l'attaque tres courte (<5 ms) et la decroissance
#   exponentielle rapide. Motif arpege, ~150 BPM en doubles croches.
# « classique » : sonnerie electromecanique. Deux gongs accordes autour de
#   1050 et 1300 Hz frappes alternativement par un marteau a 20 Hz — c'est ce
#   battement a 20 Hz qui produit le « drrring », pas la hauteur des gongs.
#   A ne pas confondre avec la tonalite de retour d'appel nord-americaine
#   (440 + 480 Hz, cadence 2 s / 4 s), que seul l'appelant entend.
MARIMBA_PATTERN = [  # (offset en s, frequence en Hz)
    (0.00, 523.25), (0.16, 659.25), (0.32, 783.99), (0.48, 659.25),
    (0.64, 880.00), (0.80, 783.99), (0.96, 659.25), (1.12, 523.25),
]


def marimba_note(freq: float, length: int, rng: np.random.Generator) -> np.ndarray:
    lt = np.arange(length) / SR
    attack = np.minimum(lt / 0.004, 1.0)
    body = np.sin(2 * np.pi * freq * lt) * np.exp(-lt * 6.5)
    p1 = np.sin(2 * np.pi * freq * 4.0 * lt) * np.exp(-lt * 15.0) * 0.30
    p2 = np.sin(2 * np.pi * freq * 9.2 * lt) * np.exp(-lt * 28.0) * 0.10
    mallet = rng.normal(0, 1, length) * np.exp(-lt * 320) * 0.05
    return ((body + p1 + p2 + mallet) * attack).astype(np.float32)


def ringtone(style: str, start: float, end: float, rng: np.random.Generator) -> tuple[int, np.ndarray]:
    """Retourne (index de depart, signal) pour une salve de sonnerie."""
    i0, i1 = int(start * SR), int(end * SR)
    length = max(i1 - i0, 0)
    out = np.zeros(length, np.float32)
    if length == 0:
        return i0, out

    if style == "classique":
        lt = np.arange(length) / SR
        strike = np.exp(-np.mod(lt, 1 / 20.0) * 95)          # marteau a 20 Hz
        gongs = (np.sin(2 * np.pi * 1050 * lt) * 0.60
                 + np.sin(2 * np.pi * 1300 * lt) * 0.45
                 + np.sin(2 * np.pi * 2100 * lt) * 0.18)
        clapper = rng.normal(0, 1, length) * np.exp(-np.mod(lt, 1 / 20.0) * 900) * 0.20
        out = ((gongs + clapper) * strike).astype(np.float32)
    else:
        for offset, freq in MARIMBA_PATTERN:
            n0 = int(offset * SR)
            if n0 >= length:
                break
            seg_len = min(int(0.60 * SR), length - n0)
            out[n0:n0 + seg_len] += marimba_note(freq, seg_len, rng)

    fade = int(0.006 * SR)                                    # anti-clic
    out[:fade] *= np.linspace(0, 1, fade)
    if end < T_MISSED:                                        # chute naturelle
        tail = int(0.05 * SR)
        out[-tail:] *= np.linspace(1, 0, tail)
    return i0, out


def synth_audio(path: Path, ringtone_style: str = "moderne") -> None:
    n = int(DURATION * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(7)
    mix = np.zeros(n, np.float32)

    # --- fond d'atelier : bruit brun filtre + ronronnement de compresseur
    noise = rng.normal(0, 1, n).astype(np.float32)
    brown = np.cumsum(noise)
    brown /= np.max(np.abs(brown)) + 1e-9
    room = brown * 0.14 + np.sin(2 * np.pi * 118 * t) * 0.012 + np.sin(2 * np.pi * 61 * t) * 0.018
    # ducking narratif : l'ambiance recule quand il entend le telephone
    duck = np.ones(n, np.float32)
    d0, d1 = int(2.30 * SR), int(2.70 * SR)
    duck[d0:d1] = np.linspace(1.0, 0.45, d1 - d0)
    duck[d1:] = 0.45
    mix += room * duck

    # --- cle a chocs lointaine
    for start in (0.80, 3.90):
        i0 = int(start * SR)
        length = int(0.42 * SR)
        env = np.exp(-np.linspace(0, 7, length))
        rattle = (rng.normal(0, 1, length) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 32 * np.arange(length) / SR))))
        seg = (rattle * env * 0.05).astype(np.float32)
        mix[i0:i0 + length] += seg * duck[i0:i0 + length]

    # --- sonnerie + resonance du boitier sur l'etabli en acier
    for start, end in BUZZ_CYCLES:
        i0, ring = ringtone(ringtone_style, start, end, rng)
        if ring.size == 0:
            continue
        mix[i0:i0 + ring.size] += ring * 0.42

        lt = np.arange(ring.size) / SR
        rattle = 0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 47 * lt))
        buzz = (np.sin(2 * np.pi * 58 * lt) * 0.55 + np.sin(2 * np.pi * 116 * lt) * 0.25) * rattle
        env = np.clip(np.minimum(lt / 0.02, 1.0), 0, 1)
        mix[i0:i0 + ring.size] += (buzz * env * 0.10).astype(np.float32)

    # --- sub-drone de tension (ressenti plus qu'entendu)
    s0, s1 = int(2.60 * SR), int(T_MISSED * SR)
    st = np.arange(s1 - s0) / SR
    freq = 42 + 16 * (st / max(st[-1], 1e-6))
    sub = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.linspace(0, 0.24, s1 - s0)
    mix[s0:s1] += sub.astype(np.float32)

    # --- coupure nette + silence : l'ambiance tombe a presque rien
    c0 = int(T_MISSED * SR)
    c1 = int((T_BADGE - 0.05) * SR)
    tail = np.exp(-np.linspace(0, 6, c1 - c0))
    mix[c0:c1] *= (0.12 + 0.30 * tail).astype(np.float32)
    mix[c1:] *= 0.38

    # --- tick de notification « appel manque »
    i0 = int(T_BADGE * SR)
    length = int(0.09 * SR)
    lt = np.arange(length) / SR
    tick = (np.sin(2 * np.pi * 1750 * lt) + 0.5 * np.sin(2 * np.pi * 2600 * lt)) * np.exp(-lt * 55)
    mix[i0:i0 + length] += (tick * 0.16).astype(np.float32)

    # --- premiere note de la pub (pre-lap vers la scene 2)
    m0 = int(5.15 * SR)
    lt = np.arange(n - m0) / SR
    note = (np.sin(2 * np.pi * 82.4 * lt) * 0.5 + np.sin(2 * np.pi * 164.8 * lt) * 0.22
            + np.sin(2 * np.pi * 246 * lt) * 0.08)
    mix[m0:] += (note * np.minimum(lt / 0.25, 1.0) * 0.22).astype(np.float32)

    # fondu d'entree + normalisation douce
    fade = int(0.15 * SR)
    mix[:fade] *= np.linspace(0, 1, fade)
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


# ----------------------------------------------------------------------- main
def render(with_audio: bool = True, preview: bool = False, ringtone_style: str = "moderne") -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)

    print("[1/4] Preparation de la plaque garage 4K...")
    build_plate()
    frames = load_plate_frames()

    silent = WORK / "scene1_silent.mp4"
    print(f"[2/4] Rendu de {NFRAMES} images composees...")
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
         str(silent)],
        stdin=subprocess.PIPE,
    )
    preview_frames = {int(1.0 * FPS), int(2.0 * FPS), int(3.4 * FPS), int(5.1 * FPS)}
    for i in range(NFRAMES):
        t = i / FPS
        img = camera_crop(frames[i], t)
        img = rack_focus(img, t)
        img = composite_phone(img, t)
        img = Image.fromarray(grade(np.asarray(img), t))
        img = draw_caption(img, t)
        if preview and i in preview_frames:
            img.save(OUT_DIR / f"scene1_frame_{t:.1f}s.jpg", quality=92)
        proc.stdin.write(np.asarray(img, dtype=np.uint8).tobytes())
        if i % 30 == 0:
            print(f"      {i}/{NFRAMES}")
    proc.stdin.close()
    proc.wait()

    out = OUT_DIR / "scene1_garage_LATEST.mp4"
    if with_audio:
        print(f"[3/4] Synthese du design sonore (sonnerie {ringtone_style})...")
        wav = WORK / "scene1_audio.wav"
        synth_audio(wav, ringtone_style)
        print("[4/4] Mixage audio + video...")
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
    ap = argparse.ArgumentParser(description="Rendu scene 1 garage, sans Runway")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--preview", action="store_true", help="Exporte quelques images fixes")
    ap.add_argument("--ringtone", choices=("moderne", "classique"), default="moderne",
                    help="moderne = marimba smartphone, classique = cloche electromecanique")
    ap.add_argument("--audio-only", action="store_true", help="Regenere seulement la piste son")
    args = ap.parse_args()
    if args.audio_only:
        wav = WORK / "scene1_audio.wav"
        synth_audio(wav, args.ringtone)
        silent = WORK / "scene1_silent.mp4"
        out = OUT_DIR / "scene1_garage_LATEST.mp4"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(silent), "-i", str(wav),
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(out)],
            check=True,
        )
        print(f"OK -> {out}")
        return 0
    render(with_audio=not args.no_audio, preview=args.preview, ringtone_style=args.ringtone)
    return 0


if __name__ == "__main__":
    sys.exit(main())
