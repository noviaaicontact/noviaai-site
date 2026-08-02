"""Monte la vidéo explicative NoviaAI à partir des captures + de la voix-off.

Entrées  : storyboard.json, shots/*.png (capture.mjs), voice/*.mp3 (voiceover.py)
Sortie   : output/noviaai-comment-ca-marche.mp4 (1920x1080, 30 fps)

Chaque plan est composé une fois en image fixe et les fondus sont pré-calculés,
puis ffmpeg assemble la suite d'images. Laisser MoviePy composer des calques
masqués coûtait ici plus d'une seconde par image : un masque rend le mélange
permanent, même en dehors du fondu, et la bande passante mémoire de la machine
est très faible. MoviePy ne sert donc plus qu'à la bande son.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from moviepy import AudioFileClip, CompositeAudioClip, afx

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).parent
SHOTS = HERE / "shots"
VOICE = HERE / "voice"
OUT = HERE / "output"
BUILD = HERE / "build"
MUSIC = HERE.parent / "assets-pub" / "ghl-bg.mp3"

BOARD = json.loads((HERE / "storyboard.json").read_text(encoding="utf-8"))
DURATIONS = json.loads((VOICE / "durations.json").read_text(encoding="utf-8"))

W, H = BOARD["width"], BOARD["height"]
FPS = BOARD["fps"]

NAVY = (19, 50, 91)
NAVY_DEEP = (8, 24, 47)
LIME = (200, 241, 53)
WHITE = (255, 255, 255)
MUTED = (162, 182, 210)

FONTS = Path("C:/Windows/Fonts")
F_TITLE = str(FONTS / "segoeuib.ttf")
F_SEMI = str(FONTS / "seguisb.ttf")
F_BODY = str(FONTS / "segoeui.ttf")
F_BLACK = str(FONTS / "ariblk.ttf")

INTRO = 3.6          # durée du carton d'ouverture
LEAD = 0.45          # silence avant la narration d'une scène
TAIL = 0.85          # silence après
XF_SHOT = 0.4        # fondu entre deux images d'une même scène
XF_SCENE = 0.5       # fondu entre deux scènes

BOX_PORTRAIT = (905, 78, 1800, 1002)


# ─────────────────────────────  dessin  ─────────────────────────────

def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def background() -> Image.Image:
    ramp = np.linspace(0, 1, H)[:, None]
    grad = np.array(NAVY_DEEP) * (1 - ramp) + np.array(NAVY) * ramp
    bg = np.repeat(grad[:, None, :], W, axis=1)

    xx, yy = np.meshgrid(np.arange(W), np.arange(H))

    def glow(cx, cy, radius, color, strength):
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / radius
        return (np.clip(1 - d, 0, 1) ** 2 * strength)[..., None] * np.array(color)

    bg = bg + glow(1680, 1010, 1150, LIME, 0.11) + glow(180, 90, 950, (58, 122, 224), 0.20)
    img = Image.fromarray(np.clip(bg, 0, 255).astype("uint8"))

    d = ImageDraw.Draw(img)
    f = font(F_SEMI, 24)
    label = "noviaai.ca"
    d.text((W - 112 - d.textlength(label, font=f), H - 76), label, font=f, fill=(118, 138, 168))
    return img


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt, max_w: int) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=fnt) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def tracked(draw: ImageDraw.ImageDraw, xy, text: str, fnt, fill, tracking: float):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + tracking


def title_metrics(title: str, portrait: bool) -> dict:
    probe = ImageDraw.Draw(Image.new("RGB", (16, 16)))
    f_title = font(F_TITLE, 50 if portrait else 55)
    lines = wrap(probe, title, f_title, 640 if portrait else 1560)
    line_h = 63 if portrait else 68
    return {
        "lines": lines,
        "f_title": f_title,
        "line_h": line_h,
        "x": 140 if portrait else 112,
        "height": 64 + len(lines) * line_h,
    }


def draw_title(img: Image.Image, kicker: str, title: str, portrait: bool, y: int) -> None:
    m = title_metrics(title, portrait)
    d = ImageDraw.Draw(img)
    x = m["x"]

    d.rounded_rectangle([x, y, x + 58, y + 5], 3, fill=LIME)
    tracked(d, (x, y + 22), kicker.upper(), font(F_SEMI, 25), LIME, 2.6)
    ty = y + 64
    for line in m["lines"]:
        d.text((x, ty), line, font=m["f_title"], fill=WHITE)
        ty += m["line_h"]


def card(path: Path, box) -> Image.Image:
    """Capture recadrée dans `box`, coins arrondis et ombre portée."""
    left, top, right, bottom = box
    im = Image.open(path).convert("RGB")

    scale = min((right - left) / im.width, (bottom - top) / im.height)
    tw, th = max(2, int(im.width * scale)), max(2, int(im.height * scale))
    im = im.resize((tw, th), Image.LANCZOS)

    radius = 22
    mask = Image.new("L", (tw, th), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, tw - 1, th - 1], radius, fill=255)
    im.putalpha(mask)

    pad = 70
    canvas = Image.new("RGBA", (tw + 2 * pad, th + 2 * pad), (0, 0, 0, 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [pad, pad + 18, pad + tw, pad + th + 18], radius, fill=(3, 10, 22, 165)
    )
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(30)))
    canvas.paste(im, (pad, pad), im)
    return canvas


def paste_card(frame: Image.Image, path: Path, box) -> None:
    art = card(path, box)
    left, top, right, bottom = box
    cx, cy = (left + right) / 2, (top + bottom) / 2
    frame.paste(art, (int(cx - art.width / 2), int(cy - art.height / 2)), art)


def wordmark(d: ImageDraw.ImageDraw, cx: int, y: int, size: int) -> None:
    f = font(F_BLACK, size)
    w1 = d.textlength("Novia", font=f)
    w2 = d.textlength("AI", font=f)
    x = cx - (w1 + w2) / 2
    d.text((x, y), "Novia", font=f, fill=WHITE)
    d.text((x + w1, y), "AI", font=f, fill=LIME)


def compose_intro(bg: Image.Image) -> Image.Image:
    img = bg.copy()
    d = ImageDraw.Draw(img)
    cx = W // 2
    wordmark(d, cx, 380, 104)

    f_h, f_s = font(F_TITLE, 58), font(F_BODY, 30)
    t = "Comment ça marche"
    d.text((cx - d.textlength(t, font=f_h) / 2, 545), t, font=f_h, fill=WHITE)
    s = "Le rattrapage d'appels manqués par SMS, expliqué de bout en bout"
    d.text((cx - d.textlength(s, font=f_s) / 2, 630), s, font=f_s, fill=MUTED)
    d.rounded_rectangle([cx - 40, 700, cx + 40, 704], 2, fill=LIME)
    return img


def compose_cta(bg: Image.Image) -> Image.Image:
    img = bg.copy()
    d = ImageDraw.Draw(img)
    cx = W // 2
    wordmark(d, cx, 250, 92)

    f_h = font(F_TITLE, 62)
    t = "Arrêtez de perdre des clients."
    d.text((cx - d.textlength(t, font=f_h) / 2, 410), t, font=f_h, fill=WHITE)

    f_s = font(F_BODY, 31)
    s = "Essai 14 jours · Sans contrat · Installation en 5 minutes · Support en français"
    d.text((cx - d.textlength(s, font=f_s) / 2, 500), s, font=f_s, fill=MUTED)

    f_b = font(F_TITLE, 40)
    label = "noviaai.ca"
    bw = d.textlength(label, font=f_b) + 108
    bx, by, bh = cx - bw / 2, 610, 92
    d.rounded_rectangle([bx, by, bx + bw, by + bh], 46, fill=LIME)
    d.text((bx + 54, by + 22), label, font=f_b, fill=NAVY)
    return img


# ─────────────────────────────  plans  ─────────────────────────────

def shot_path(shot_id: str) -> Path:
    return SHOTS / f"{shot_id}.png"


def is_portrait(path: Path) -> bool:
    with Image.open(path) as im:
        return im.width / im.height < 0.95


def layout(paths: list[Path], title: str, portrait: bool) -> tuple[tuple, int]:
    """Cadre image + hauteur du titre. En paysage, titre et image forment un
    bloc centré verticalement — sinon les schémas très larges flottent au milieu."""
    if portrait:
        return BOX_PORTRAIT, int((H - title_metrics(title, True)["height"]) / 2)

    max_w, max_h = 1700, 790
    img_h = 0
    for path in paths:
        with Image.open(path) as im:
            img_h = max(img_h, im.height * min(max_w / im.width, max_h / im.height))
    img_h = int(img_h)

    gap = 58
    title_h = title_metrics(title, False)["height"]
    top = max(78, int((H - (title_h + gap + img_h)) / 2))
    box_top = top + title_h + gap
    return (110, box_top, 1810, box_top + img_h), top


def scene_frames(scene: dict, bg: Image.Image) -> list[Image.Image]:
    if scene["shots"] == ["generated:cta"]:
        return [compose_cta(bg)]

    paths = []
    for sid in scene["shots"]:
        path = shot_path(sid)
        if path.exists():
            paths.append(path)
        else:
            print(f"    ! image manquante : {sid}")
    if not paths:
        return [bg.copy()]

    portrait = all(is_portrait(p) for p in paths)
    box, title_y = layout(paths, scene["title"], portrait)

    frames = []
    for path in paths:
        frame = bg.copy()
        paste_card(frame, path, box)
        draw_title(frame, scene["kicker"], scene["title"], portrait, title_y)
        frames.append(frame)
    return frames


# ─────────────────────────────  timeline  ─────────────────────────────

def build_timeline(bg: Image.Image):
    """Suite (image, durée) couvrant toute la vidéo, fondus déjà déroulés.

    Chaque fondu est prélevé sur la fin du plan qu'il termine : la durée d'une
    scène reste donc exactement celle de sa narration, et la voix-off ne dérive
    jamais.
    """
    blocks = [(INTRO, [compose_intro(bg)])]
    for scene in BOARD["scenes"]:
        print(f"  → {scene['id']}")
        blocks.append((LEAD + DURATIONS[scene["id"]] + TAIL, scene_frames(scene, bg)))

    shots: list[tuple[Image.Image, float, float]] = []  # image, durée, fondu de sortie
    for b, (dur, frames) in enumerate(blocks):
        slot = dur / len(frames)
        last_block = b == len(blocks) - 1
        for i, frame in enumerate(frames):
            last_shot = i == len(frames) - 1
            if last_shot and last_block:
                xf = 0.0
            else:
                xf = XF_SCENE if last_shot else XF_SHOT
            shots.append((frame, slot, xf))

    segments: list[tuple[Image.Image, float]] = []
    step = 1.0 / FPS
    for i, (frame, dur, xf) in enumerate(shots):
        steps = int(round(xf * FPS))
        segments.append((frame, max(step, dur - steps * step)))
        if steps:
            nxt = shots[i + 1][0]
            for k in range(steps):
                alpha = (k + 1) / (steps + 1)
                segments.append((Image.blend(frame, nxt, alpha), step))
    return segments


def write_frames(segments) -> Path:
    BUILD.mkdir(exist_ok=True)
    for old in BUILD.glob("*.jpg"):
        try:
            old.unlink()
        except OSError:
            # Un antivirus ou OneDrive garde parfois une image ouverte. Seules
            # les images listées dans frames.txt sont encodées : un reste est
            # sans conséquence.
            pass

    lines = []
    for i, (img, dur) in enumerate(segments):
        name = f"f{i:05d}.jpg"
        img.save(BUILD / name, quality=95, subsampling=0)
        lines.append(f"file '{name}'\nduration {dur:.5f}")
    lines.append(f"file '{name}'")

    listing = BUILD / "frames.txt"
    listing.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return listing


def write_audio(total: float) -> Path:
    tracks = []
    t = INTRO
    for scene in BOARD["scenes"]:
        dur = LEAD + DURATIONS[scene["id"]] + TAIL
        tracks.append(AudioFileClip(str(VOICE / f"{scene['id']}.mp3")).with_start(t + LEAD))
        t += dur

    if MUSIC.exists():
        bed = AudioFileClip(str(MUSIC))
        bed = (
            bed.with_effects([afx.AudioLoop(duration=total)])
            if bed.duration < total
            else bed.subclipped(0, total)
        )
        tracks.append(
            bed.with_effects(
                [afx.MultiplyVolume(0.045), afx.AudioFadeIn(2.0), afx.AudioFadeOut(3.0)]
            )
        )

    out = BUILD / "audio.m4a"
    CompositeAudioClip(tracks).with_duration(total).write_audiofile(
        str(out), fps=44100, codec="aac", bitrate="192k", logger=None
    )
    return out


def encode(listing: Path, audio: Path, total: float) -> Path:
    out_file = OUT / "noviaai-comment-ca-marche.mp4"
    bar = (
        f"drawbox=x=0:y=ih-6:w='iw*min(t/{total:.3f}\\,1)':h=6:"
        "color=0xC8F135@1.0:t=fill"
    )
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "warning", "-stats",
        "-f", "concat", "-safe", "0", "-i", str(listing),
        "-i", str(audio),
        "-vf", f"{bar},fps={FPS},format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", "-shortest",
        str(out_file),
    ]
    subprocess.run(cmd, check=True)
    return out_file


def main() -> None:
    OUT.mkdir(exist_ok=True)
    bg = background()

    print("Composition des plans…")
    segments = build_timeline(bg)
    total = sum(d for _, d in segments)
    mins, secs = divmod(total, 60)
    print(f"\n{len(segments)} images · {int(mins)} min {secs:04.1f} s")

    print("Écriture des images…")
    listing = write_frames(segments)

    print("Bande son…")
    audio = write_audio(total)

    print("Encodage…")
    out_file = encode(listing, audio, total)
    print(f"\nTerminé : {out_file}")


if __name__ == "__main__":
    main()
