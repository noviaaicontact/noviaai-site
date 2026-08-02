"""Compositing style GoHighLevel — stats animés, cadre iPhone, cuts rapides."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from config import PUB_FPS, PUB_HEIGHT, PUB_WIDTH

NAVY = (19, 50, 91)
NAVY_D = (12, 28, 52)
LIME = (200, 241, 53)
WHITE = (252, 250, 245)
MUTED = (148, 163, 184)


def _font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    paths = [
        Path("C:/Windows/Fonts/segoeuib.ttf") if bold else Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf") if bold else Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for p in paths:
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def _import_moviepy():
    try:
        from moviepy import (
            CompositeVideoClip,
            ImageClip,
            VideoClip,
            VideoFileClip,
            concatenate_videoclips,
        )
    except ImportError:
        from moviepy.editor import (
            CompositeVideoClip,
            ImageClip,
            VideoClip,
            VideoFileClip,
            concatenate_videoclips,
        )
    return CompositeVideoClip, ImageClip, VideoClip, VideoFileClip, concatenate_videoclips


def _subclip(clip, t0: float, t1: float):
    if hasattr(clip, "subclipped"):
        return clip.subclipped(t0, t1)
    return clip.subclip(t0, t1)


def _with_fps(clip, fps: int):
    return clip.with_fps(fps) if hasattr(clip, "with_fps") else clip.set_fps(fps)


def _no_audio(clip):
    return clip.without_audio() if hasattr(clip, "without_audio") else clip.set_audio(None)


def render_stat_frame(big: str, sub: str, progress: float = 1.0) -> np.ndarray:
    """Slide stat GHL — gros chiffre centré + sous-titre."""
    w, h = PUB_WIDTH, PUB_HEIGHT
    img = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        c = tuple(int(NAVY_D[i] * (1 - t) + NAVY[i] * t) for i in range(3))
        draw.line([(0, y), (w, y)], fill=c)

    scale = 0.75 + 0.25 * min(max(progress, 0), 1)
    fb = _font(int(180 * scale), True)
    sb = _font(int(52 * scale), False)

    bb = draw.textbbox((0, 0), big, font=fb)
    bx = (w - (bb[2] - bb[0])) // 2
    by = int(h * 0.32)
    draw.text((bx, by), big, font=fb, fill=LIME)

    lines = sub.split("\n")
    y = by + int(200 * scale)
    for line in lines:
        bb2 = draw.textbbox((0, 0), line, font=sb)
        x = (w - (bb2[2] - bb2[0])) // 2
        draw.text((x, y), line, font=sb, fill=WHITE)
        y += int(62 * scale)

    # Badge NoviaAI
    badge = "NoviaAI · Québec"
    bf = _font(28, True)
    bb3 = draw.textbbox((0, 0), badge, font=bf)
    draw.rounded_rectangle(
        [(w - (bb3[2] - bb3[0])) // 2 - 16, 80, (w + (bb3[2] - bb3[0])) // 2 + 16, 130],
        radius=20,
        fill=(30, 45, 70),
    )
    draw.text(((w - (bb3[2] - bb3[0])) // 2, 88), badge, font=bf, fill=MUTED)
    return np.array(img)


def stat_clip(big: str, sub: str, duration: float):
    _, _, VideoClip, _, _ = _import_moviepy()

    def make_frame(t):
        p = min(t / 0.35, 1.0)
        p = 1 - (1 - p) ** 3
        return render_stat_frame(big, sub, p)

    clip = VideoClip(make_frame, duration=duration)
    return _with_fps(_no_audio(clip), PUB_FPS)


def render_cta_frame(line1: str, line2: str, progress: float = 1.0) -> np.ndarray:
    w, h = PUB_WIDTH, PUB_HEIGHT
    img = Image.new("RGB", (w, h), NAVY_D)
    draw = ImageDraw.Draw(img)
    p = min(max(progress, 0), 1)
    f1 = _font(int(64 * (0.8 + 0.2 * p)), True)
    f2 = _font(int(48 * (0.8 + 0.2 * p)), True)

    bb1 = draw.textbbox((0, 0), line1, font=f1)
    draw.text(((w - (bb1[2] - bb1[0])) // 2, int(h * 0.38)), line1, font=f1, fill=WHITE)
    bb2 = draw.textbbox((0, 0), line2, font=f2)
    x2 = (w - (bb2[2] - bb2[0])) // 2
    y2 = int(h * 0.52)
    draw.rounded_rectangle([x2 - 20, y2 - 8, x2 + (bb2[2] - bb2[0]) + 20, y2 + (bb2[3] - bb2[1]) + 16], radius=12, fill=LIME)
    draw.text((x2, y2), line2, font=f2, fill=NAVY_D)
    return np.array(img)


def cta_clip(line1: str, line2: str, duration: float):
    _, _, VideoClip, _, _ = _import_moviepy()

    def make_frame(t):
        p = min(t / 0.3, 1.0)
        return render_cta_frame(line1, line2, p)

    clip = VideoClip(make_frame, duration=duration)
    return _with_fps(_no_audio(clip), PUB_FPS)


def fit_portrait(clip, w: int = PUB_WIDTH, h: int = PUB_HEIGHT):
    scale = max(w / clip.w, h / clip.h)
    clip = clip.resized(scale) if hasattr(clip, "resized") else clip.resize(scale)
    cx, cy = clip.w / 2, clip.h / 2
    if hasattr(clip, "cropped"):
        return clip.cropped(x_center=cx, y_center=cy, width=w, height=h)
    return clip.crop(x_center=cx, y_center=cy, width=w, height=h)


def broll_clip(path: Path, duration: float, caption: str = ""):
    CompositeVideoClip, ImageClip, _, VideoFileClip, concatenate_videoclips = _import_moviepy()
    raw = VideoFileClip(str(path))
    raw = fit_portrait(raw)
    if raw.duration >= duration:
        start = max(0.0, (raw.duration - duration) / 2)
        seg = _subclip(raw, start, start + duration)
    else:
        loops = int(duration / max(raw.duration, 0.1)) + 1
        seg = _subclip(concatenate_videoclips([raw] * loops), 0, duration)
    seg = _with_fps(_no_audio(seg), PUB_FPS)

    if not caption:
        return seg

    def caption_frame(t):
        base = seg.get_frame(t)
        img = Image.fromarray(base).convert("RGBA")
        overlay = Image.new("RGBA", (PUB_WIDTH, PUB_HEIGHT), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        for y in range(int(PUB_HEIGHT * 0.78), PUB_HEIGHT):
            a = int(180 * (y - PUB_HEIGHT * 0.78) / (PUB_HEIGHT * 0.22))
            draw.line([(0, y), (PUB_WIDTH, y)], fill=(0, 0, 0, a))
        font = _font(48, True)
        bb = draw.textbbox((0, 0), caption, font=font)
        x = (PUB_WIDTH - (bb[2] - bb[0])) // 2
        y = PUB_HEIGHT - 120
        draw.text((x, y), caption, font=font, fill=(255, 255, 255, 255))
        out = Image.alpha_composite(img, overlay).convert("RGB")
        return np.array(out)

    _, _, VideoClip, _, _ = _import_moviepy()
    return _with_fps(_no_audio(VideoClip(caption_frame, duration=duration)), PUB_FPS)


def fit_contain(clip, w: int, h: int, bg=(24, 24, 28)):
    """Recadre sans couper — idéal dashboard paysage dans écran téléphone."""
    CompositeVideoClip, _, _, _, _ = _import_moviepy()
    try:
        from moviepy import ColorClip
    except ImportError:
        from moviepy.editor import ColorClip

    scale = min(w / clip.w, h / clip.h)
    nw, nh = max(1, int(clip.w * scale)), max(1, int(clip.h * scale))
    resized = clip.resized((nw, nh)) if hasattr(clip, "resized") else clip.resize((nw, nh))
    x, y = (w - nw) // 2, (h - nh) // 2
    dur = clip.duration
    bg_clip = ColorClip(size=(w, h), color=bg)
    if hasattr(bg_clip, "with_duration"):
        bg_clip = bg_clip.with_duration(dur)
    else:
        bg_clip = bg_clip.set_duration(dur)
    pos = resized.with_position((x, y)) if hasattr(resized, "with_position") else resized.set_position((x, y))
    return CompositeVideoClip([bg_clip, pos], size=(w, h))


def mobile_dashboard_clip(inner_clip, label: str = "Ton dashboard NoviaAI", max_dur: float = 15.0):
    """Capture mobile 390×844 — plein écran vertical avec petit titre."""
    CompositeVideoClip, _, _, _, _ = _import_moviepy()

    dur = min(inner_clip.duration, max_dur)
    inner = _subclip(inner_clip, 0, dur)
    inner = fit_portrait(inner, PUB_WIDTH, int(PUB_HEIGHT * 0.88))
    inner = _with_fps(_no_audio(inner), PUB_FPS)

    def top_bar_frame(_t):
        img = Image.new("RGB", (PUB_WIDTH, 80), NAVY_D)
        draw = ImageDraw.Draw(img)
        f = _font(34, True)
        bb = draw.textbbox((0, 0), label, font=f)
        draw.text(((PUB_WIDTH - (bb[2] - bb[0])) // 2, 20), label, font=f, fill=WHITE)
        return np.array(img)

    _, _, VideoClip, _, _ = _import_moviepy()
    bar = _with_fps(_no_audio(VideoClip(top_bar_frame, duration=dur)), PUB_FPS)
    y_off = 80
    inner_pos = inner.with_position((0, y_off)) if hasattr(inner, "with_position") else inner.set_position((0, y_off))
    bar_pos = bar.with_position((0, 0)) if hasattr(bar, "with_position") else bar.set_position((0, 0))
    return CompositeVideoClip([inner_pos, bar_pos], size=(PUB_WIDTH, PUB_HEIGHT))


def phone_frame_clip(inner_clip, label: str = "NoviaAI Dashboard"):
    """Encadre une vidéo paysage (dashboard) dans un iPhone — style GHL."""
    CompositeVideoClip, _, _, _, _ = _import_moviepy()

    pw, ph = 900, 1560
    px = (PUB_WIDTH - pw) // 2
    py = (PUB_HEIGHT - ph) // 2 + 30
    inset_x, inset_y = px + 24, py + 110
    sw, sh = pw - 48, ph - 150

    inner = fit_contain(inner_clip, sw, sh)
    dur = min(inner.duration, inner_clip.duration)
    inner = _subclip(inner, 0, dur)
    inner = _with_fps(_no_audio(inner), PUB_FPS)

    def bg_frame(_t):
        img = Image.new("RGB", (PUB_WIDTH, PUB_HEIGHT), NAVY_D)
        draw = ImageDraw.Draw(img)
        for y in range(PUB_HEIGHT):
            t = y / PUB_HEIGHT
            c = tuple(int(NAVY_D[i] * (1 - t * 0.3) + NAVY[i] * t * 0.3) for i in range(3))
            draw.line([(0, y), (PUB_WIDTH, y)], fill=c)
        draw.rounded_rectangle([px, py, px + pw, py + ph], radius=48, fill=(24, 24, 28), outline=(90, 90, 98), width=4)
        draw.rounded_rectangle([px + 50, py + 18, px + pw - 50, py + 42], radius=10, fill=(40, 40, 44))
        lf = _font(30, True)
        bb = draw.textbbox((0, 0), label, font=lf)
        draw.text(((PUB_WIDTH - (bb[2] - bb[0])) // 2, py - 44), label, font=lf, fill=WHITE)
        draw.rounded_rectangle([inset_x - 2, inset_y - 2, inset_x + sw + 2, inset_y + sh + 2], radius=8, fill=(18, 18, 22))
        return np.array(img)

    _, _, VideoClip, _, _ = _import_moviepy()
    bg = _with_fps(_no_audio(VideoClip(bg_frame, duration=dur)), PUB_FPS)
    inner_pos = inner.with_position((inset_x, inset_y)) if hasattr(inner, "with_position") else inner.set_position((inset_x, inset_y))
    return CompositeVideoClip([bg, inner_pos], size=(PUB_WIDTH, PUB_HEIGHT))


def dashboard_clip_for_source(inner_clip, label: str, max_dur: float):
    """Mobile natif → plein écran ; desktop → cadre iPhone."""
    if inner_clip.w <= 500 and inner_clip.h > inner_clip.w * 1.2:
        return mobile_dashboard_clip(inner_clip, label, max_dur)
    return phone_frame_clip(inner_clip, label)


def product_fallback_clip(duration: float = 8.0):
    """Slide produit si pas de vidéo dashboard."""
    _, _, VideoClip, _, _ = _import_moviepy()

    def make_frame(t):
        p = min(t / 0.4, 1.0)
        img = Image.new("RGB", (PUB_WIDTH, PUB_HEIGHT), NAVY_D)
        draw = ImageDraw.Draw(img)
        pw, ph = 880, 1500
        px, py = (PUB_WIDTH - pw) // 2, (PUB_HEIGHT - ph) // 2
        draw.rounded_rectangle([px, py, px + pw, py + ph], radius=40, fill=(30, 35, 48))

        title = _font(40, True)
        draw.text((px + 40, py + 40), "NoviaAI — Inbox", font=title, fill=WHITE)

        stats = [
            ("3", "appels rattrapés"),
            ("12", "RDV bookés"),
            ("8 sec", "temps de réponse"),
        ]
        y = py + 200
        for i, (val, lbl) in enumerate(stats):
            alpha = min(max((t - 0.3 - i * 0.25) / 0.3, 0), 1) * p
            if alpha <= 0:
                continue
            vf = _font(72, True)
            lf = _font(36, False)
            draw.text((px + 60, y), val, font=vf, fill=tuple(int(LIME[i] * alpha + NAVY_D[i] * (1 - alpha)) for i in range(3)))
            draw.text((px + 60, y + 80), lbl, font=lf, fill=tuple(int(WHITE[i] * alpha) for i in range(3)))
            y += 220
        return np.array(img)

    clip = VideoClip(make_frame, duration=duration)
    return _with_fps(_no_audio(clip), PUB_FPS)


def karaoke_caption_clip(text: str, duration: float, position: str = "center"):
    """Sous-titres style GHL — mots qui apparaissent un par un, centrés."""
    _, _, VideoClip, _, _ = _import_moviepy()
    words = text.split()
    if not words:
        words = [text]

    def make_frame(t):
        img = Image.new("RGBA", (PUB_WIDTH, PUB_HEIGHT), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        n = len(words)
        idx = min(int(t / max(duration / n, 0.01)), n - 1)
        visible = " ".join(words[: idx + 1])
        font = _font(56, True)
        # Ombre portée
        max_w = PUB_WIDTH - 80
        lines, cur = [], ""
        for w in visible.split():
            test = f"{cur} {w}".strip()
            bb = draw.textbbox((0, 0), test, font=font)
            if bb[2] - bb[0] <= max_w:
                cur = test
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        line_h = 68
        if position == "center":
            y0 = int(PUB_HEIGHT * 0.42) - (len(lines) * line_h) // 2
        else:
            y0 = PUB_HEIGHT - 160 - len(lines) * line_h
        for line in lines:
            bb = draw.textbbox((0, 0), line, font=font)
            x = (PUB_WIDTH - (bb[2] - bb[0])) // 2
            for dx, dy in [(-2, 0), (2, 0), (0, -2), (0, 2)]:
                draw.text((x + dx, y0 + dy), line, font=font, fill=(0, 0, 0, 200))
            draw.text((x, y0), line, font=font, fill=(255, 255, 255, 255))
            y0 += line_h
        return np.array(img)

    clip = VideoClip(make_frame, duration=duration)
    return _with_fps(_no_audio(clip), PUB_FPS)


def overlay_on_clip(base_clip, overlay_clip):
    """Superpose overlay RGBA sur clip vidéo."""
    CompositeVideoClip, _, _, _, _ = _import_moviepy()

    def composite_frame(t):
        base = base_clip.get_frame(t)
        over = overlay_clip.get_frame(t)
        if over.shape[-1] == 4:
            img = Image.fromarray(base).convert("RGBA")
            ov = Image.fromarray(over)
            return np.array(Image.alpha_composite(img, ov).convert("RGB"))
        return base

    _, _, VideoClip, _, _ = _import_moviepy()
    dur = min(base_clip.duration, overlay_clip.duration)
    comp = VideoClip(composite_frame, duration=dur)
    return _with_fps(_no_audio(comp), PUB_FPS)


def write_pub(clips: list, out_path: Path, audio_path: Path | None = None) -> None:
    _, _, _, _, concatenate_videoclips = _import_moviepy()
    final = concatenate_videoclips(clips, method="compose")
    kwargs = dict(fps=PUB_FPS, codec="libx264", preset="medium", threads=4, logger=None)
    if audio_path and audio_path.exists():
        try:
            from moviepy import AudioFileClip
        except ImportError:
            from moviepy.editor import AudioFileClip
        audio = AudioFileClip(str(audio_path))
        if audio.duration > final.duration:
            audio = _subclip(audio, 0, final.duration)
        elif audio.duration < final.duration:
            try:
                from moviepy import concatenate_audioclips
            except ImportError:
                from moviepy.editor import concatenate_audioclips
            loops = int(final.duration / max(audio.duration, 0.1)) + 1
            audio = concatenate_audioclips([audio] * loops)
            audio = _subclip(audio, 0, final.duration)
        vol = 0.35
        if hasattr(audio, "with_volume_scaled"):
            audio = audio.with_volume_scaled(vol)
        elif hasattr(audio, "volumex"):
            audio = audio.volumex(vol)
        if hasattr(final, "with_audio"):
            final = final.with_audio(audio)
        else:
            final = final.set_audio(audio)
        kwargs["audio_codec"] = "aac"
    else:
        kwargs["audio"] = False

    out_path.parent.mkdir(parents=True, exist_ok=True)
    final.write_videofile(str(out_path), **kwargs)
    final.close()
    for c in clips:
        try:
            c.close()
        except Exception:
            pass
