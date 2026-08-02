#!/usr/bin/env python3
"""Scene 2 « Il n'a pas attendu » — le client. Rendu 100% local, sans Runway.

Plaque generee par GPT Image (client dans son auto) + ecran de telephone
compose en PIL + design sonore synthetise. Enchaine directement la scene 1 :
la sonnerie qu'on entendait cote garage devient ici la tonalite de retour
d'appel que le client, lui, entend dans son oreille.

Usage:
    python scene2_client.py [--preview] [--no-audio] [--regen-plate]
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
from scene1_garage import W, H, FPS, LIME, WHITE, ease_out, font, grade, smoothstep

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "output" / "noviaai_demo_pme"
WORK = OUT_DIR / "_work"
PLATE_PNG = WORK / "scene2_plate.png"

DURATION = 16.00
NFRAMES = int(DURATION * FPS)
PLATE_W, PLATE_H = 1600, 2400

# ---------------------------------------------------------------- beat sheet
T_RING_END = 2.15        # fin de la salve de tonalite (cadence 2 s / 4 s)
T_HANGUP = 3.00          # il raccroche pendant le silence, sans attendre la suite
T_CUT = 3.05             # coupe franche vers l'insert telephone
T_SMS = 4.20             # la banniere de texto tombe : NoviaAI a repondu
T_THREAD = 5.85          # bascule vers la conversation (banniere tenue 1,65 s)
T_REPLY = 7.65           # le client repond
T_BOOK = 9.45            # NoviaAI propose un rendez-vous
T_TYPE = 10.75           # il tape son choix : le rendez-vous se prend tout seul
T_SEND = 12.30           # il envoie — le rendez-vous est pris
TYPED = "9 h demain"

# Le titre sort avant la fin : les dernieres secondes appartiennent au fil de
# conversation, pour que l'oeil finisse sur la prise de rendez-vous.
CAPTIONS = [
    (5.30, 10.60, [("NoviaAI", LIME), ("a répondu pour vous.", WHITE)]),
]

GARAGE_NAME = "Garage Rive-Sud"
SMS_PREVIEW = "Désolé, on a manqué votre appel! On est en atelier…"
THREAD = [
    # (temps d'apparition, cote, texte)
    (T_THREAD, "recu", "Désolé, on a manqué votre appel! On est en atelier. "
                       "Je peux vous aider par texto — c'est pour quel véhicule?"),
    (T_REPLY, "envoye", "Civic 2019, les freins font du bruit."),
    (T_BOOK, "recu", "Parfait. J'ai une place demain 9 h ou 13 h. Laquelle vous convient?"),
    (T_SEND, "envoye", TYPED),
]

PLATE_PROMPT = (
    "Photorealistic cinematic advertising still, vertical composition. Interior of a parked car in "
    "suburban Quebec, late afternoon. A 40-year-old man with short hair and a plain dark jacket sits "
    "in the drivers seat, holding a smartphone to his right ear, waiting for someone to answer. "
    "Impatient micro-expression: slightly furrowed brow, tight jaw, eyes looking away through the "
    "windshield. Warm low sunlight through the drivers side window creating a rim light on his cheek "
    "and shoulder, cool blue shadows filling the car interior. Softly blurred street visible through "
    "the windshield. Shot from the passenger seat, 50mm lens, f/2.0, shallow depth of field, natural "
    "realistic skin texture, subtle film grain, muted teal and orange color grade, premium tech "
    "commercial aesthetic. No text, no logos, no watermark, no distorted hands or fingers."
)


# -------------------------------------------------------------------- plaque
def build_plate(regen: bool = False) -> Image.Image:
    if regen or not PLATE_PNG.exists():
        from openai_image import generate_image

        generate_image(PLATE_PROMPT, PLATE_PNG, model="gpt-image-1",
                       size="1024x1536", quality="high")
    img = Image.open(PLATE_PNG).convert("RGB")
    return img.resize((PLATE_W, PLATE_H), Image.LANCZOS)


def crop_from_plate(plate: Image.Image, scale: float, cx: float, cy: float) -> Image.Image:
    cw, ch = W * scale, H * scale
    x0 = min(max(cx - cw / 2, 0), PLATE_W - cw)
    y0 = min(max(cy - ch / 2, 0), PLATE_H - ch)
    box = (int(round(x0)), int(round(y0)), int(round(x0 + cw)), int(round(y0 + ch)))
    return plate.crop(box).resize((W, H), Image.LANCZOS)


def plan_a(plate: Image.Image, t: float) -> Image.Image:
    """Il attend. Push-in lent sur son visage, image nette."""
    p = t / T_CUT
    scale = 1.20 - 0.09 * ease_out(p)
    jx = math.sin(t * 2.3) * 4 + math.sin(t * 6.1) * 1.6
    jy = math.cos(t * 1.9) * 3
    return crop_from_plate(plate, scale, 880 + jx, PLATE_H * 0.50 + jy)


def plan_b(plate: Image.Image, t: float) -> Image.Image:
    """Insert telephone : meme habitacle, mais completement hors du plan focal."""
    p = (t - T_CUT) / (DURATION - T_CUT)
    scale = 0.74 - 0.05 * ease_out(p)
    jx = math.sin(t * 2.1) * 3
    img = crop_from_plate(plate, scale, 760 + jx, PLATE_H * 0.46)
    img = img.filter(ImageFilter.GaussianBlur(16))
    return Image.fromarray((np.asarray(img).astype(np.float32) * 0.62).astype(np.uint8))


# ------------------------------------------------------------------ telephone
PHONE_W, PHONE_H = 470, 940
PHONE_CX, PHONE_CY = 540, 1108
PHONE_ANGLE = -4


def _wrap(d: ImageDraw.ImageDraw, text: str, f, max_w: int) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        test = f"{cur} {word}".strip()
        if d.textlength(test, font=f) <= max_w or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def _bubble(img: Image.Image, d: ImageDraw.ImageDraw, sw: int, text: str, side: str,
            y: int, alpha: float) -> int:
    """Une bulle de conversation. Retourne le y de la bulle suivante."""
    f = font(21, False)
    pad, radius = 18, 22
    max_w = int(sw * 0.72)
    lines = _wrap(d, text, f, max_w - 2 * pad)
    line_h = 29
    bw = int(max(d.textlength(line, font=f) for line in lines)) + 2 * pad
    bh = len(lines) * line_h + 2 * pad - 6

    if side == "recu":
        x = 20
        bg, fg = (40, 43, 50), (238, 240, 244)
        corners = (radius, radius, radius, 6)
    else:
        x = sw - 20 - bw
        bg, fg = (34, 78, 138), (245, 248, 252)
        corners = (radius, radius, 6, radius)

    rise = int(14 * (1 - ease_out(alpha)))
    y += rise
    d.rounded_rectangle([x, y, x + bw, y + bh], radius=radius,
                        fill=tuple(int(c * alpha) for c in bg), corners=corners)
    ty = y + pad - 4
    for line in lines:
        d.text((x + pad, ty), line, font=f, fill=tuple(int(c * alpha) for c in fg))
        ty += line_h
    return y - rise + bh + 14


def _typing(d: ImageDraw.ImageDraw, y: int, t: float, alpha: float) -> None:
    """Indicateur de saisie — trois points qui respirent."""
    if alpha <= 0.01:
        return          # on ne voit jamais sa propre saisie
    x, bw, bh = 20, 96, 50
    d.rounded_rectangle([x, y, x + bw, y + bh], radius=22,
                        fill=tuple(int(c * alpha) for c in (40, 43, 50)))
    for i in range(3):
        p = 0.5 + 0.5 * math.sin(t * 9 - i * 0.9)
        c = int((120 + 110 * p) * alpha)
        cx, cy = x + 26 + i * 22, y + bh // 2
        d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=(c, c, c))


SCREEN_BG = (10, 11, 14)


def _fade(color: tuple[int, int, int], a: float) -> tuple[int, int, int]:
    """Fond l'element vers le noir de l'ecran plutot que vers le noir absolu."""
    return tuple(int(b + (c - b) * a) for c, b in zip(color, SCREEN_BG))


def render_screen(t: float) -> Image.Image:
    sw, sh = PHONE_W - 30, PHONE_H - 30
    img = Image.new("RGB", (sw, sh), SCREEN_BG)
    d = ImageDraw.Draw(img)

    # barre d'etat
    d.text((30, 24), "17:42", font=font(21, True), fill=(190, 196, 206))
    for i, bw in enumerate((5, 9, 13, 17)):
        d.rounded_rectangle([sw - 128 + i * 12, 42 - bw, sw - 123 + i * 12, 42], radius=2,
                            fill=(190, 196, 206))
    d.rounded_rectangle([sw - 66, 26, sw - 30, 44], radius=5, outline=(190, 196, 206), width=2)

    if t < T_THREAD:
        # ecran de fin d'appel, puis la banniere de texto qui tombe par-dessus
        a = smoothstep((t - T_CUT) / 0.18) * (1.0 - smoothstep((t - T_THREAD + 0.20) / 0.20))
        cx, cy = sw // 2, int(sh * 0.38)
        d.ellipse([cx - 50, cy - 50, cx + 50, cy + 50],
                  fill=(int(196 * a), int(56 * a), int(50 * a)))
        icon = s1.handset_icon(135, size=26)
        if a > 0.05:
            faded = Image.new("RGBA", icon.size, (0, 0, 0, 0))
            faded.paste(icon, (0, 0), icon)
            faded.putalpha(faded.getchannel("A").point(lambda v: int(v * a)))
            img.paste(faded, (cx - icon.width // 2, cy - icon.height // 2), faded)
        c = int(238 * a)
        d.text((cx, cy + 104), "Appel terminé", font=font(33, True), fill=(c, c, c), anchor="mm")
        c2 = int(150 * a)
        d.text((cx, cy + 148), "Aucune réponse · 24 s", font=font(22, False),
               fill=(c2, c2, c2), anchor="mm")

        if t >= T_SMS:
            drop = ease_out((t - T_SMS) / 0.28)
            # elle s'ouvre vers le fil au lieu de disparaitre d'un coup
            ba = 1.0 - smoothstep((t - T_THREAD + 0.22) / 0.22)
            by = int(-120 + 190 * drop - 26 * (1 - ba))
            bx, bw2 = 18, sw - 36
            d.rounded_rectangle([bx, by, bx + bw2, by + 112], radius=24, fill=_fade((46, 49, 57), ba))
            d.rounded_rectangle([bx + 16, by + 16, bx + 52, by + 52], radius=10,
                                fill=_fade((52, 118, 82), ba))
            d.text((bx + 66, by + 18), GARAGE_NAME, font=font(22, True),
                   fill=_fade((236, 238, 242), ba))
            d.text((bx + bw2 - 18, by + 20), "maintenant", font=font(17, False),
                   fill=_fade((150, 156, 166), ba), anchor="ra")
            for i, line in enumerate(_wrap(d, SMS_PREVIEW, font(20, False), bw2 - 84)[:2]):
                d.text((bx + 66, by + 50 + i * 26), line, font=font(20, False),
                       fill=_fade((198, 203, 212), ba))
        return img

    # conversation : NoviaAI a deja repondu a sa place
    a = smoothstep((t - T_THREAD) / 0.22)
    d.rounded_rectangle([0, 70, sw, 152], radius=0, fill=tuple(int(c * a) for c in (26, 28, 34)))
    d.rounded_rectangle([24, 92, 62, 130], radius=11, fill=tuple(int(c * a) for c in (52, 118, 82)))
    c = int(238 * a)
    d.text((76, 96), GARAGE_NAME, font=font(24, True), fill=(c, c, c))
    c2 = int(140 * a)
    d.text((76, 126), "texto", font=font(18, False), fill=(c2, c2, c2))

    y = 176
    for t_in, side, text in THREAD:
        if t < t_in:
            break
        y = _bubble(img, d, sw, text, side, y, smoothstep((t - t_in) / 0.22))
    for t_in, side, _ in THREAD[1:]:
        if t_in - 0.80 <= t < t_in:
            _typing(d, y, t, 1.0 if side == "recu" else 0.0)
            break

    # barre de saisie
    d.rounded_rectangle([20, sh - 76, sw - 84, sh - 20], radius=28,
                        fill=tuple(int(c * a) for c in (34, 36, 43)))
    fin = font(20, False)
    if T_TYPE <= t < T_SEND:
        # on ne voit jamais son propre indicateur de saisie dans une vraie appli :
        # c'est le texte qui apparait dans le champ, lettre par lettre
        shown = TYPED[:int(len(TYPED) * min((t - T_TYPE) / 1.10, 1.0))]
        d.text((44, sh - 62), shown, font=fin, fill=(int(232 * a),) * 3)
        if math.sin(t * 7.5) > -0.25:
            cx = 44 + d.textlength(shown, font=fin) + 4
            d.line([cx, sh - 64, cx, sh - 38], fill=(int(206 * a),) * 3, width=2)
    else:
        d.text((44, sh - 62), "Message", font=fin, fill=(int(120 * a),) * 3)

    # le bouton s'enfonce brievement a l'envoi
    press = max(0.0, 1.0 - abs(t - T_SEND) / 0.16) if abs(t - T_SEND) < 0.16 else 0.0
    r = 28 - 3 * press
    bcx, bcy = sw - 44, sh - 48
    d.ellipse([bcx - r, bcy - r, bcx + r, bcy + r], fill=tuple(int(c * a) for c in LIME))
    d.polygon([(bcx - 9, bcy - 9), (bcx + 10, bcy), (bcx - 9, bcy + 9), (bcx - 5, bcy)],
              fill=tuple(int(c * a) for c in (14, 30, 52)))
    return img


def render_phone(t: float) -> Image.Image:
    body = Image.new("RGBA", (PHONE_W, PHONE_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(body)
    d.rounded_rectangle([0, 0, PHONE_W - 1, PHONE_H - 1], radius=54, fill=(16, 17, 20, 255),
                        outline=(62, 66, 74, 255), width=3)
    d.rounded_rectangle([11, 11, PHONE_W - 12, PHONE_H - 12], radius=45, fill=(3, 3, 5, 255))
    body.paste(render_screen(t), (15, 15))

    gloss = Image.new("RGBA", (PHONE_W, PHONE_H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gd.polygon([(0, 200), (PHONE_W, -90), (PHONE_W, 125), (0, 430)], fill=(255, 255, 255, 14))
    gloss = gloss.filter(ImageFilter.GaussianBlur(16))
    body = Image.alpha_composite(body, gloss)
    return body.rotate(PHONE_ANGLE, resample=Image.BICUBIC, expand=True)


def composite_phone(base: Image.Image, t: float) -> Image.Image:
    phone = render_phone(t)
    entry = smoothstep((t - T_CUT) / 0.30)
    px = int(PHONE_CX - phone.width / 2)
    py = int(PHONE_CY - phone.height / 2 + (1 - entry) * 26)

    out = base.convert("RGBA")

    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = 470
    tint = (74, 132, 214, int(46 * entry)) if t < T_THREAD else (96, 150, 210, int(40 * entry))
    gd.ellipse([PHONE_CX - r, PHONE_CY - r, PHONE_CX + r, PHONE_CY + r], fill=tint)
    out = Image.alpha_composite(out, glow.filter(ImageFilter.GaussianBlur(120)))

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    layer.paste(phone, (px, py), phone)
    return Image.alpha_composite(out, layer).convert("RGB")


# ---------------------------------------------------------------- sound design
SR = s1.SR

# Niveau de la nappe. Les deux scenes sont normalisees separement, donc ce gain
# est calibre pour que la note grave ait le meme niveau de part et d'autre de la
# coupe. Verifiable avec `python check_raccord.py`.
PAD_GAIN = 0.133


def ringback(start: float, end: float, level: float, n: int) -> np.ndarray:
    """Tonalite de retour d'appel nord-americaine : 440 Hz + 480 Hz superposes.

    C'est le son entendu par l'APPELANT — donc le bon son ici, alors que la
    scene 1 utilisait la sonnerie emise par l'appareil du garagiste.
    """
    out = np.zeros(n, np.float32)
    i0, i1 = int(start * SR), min(int(end * SR), n)
    if i1 <= i0:
        return out
    lt = np.arange(i1 - i0) / SR
    tone = np.sin(2 * np.pi * 440 * lt) * 0.5 + np.sin(2 * np.pi * 480 * lt) * 0.5
    env = np.minimum(lt / 0.03, 1.0) * np.clip((end - start - lt) / 0.03, 0, 1)
    out[i0:i1] = (tone * env * level).astype(np.float32)
    return out


def synth_audio(path: Path) -> None:
    n = int(DURATION * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(11)
    mix = np.zeros(n, np.float32)

    # habitacle : rumble sourd + trafic lointain tres attenue
    brown = np.cumsum(rng.normal(0, 1, n).astype(np.float32))
    brown /= np.max(np.abs(brown)) + 1e-9
    cabin = brown * 0.10 + np.sin(2 * np.pi * 54 * t) * 0.012
    mix += cabin

    # cadence reelle : 2 s de tonalite, puis 4 s de silence. Il raccroche
    # pendant le silence, sans attendre la salve suivante.
    mix += ringback(0.15, T_RING_END, 0.30, n)

    # declic de raccrochage
    i0 = int(T_HANGUP * SR)
    ln = int(0.05 * SR)
    lt = np.arange(ln) / SR
    mix[i0:i0 + ln] += (rng.normal(0, 1, ln) * np.exp(-lt * 220) * 0.10).astype(np.float32)

    # silence relatif juste apres : il encaisse
    a0, a1 = int(T_HANGUP * SR), int((T_SMS - 0.1) * SR)
    mix[a0:a1] *= np.linspace(1.0, 0.40, a1 - a0)
    mix[a1:] *= 0.40

    # texto entrant : deux notes breves, le seul son clair de toute la scene
    i0 = int(T_SMS * SR)
    ln = int(0.55 * SR)
    lt = np.arange(ln) / SR
    ding = np.zeros(ln, np.float32)
    for offset, freq in ((0.0, 1568.0), (0.085, 2093.0)):
        k = int(offset * SR)
        seg = np.arange(ln - k) / SR
        ding[k:] += (np.sin(2 * np.pi * freq * seg) * np.exp(-seg * 11)
                     + 0.25 * np.sin(2 * np.pi * freq * 2 * seg) * np.exp(-seg * 22)).astype(np.float32)
    mix[i0:i0 + ln] += ding * 0.22

    # bulles de conversation : petits blips, plus discrets
    for bubble_t, freq, lvl in ((T_REPLY, 1245.0, 0.10), (T_BOOK, 1661.0, 0.12),
                                (T_SEND, 1864.0, 0.09)):
        i0 = int(bubble_t * SR)
        ln = int(0.22 * SR)
        lt = np.arange(ln) / SR
        blip = np.sin(2 * np.pi * freq * lt) * np.exp(-lt * 20)
        mix[i0:i0 + ln] += (blip * lvl).astype(np.float32)

    # frappe au clavier : garde la fin vivante pendant qu'il tape son choix.
    # Intervalles irreguliers — une cadence reguliere sonnerait synthetique.
    tap_t = T_TYPE + 0.06
    for k in range(len(TYPED)):
        i0 = int(tap_t * SR)
        ln = int(0.05 * SR)
        if i0 + ln >= n:
            break
        lt = np.arange(ln) / SR
        click = rng.normal(0, 1, ln) * np.exp(-lt * 260)
        click += np.sin(2 * np.pi * 2400 * lt) * np.exp(-lt * 300) * 0.4
        mix[i0:i0 + ln] += (click * 0.035).astype(np.float32)
        tap_t += 1.10 / len(TYPED) * rng.uniform(0.7, 1.3)

    # envoi : souffle bref qui monte, le geste se conclut
    i0 = int(T_SEND * SR)
    ln = int(0.30 * SR)
    lt = np.arange(ln) / SR
    sweep = np.sin(2 * np.pi * (620 + 900 * lt / 0.30) * lt) * np.exp(-lt * 13)
    air = rng.normal(0, 1, ln) * np.exp(-lt * 26) * 0.35
    mix[i0:i0 + ln] += ((sweep + air) * 0.13).astype(np.float32)

    # Pont sonore avec la scene 1 : exactement le meme accord que la note de
    # pre-lap, a plein niveau des la premiere image. C'est lui qui enjambe la
    # coupe — l'oreille entend une continuite la ou l'image fait un cut franc.
    pad = (np.sin(2 * np.pi * 82.4 * t) * 0.50 + np.sin(2 * np.pi * 164.8 * t) * 0.22
           + np.sin(2 * np.pi * 246.0 * t) * 0.08)
    # le niveau colle a celui de la scene 1 au raccord, puis s'ouvre lentement
    swell = 1.0 + 0.8 * np.clip((t - 0.30) / 2.20, 0, 1)
    mix += (pad * np.minimum(t / 0.02, 1.0) * swell * PAD_GAIN).astype(np.float32)
    # la quinte s'ajoute ensuite pour epaissir, une fois la coupe passee
    thick = np.sin(2 * np.pi * 123.5 * t) * 0.14
    mix += (thick * np.clip((t - 0.8) / 1.6, 0, 1) * PAD_GAIN).astype(np.float32)
    # tierce majeure ajoutee quand NoviaAI repond : la tension se resout
    bright = np.sin(2 * np.pi * 207.65 * t) * 0.30 + np.sin(2 * np.pi * 311.1 * t) * 0.14
    lift = 1.0 + 0.35 * np.clip((t - T_BOOK) / 2.0, 0, 1)   # l'accord s'ouvre sur la fin
    mix += (bright * np.clip((t - T_SMS) / 1.0, 0, 1) * lift * 0.13).astype(np.float32)

    # attaque tres courte a l'entree : un fondu classique creerait un trou
    # audible juste apres la coupe et casserait le pont sonore
    head = int(0.015 * SR)
    mix[:head] *= np.linspace(0, 1, head)
    # meme logique en sortie : la scene 3 reprend l'accord, un fondu creuserait
    # un trou a la coupe
    tail = int(0.015 * SR)
    mix[-tail:] *= np.linspace(1, 0, tail)
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
def render(with_audio: bool = True, preview: bool = False, regen_plate: bool = False) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)

    print("[1/4] Preparation de la plaque client...")
    plate = build_plate(regen_plate)

    silent = WORK / "scene2_silent.mp4"
    print(f"[2/4] Rendu de {NFRAMES} images composees...")
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
         str(silent)],
        stdin=subprocess.PIPE,
    )
    preview_at = {int(x * FPS) for x in (1.4, 4.9, 7.9, 11.5, 12.6, 14.2)}
    for i in range(NFRAMES):
        t = i / FPS
        if t < T_CUT:
            img = plan_a(plate, t)
        else:
            img = composite_phone(plan_b(plate, t), t)
        img = Image.fromarray(grade(np.asarray(img), t))
        img = s1.draw_caption(img, t, CAPTIONS, DURATION)
        if preview and i in preview_at:
            img.save(OUT_DIR / f"scene2_frame_{t:.1f}s.jpg", quality=92)
        proc.stdin.write(np.asarray(img, dtype=np.uint8).tobytes())
        if i % 30 == 0:
            print(f"      {i}/{NFRAMES}")
    proc.stdin.close()
    proc.wait()

    out = OUT_DIR / "scene2_client_LATEST.mp4"
    if with_audio:
        print("[3/4] Synthese du design sonore...")
        wav = WORK / "scene2_audio.wav"
        synth_audio(wav)
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
    ap = argparse.ArgumentParser(description="Rendu scene 2 client, sans Runway")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--regen-plate", action="store_true", help="Regenere la plaque via GPT Image")
    args = ap.parse_args()
    render(with_audio=not args.no_audio, preview=args.preview, regen_plate=args.regen_plate)
    return 0


if __name__ == "__main__":
    sys.exit(main())
