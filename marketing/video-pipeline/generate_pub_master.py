#!/usr/bin/env python3
"""
Pub NoviaAI complète — 100 % local
  • B-roll animé (call, busy, result)
  • Mockups SMS Novia
  • Optionnel : clip dashboard Playwright
  • Assemblage final MP4 vertical 1080×1920
"""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from config import (
    LOCAL_CLIPS_DIR,
    PLAN_DURATIONS,
    PUB_FPS,
    PUB_HEIGHT,
    PUBS_DIR,
    PUB_WIDTH,
)
from utils import setup_logging

log = setup_logging("pub_master", "pub_master.log")

ROOT = Path(__file__).resolve().parent
SITE_ROOT = ROOT.parent.parent
DEMO_DIR = SITE_ROOT / "marketing" / "demo-videos"

MASTER_SCRIPT = {
    "titre": "NoviaAI — Pub master",
    "metier": "plombier",
    "plans": [
        {"scene": "call", "texte": "Il compose. Ça sonne dans le vide.", "clip": "broll_call_01.mp4", "dur": 4},
        {"scene": "busy", "texte": "Toi? T'es sous l'évier. Pris.", "clip": "broll_busy_01.mp4", "dur": 6},
        {"scene": "sms", "texte": "Il reçoit ton texto. Tout de suite.", "clip": "sms_novia_plombier_01.mp4", "dur": 8},
        {"scene": "result", "texte": "RDV booké. Essai gratuit 14 jours → noviaai.ca", "clip": "broll_result_01.mp4", "dur": 7},
    ],
}


def _import_moviepy():
    try:
        from moviepy import CompositeVideoClip, ImageClip, VideoFileClip, concatenate_videoclips
    except ImportError:
        from moviepy.editor import CompositeVideoClip, ImageClip, VideoFileClip, concatenate_videoclips
    return CompositeVideoClip, ImageClip, VideoFileClip, concatenate_videoclips


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for p in [Path("C:/Windows/Fonts/segoeuib.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")]:
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def render_text_frame(text: str, w: int, h: int, fs: int = 50) -> np.ndarray:
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = _font(fs)
    bar = int(h * 0.62)
    draw.rectangle([0, bar, w, h], fill=(0, 0, 0, 190))
    words = text.split()
    lines, cur = [], ""
    for word in words:
        test = f"{cur} {word}".strip()
        bb = draw.textbbox((0, 0), test, font=font)
        if bb[2] - bb[0] <= w - 80:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    lh = fs + 10
    y = bar + max((h - bar - len(lines) * lh) // 2, 16)
    for ln in lines:
        bb = draw.textbbox((0, 0), ln, font=font)
        x = (w - (bb[2] - bb[0])) // 2
        draw.text((x + 2, y + 2), ln, font=font, fill=(0, 0, 0, 220))
        draw.text((x, y), ln, font=font, fill=(255, 255, 255, 255))
        y += lh
    return np.array(img)


def fit_portrait(clip, w=PUB_WIDTH, h=PUB_HEIGHT):
    scale = max(w / clip.w, h / clip.h)
    clip = clip.resized(scale) if hasattr(clip, "resized") else clip.resize(scale)
    cx, cy = clip.w / 2, clip.h / 2
    if hasattr(clip, "cropped"):
        return clip.cropped(x_center=cx, y_center=cy, width=w, height=h)
    return clip.crop(x_center=cx, y_center=cy, width=w, height=h)


def subclip(clip, t0, t1):
    if hasattr(clip, "subclipped"):
        return clip.subclipped(t0, t1)
    return clip.subclip(t0, t1)


def run_step(name: str, script: str) -> bool:
    path = ROOT / script
    log.info("▶ %s", name)
    r = subprocess.run([sys.executable, str(path)], cwd=str(ROOT))
    if r.returncode != 0:
        log.error("Échec %s (code %s)", name, r.returncode)
        return False
    return True


def capture_dashboard_clip() -> Path | None:
    """Lance la démo Playwright si le serveur :8888 répond."""
    import urllib.request

    try:
        urllib.request.urlopen("http://127.0.0.1:8888/conversations.html", timeout=3)
    except Exception:
        log.info("Serveur :8888 inactif — skip clip dashboard Playwright")
        return None

    log.info("▶ Enregistrement dashboard Playwright…")
    r = subprocess.run(
        ["node", str(SITE_ROOT / "scripts" / "demo-missed-call-video.mjs")],
        cwd=str(SITE_ROOT),
        capture_output=True,
        text=True,
        timeout=180,
    )
    if r.returncode != 0:
        log.warning("Playwright skip: %s", (r.stderr or r.stdout or "")[:200])
        return None

    vids = sorted(DEMO_DIR.glob("demo-appel-manque-*.*"), key=lambda p: p.stat().st_mtime, reverse=True)
    if vids:
        log.info("✓ Clip dashboard : %s", vids[0].name)
        return vids[0]
    return None


def build_main_pub(out_path: Path) -> None:
    CompositeVideoClip, ImageClip, VideoFileClip, concatenate_videoclips = _import_moviepy()

    parts, overlays, opened = [], [], []
    t = 0.0

    for plan in MASTER_SCRIPT["plans"]:
        dur = float(plan["dur"])
        clip_path = LOCAL_CLIPS_DIR / plan["clip"]
        if not clip_path.exists():
            raise FileNotFoundError(f"Clip manquant : {clip_path}")

        seg = VideoFileClip(str(clip_path))
        seg = fit_portrait(seg)
        if seg.duration >= dur:
            start = max(0.0, (seg.duration - dur) / 2)
            seg = subclip(seg, start, start + dur)
        else:
            loops = int(dur / max(seg.duration, 0.1)) + 1
            seg = concatenate_videoclips([seg] * loops)
            seg = subclip(seg, 0, dur)
        if hasattr(seg, "without_audio"):
            seg = seg.without_audio()
        else:
            seg = seg.set_audio(None)

        parts.append(seg)
        opened.append(seg)

        fs = 54 if len(plan["texte"]) <= 35 else 46
        ic = ImageClip(render_text_frame(plan["texte"], PUB_WIDTH, PUB_HEIGHT, fs))
        if hasattr(ic, "with_start"):
            ic = ic.with_start(t).with_duration(dur)
        else:
            ic = ic.set_start(t).set_duration(dur)
        overlays.append(ic)
        t += dur

    video = concatenate_videoclips(parts, method="compose")
    final = CompositeVideoClip([video, *overlays], size=(PUB_WIDTH, PUB_HEIGHT))
    if hasattr(final, "with_duration"):
        final = final.with_duration(t)
    else:
        final = final.set_duration(t)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    final.write_videofile(str(out_path), fps=PUB_FPS, codec="libx264", audio=False, preset="medium", logger=None)
    video.close()
    final.close()
    for c in opened:
        c.close()


def append_dashboard(main: Path, dash: Path, out: Path) -> None:
    """Concatène pub + dashboard (recadre dashboard en portrait)."""
    _, _, VideoFileClip, concatenate_videoclips = _import_moviepy()

    a = VideoFileClip(str(main))
    b = VideoFileClip(str(dash))
    b = fit_portrait(b)
    max_d = min(b.duration, 12.0)
    b = subclip(b, 0, max_d)
    if hasattr(b, "without_audio"):
        b = b.without_audio()

    combined = concatenate_videoclips([a, b], method="compose")
    combined.write_videofile(str(out), fps=PUB_FPS, codec="libx264", audio=False, preset="medium", logger=None)
    a.close()
    b.close()
    combined.close()


def main() -> int:
    log.info("=== Pub NoviaAI — génération complète (local) ===")

    if not run_step("Mockups SMS", "generate_sms_mockups.py"):
        return 1
    if not run_step("B-roll animé", "generate_local_broll.py"):
        return 1

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    PUBS_DIR.mkdir(parents=True, exist_ok=True)
    pub_main = PUBS_DIR / f"pub_noviaai_{stamp}.mp4"

    log.info("▶ Assemblage pub narrative…")
    try:
        build_main_pub(pub_main)
    except Exception as e:
        log.error("Assemblage échoué: %s", e)
        return 1

    dash = capture_dashboard_clip()
    pub_final = PUBS_DIR / f"pub_noviaai_COMPLETE_{stamp}.mp4"

    if dash and dash.exists():
        log.info("▶ Fusion pub + dashboard…")
        append_dashboard(pub_main, dash, pub_final)
        log.info("✅ PUB COMPLÈTE : %s", pub_final)
    else:
        pub_final = pub_main
        log.info("✅ PUB (sans dashboard) : %s", pub_final)

    # Copie alias
    alias = PUBS_DIR / "pub_noviaai_LATEST.mp4"
    import shutil
    shutil.copy2(pub_final, alias)
    log.info("✅ Copie : %s", alias)
    return 0


if __name__ == "__main__":
    sys.exit(main())
