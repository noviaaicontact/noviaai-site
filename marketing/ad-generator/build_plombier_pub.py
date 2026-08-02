#!/usr/bin/env python3
"""Pub NoviaAI plombier — 4 scenes / ~28 s / 2 clips Runway.

Plan:
  1. Hook plombier (GPT Image → Runway 5 s) + texte overlay
  2. Client + SMS NoviaAI (pipeline local scene2, textes plomberie)
  3. Resultat plombier calme (GPT Image → Runway 5 s) + texte overlay
  4. Carton logo (scene3_logo)

Usage:
  python build_plombier_pub.py                 # tout
  python build_plombier_pub.py --plates-only   # images seulement
  python build_plombier_pub.py --runway-only   # Runway seulement (plates deja la)
  python build_plombier_pub.py --assemble-only
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
SITE = ROOT.parents[1]
sys.path.insert(0, str(ROOT.parent / "video-pipeline"))
from utils import load_secrets_into_env  # noqa: E402

load_secrets_into_env()
# Aussi charger le .env principal si present
env_main = SITE.parent / "rattrapeur-sms" / ".env"
if env_main.exists():
    for line in env_main.read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if not t or t.startswith("#") or "=" not in t:
            continue
        k, _, v = t.partition("=")
        if k.strip() and v.strip() and not os.environ.get(k.strip()):
            os.environ[k.strip()] = v.strip().strip('"').strip("'")

from openai_image import generate_image  # noqa: E402
from runway_guard import grant_runway_approval  # noqa: E402
from runway_video import generate_video_from_image  # noqa: E402
import scene1_garage as s1  # noqa: E402
import scene2_client as s2  # noqa: E402
import scene3_logo as s3  # noqa: E402

OUT = ROOT / "output" / "noviaai_plombier_runway"
WORK = OUT / "_work"
PLATE1 = WORK / "plate_hook.png"
PLATE3 = WORK / "plate_result.png"
CLIP1 = WORK / "runway_hook.mp4"
CLIP3 = WORK / "runway_result.mp4"
SCENE1 = OUT / "scene1_hook_LATEST.mp4"
SCENE2 = OUT / "scene2_sms_LATEST.mp4"
SCENE3 = OUT / "scene3_result_LATEST.mp4"
SCENE4 = OUT / "scene4_logo_LATEST.mp4"
PUB = OUT / "pub_plombier_LATEST.mp4"

W, H, FPS = s1.W, s1.H, s1.FPS

PROMPT_HOOK = (
    "Photorealistic cinematic advertising still, vertical 9:16. Quebec plumber mid-40s "
    "under a kitchen sink, gray work polo, hands busy with a wrench on copper pipes. "
    "Smartphone on the tiled floor nearby glowing with an incoming call (blurred screen, "
    "no readable text). Frustrated quick glance toward the phone, jaw tight. Natural "
    "window daylight, shallow depth of field, dust in the light, muted teal-orange grade, "
    "premium SaaS commercial aesthetic Apple/Intercom quality. No text, no logos, no watermark."
)

PROMPT_RESULT = (
    "Photorealistic cinematic advertising still, vertical 9:16. Same Quebec plumber mid-40s "
    "under a kitchen sink continuing his work calmly, slight relieved expression. Smartphone "
    "on the floor with a soft lime-green notification glow, screen completely blurred no "
    "readable text. Warm natural light, peaceful mood, shallow depth of field, premium SaaS "
    "ad aesthetic. No text, no logos, no watermark."
)

RUNWAY_HOOK = (
    "Slow subtle push-in, plumber working under sink, phone vibrates once on the floor, "
    "he glances at it unable to answer, realistic documentary motion, vertical 9:16, "
    "no text no logos"
)

RUNWAY_RESULT = (
    "Slow pull-back, plumber continues working calmly under sink, phone buzzes once with "
    "soft notification glow, subtle relieved breath, warm light, vertical 9:16, "
    "no text no logos"
)

CAPTION1 = [(0.80, 5.00, [("Trop occupé pour", s1.WHITE), ("répondre?", s1.WHITE)])]
CAPTION3 = [(0.60, 5.00, [("Nouveau rendez-vous", s1.LIME), ("confirmé.", s1.WHITE)])]


def make_plates() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    if not PLATE1.exists():
        print("[plate] Hook plombier...")
        generate_image(PROMPT_HOOK, PLATE1, model="gpt-image-1", size="1024x1536", quality="high")
    else:
        print("[plate] Hook deja present")
    if not PLATE3.exists():
        print("[plate] Resultat plombier...")
        generate_image(PROMPT_RESULT, PLATE3, model="gpt-image-1", size="1024x1536", quality="high")
    else:
        print("[plate] Resultat deja present")


def make_runway() -> None:
    grant_runway_approval()
    if not CLIP1.exists():
        print("[runway] Scene 1 — 5 s (credits)...")
        generate_video_from_image(PLATE1, RUNWAY_HOOK, CLIP1, duration=5, ratio="720:1280")
    else:
        print("[runway] Scene 1 deja presente")
    if not CLIP3.exists():
        print("[runway] Scene 3 — 5 s (credits)...")
        generate_video_from_image(PLATE3, RUNWAY_RESULT, CLIP3, duration=5, ratio="720:1280")
    else:
        print("[runway] Scene 3 deja presente")


def _scale_to_vertical(src: Path, dst: Path, duration: float | None = None) -> None:
    """Scale/crop un clip Runway en 1080x1920, reencode propre."""
    cmd = [
        "ffmpeg", "-y", "-v", "error", "-i", str(src),
        "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS}",
        "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-an",
    ]
    if duration is not None:
        cmd.extend(["-t", f"{duration:.2f}"])
    cmd.append(str(dst))
    subprocess.run(cmd, check=True)


def burn_captions(src: Path, dst: Path, captions, duration: float, wav: Path | None = None) -> None:
    """Compose texte + grade leger image par image (meme police que garage)."""
    from PIL import Image
    import tempfile

    silent = WORK / f"_cap_{dst.stem}.mp4"
    # extraire frames via ffmpeg pipe
    n = int(duration * FPS)
    proc_in = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", str(src),
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-"],
        stdout=subprocess.PIPE,
    )
    proc_out = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p",
         str(silent)],
        stdin=subprocess.PIPE,
    )
    assert proc_in.stdout and proc_out.stdin
    frame_bytes = W * H * 3
    for i in range(n):
        raw = proc_in.stdout.read(frame_bytes)
        if len(raw) < frame_bytes:
            break
        t = i / FPS
        arr = np.frombuffer(raw, dtype=np.uint8).reshape(H, W, 3).copy()
        # leger grade coherent avec le reste
        arr = s1.grade(arr, t)
        img = Image.fromarray(arr)
        img = s1.draw_caption(img, t, captions, duration)
        proc_out.stdin.write(np.asarray(img, dtype=np.uint8).tobytes())
        if i % 30 == 0:
            print(f"      captions {i}/{n}", flush=True)
    proc_out.stdin.close()
    proc_in.wait()
    proc_out.wait()

    if wav and wav.exists():
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(silent), "-i", str(wav),
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(dst)],
            check=True,
        )
    else:
        silent.replace(dst)


def synth_bed(path: Path, duration: float, pad_gain: float = 0.12, bright: bool = False) -> None:
    sr = s1.SR
    n = int(duration * sr)
    t = np.arange(n) / sr
    rng = np.random.default_rng(42)
    brown = np.cumsum(rng.normal(0, 1, n).astype(np.float32))
    brown /= np.max(np.abs(brown)) + 1e-9
    mix = brown * 0.08
    pad = (np.sin(2 * np.pi * 82.4 * t) * 0.50 + np.sin(2 * np.pi * 164.8 * t) * 0.22
           + np.sin(2 * np.pi * 246.0 * t) * 0.08)
    mix += (pad * pad_gain).astype(np.float32)
    if bright:
        b = np.sin(2 * np.pi * 207.65 * t) * 0.25 + np.sin(2 * np.pi * 311.1 * t) * 0.12
        mix += (b * 0.10).astype(np.float32)
    # phone buzz hint on scene 1
    if not bright:
        for start in (1.1, 2.4, 3.7):
            i0 = int(start * sr)
            ln = int(0.45 * sr)
            if i0 + ln >= n:
                break
            lt = np.arange(ln) / sr
            buzz = np.sin(2 * np.pi * 175 * lt) * np.sin(2 * np.pi * 22 * lt)
            buzz *= np.exp(-lt * 2.5)
            mix[i0:i0 + ln] += (buzz * 0.18).astype(np.float32)
    head = int(0.02 * sr)
    tail = int(0.15 * sr)
    mix[:head] *= np.linspace(0, 1, head)
    mix[-tail:] *= np.linspace(1, 0, tail)
    mix /= max(np.max(np.abs(mix)), 1e-6)
    mix *= 0.85
    stereo = np.stack([mix, mix * 0.98], axis=1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(sr)
        f.writeframes(pcm.tobytes())


def finish_runway_scenes() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    scaled1 = WORK / "hook_scaled.mp4"
    scaled3 = WORK / "result_scaled.mp4"
    print("[compose] Scene 1 captions...")
    _scale_to_vertical(CLIP1, scaled1, duration=5.0)
    wav1 = WORK / "scene1_audio.wav"
    synth_bed(wav1, 5.0, pad_gain=0.12, bright=False)
    burn_captions(scaled1, SCENE1, CAPTION1, 5.0, wav1)

    print("[compose] Scene 3 captions...")
    _scale_to_vertical(CLIP3, scaled3, duration=5.0)
    wav3 = WORK / "scene3_result_audio.wav"
    synth_bed(wav3, 5.0, pad_gain=0.14, bright=True)
    burn_captions(scaled3, SCENE3, CAPTION3, 5.0, wav3)


def make_sms_scene() -> None:
    """Reutilise scene2_client avec textes plomberie, sans ecraser la pub garage."""
    print("[sms] Adaptation textes plomberie...")
    s2.OUT_DIR = OUT
    s2.WORK = WORK
    s2.PLATE_PNG = WORK / "scene2_plate.png"
    # reutiliser la plaque client auto de la demo si on n'en a pas encore
    demo_plate = ROOT / "output" / "noviaai_demo_pme" / "_work" / "scene2_plate.png"
    if not s2.PLATE_PNG.exists() and demo_plate.exists():
        s2.PLATE_PNG.write_bytes(demo_plate.read_bytes())

    s2.GARAGE_NAME = "Plomberie Rive-Sud"
    s2.SMS_PREVIEW = "Désolé, on a manqué votre appel! Je peux vous aider…"
    s2.THREAD = [
        (s2.T_THREAD, "recu",
         "Désolé, on a manqué votre appel! Je suis en chantier. "
         "Je peux vous aider par texto — c'est quoi le problème?"),
        (s2.T_REPLY, "envoye", "Fuite sous l'évier, ça coule fort."),
        (s2.T_BOOK, "recu",
         "Parfait. J'ai une place demain 9 h ou 14 h. Laquelle vous convient?"),
        (s2.T_SEND, "envoye", s2.TYPED),
    ]
    s2.CAPTIONS = [
        (5.30, 10.60, [("NoviaAI", s1.LIME), ("a répondu pour vous.", s1.WHITE)]),
    ]
    out = s2.render(with_audio=True, preview=False, regen_plate=False)
    SCENE2.write_bytes(out.read_bytes())
    src_wav = WORK / "scene2_audio.wav"
    if not src_wav.exists():
        raise FileNotFoundError("scene2_audio.wav manquant apres rendu SMS")
    print(f"[sms] OK -> {SCENE2}")


def make_logo() -> None:
    print("[logo] Carton final...")
    s3.OUT_DIR = OUT
    s3.WORK = WORK
    out = s3.render(with_audio=True, preview=False)
    # s3 ecrit scene3_logo_LATEST + scene3_audio.wav — on renomme pour la scene 4
    latest = OUT / "scene3_logo_LATEST.mp4"
    src = latest if latest.exists() else out
    SCENE4.write_bytes(src.read_bytes())
    logo_wav = WORK / "scene3_audio.wav"
    if logo_wav.exists():
        (WORK / "scene4_audio.wav").write_bytes(logo_wav.read_bytes())
    else:
        s3.synth_audio(WORK / "scene4_audio.wav")
    print(f"[logo] OK -> {SCENE4}")


def assemble() -> None:
    print("[assemble] Montage final...")
    if not (WORK / "scene4_audio.wav").exists():
        s3.WORK = WORK
        s3.synth_audio(WORK / "scene4_audio.wav")

    listing = WORK / "concat.txt"
    parts = [SCENE1, SCENE2, SCENE3, SCENE4]
    for p in parts:
        if not p.exists():
            raise FileNotFoundError(p)
    listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")

    video = WORK / "pub_video.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", str(listing), "-an", "-c:v", "copy", str(video)], check=True)

    wavs = [
        WORK / "scene1_audio.wav",
        WORK / "scene2_audio.wav",
        WORK / "scene3_result_audio.wav",
        WORK / "scene4_audio.wav",
    ]
    chunks = []
    sr = ch = None
    for w in wavs:
        with wave.open(str(w), "rb") as f:
            data = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16)
            if sr is None:
                sr, ch = f.getframerate(), f.getnchannels()
            chunks.append(data)
    joined = WORK / "pub_audio.wav"
    with wave.open(str(joined), "wb") as f:
        f.setnchannels(ch)
        f.setsampwidth(2)
        f.setframerate(sr)
        f.writeframes(np.concatenate(chunks).tobytes())

    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-i", str(joined),
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(PUB)],
                   check=True)
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(PUB)], capture_output=True, text=True).stdout.strip()
    print(f"OK -> {PUB}  ({float(dur):.2f} s)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plates-only", action="store_true")
    ap.add_argument("--runway-only", action="store_true")
    ap.add_argument("--sms-only", action="store_true")
    ap.add_argument("--assemble-only", action="store_true")
    ap.add_argument("--skip-runway", action="store_true")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)

    if args.assemble_only:
        assemble()
        return 0
    if args.plates_only:
        make_plates()
        return 0
    if args.runway_only:
        make_runway()
        finish_runway_scenes()
        return 0
    if args.sms_only:
        make_sms_scene()
        return 0

    make_plates()
    if not args.skip_runway:
        make_runway()
        finish_runway_scenes()
    make_sms_scene()
    make_logo()
    assemble()
    return 0


if __name__ == "__main__":
    sys.exit(main())
