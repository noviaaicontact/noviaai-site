"""Pipeline complet : concept + image GPT Image + vidéo Runway."""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openai_ad import generate_ad_concept
from openai_image import generate_image
from runway_guard import RunwayNotApproved, is_runway_allowed, require_runway_approval

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"


def slugify(*parts: str) -> str:
    raw = "_".join(p.strip().lower() for p in parts if p.strip())
    out = []
    for ch in raw:
        if ch.isalnum():
            out.append(ch)
        elif ch in " -_":
            out.append("_")
    s = "".join(out)
    while "__" in s:
        s = s.replace("__", "_")
    return s.strip("_") or "pub"


def format_pub(pub: dict) -> str:
    meta = pub["meta"]
    lines = [
        f"=== PUBLICITÉ {meta['produit']} — {meta['niche']} ===",
        f"Objectif : {meta['objectif']}",
        "",
        "HOOK",
        pub["hook"],
        "",
        "SCRIPT 30 SECONDES",
        pub["script_30s"],
        "",
        "TEXTE À L'ÉCRAN",
    ]
    for i, t in enumerate(pub["texte_ecran"], 1):
        lines.append(f"  {i}. {t}")
    lines += [
        "",
        "DESCRIPTION",
        pub["description"],
        "",
        "PROMPT IMAGE",
        pub["prompt_image"],
        "",
        "PROMPT VIDÉO (Runway)",
        pub.get("prompt_video_motion", ""),
        "",
    ]
    if pub.get("image"):
        lines += [
            "IMAGE",
            f"  {pub['image']['path']}",
            "",
        ]
    if pub.get("video"):
        lines += [
            "VIDÉO",
            f"  {pub['video']['path']}",
            f"  Modèle Runway : {pub['video']['model']}",
            "",
        ]
    elif pub.get("video_error"):
        lines += [
            "VIDÉO (non générée)",
            f"  {pub['video_error']}",
            "",
        ]
    return "\n".join(lines)


def save_pub(pub: dict) -> dict[str, str]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    base = slugify(pub["meta"]["niche"])
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    folder = OUTPUT_DIR / base
    folder.mkdir(parents=True, exist_ok=True)

    json_path = folder / f"{base}_{ts}.json"
    txt_path = folder / f"{base}_{ts}.txt"
    latest_json = folder / f"{base}_LATEST.json"
    latest_txt = folder / f"{base}_LATEST.txt"

    payload = json.dumps(pub, ensure_ascii=False, indent=2)
    json_path.write_text(payload, encoding="utf-8")
    latest_json.write_text(payload, encoding="utf-8")
    txt_path.write_text(format_pub(pub), encoding="utf-8")
    latest_txt.write_text(format_pub(pub), encoding="utf-8")

    return {
        "json": str(json_path),
        "txt": str(txt_path),
        "latest_json": str(latest_json),
        "latest_txt": str(latest_txt),
    }


def generate_pub_complete(
    niche: str,
    produit: str,
    objectif: str,
    *,
    plateforme: str = "TikTok",
    image_model: str | None = None,
    runway_model: str | None = None,
    with_video: bool = False,
    video_duration: int = 5,
    allow_runway: bool = False,
) -> dict[str, Any]:
    """
    Workflow complet :
    1. OpenAI → concept (hook, script, textes, description, prompts)
    2. GPT Image → visuel 9:16
    3. Runway → clip vidéo animé depuis l'image (UNIQUEMENT si allow_runway=True)

    Retourne script + image + vidéo.
    """
    niche = niche.strip()
    produit = produit.strip()
    objectif = objectif.strip()
    if not niche or not produit or not objectif:
        raise ValueError("niche, produit et objectif sont requis")

    concept = generate_ad_concept(niche, produit, objectif, plateforme)

    base = slugify(niche)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    folder = OUTPUT_DIR / base
    folder.mkdir(parents=True, exist_ok=True)

    image_path = folder / f"{base}_{ts}.png"
    latest_image = folder / f"{base}_LATEST.png"
    image_meta = generate_image(concept["prompt_image"], image_path, model=image_model)
    shutil.copy2(image_path, latest_image)
    image_meta["latest_path"] = str(latest_image.resolve())

    pub: dict[str, Any] = {**concept, "image": image_meta}

    if with_video:
        if not allow_runway and not is_runway_allowed():
            pub["video_error"] = str(RunwayNotApproved())
            pub["meta"] = pub.get("meta") or {}
            pub["meta"]["video_skipped"] = "runway_not_approved"
        else:
            require_runway_approval(source="pub_pipeline.generate_pub_complete")
            motion = concept.get("prompt_video_motion") or (
                f"Subtle cinematic push-in, social media ad motion, {concept['hook'][:120]}"
            )
            video_path = folder / f"{base}_{ts}.mp4"
            latest_video = folder / f"{base}_LATEST.mp4"
            try:
                from runway_video import generate_video_from_image

                video_meta = generate_video_from_image(
                    image_path,
                    motion,
                    video_path,
                    model=runway_model,
                    duration=video_duration,
                )
                shutil.copy2(video_path, latest_video)
                video_meta["latest_path"] = str(latest_video.resolve())
                pub["video"] = video_meta
            except RuntimeError as ex:
                pub["video_error"] = str(ex)
                pub.setdefault("meta", {})["video_skipped"] = True

    pub.setdefault("meta", concept.get("meta") or {
        "niche": niche, "produit": produit, "objectif": objectif, "plateforme": plateforme,
    })

    pub["files"] = save_pub(pub)
    return pub
