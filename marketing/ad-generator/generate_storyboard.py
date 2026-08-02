#!/usr/bin/env python3
"""Génère un storyboard pub 30s NoviaAI — concept seulement (sans vidéo)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
PIPELINE = ROOT.parent / "video-pipeline"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(PIPELINE))

from utils import load_secrets_into_env, setup_logging  # noqa: E402

log = setup_logging("storyboard", "storyboard.log")
OUT = ROOT / "output" / "noviaai_demo_pme"

BRIEF = """
Publicité 30s NoviaAI — SaaS québécois, style GoHighLevel.
Objectif : démos avec PME qui perdent des clients (réponse trop lente).
Cibles : plombiers, électriciens, garages, entrepreneurs, salons, cliniques, entreprises locales.
Format : vertical 9:16, TikTok/Reels/Facebook Ads.
Ton : réaliste, professionnel, émotionnel — perte d'argent + solution simple (pas vendre la tech).

5 scènes imposées :
1 (0-3s) HOOK — entrepreneur occupé, appel entrant, ne peut pas répondre
2 (3-10s) PROBLÈME — notifications, appels manqués, client qui attend
3 (10-18s) SOLUTION — NoviaAI répond, qualifie, RDV
4 (18-26s) RÉSULTAT — "Nouveau rendez-vous confirmé", tranquillité
5 (26-30s) CTA — logo NoviaAI, démo

Pour CHAQUE scène fournir :
- duree, titre, description_visuelle, emotion, texte_ecran (exact FR), voix_off (exact FR), prompt_image (EN pour GPT Image, 9:16), prompt_runway (EN, mouvement caméra 5s max)
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "titre_pub": {"type": "string"},
        "angle_marketing": {"type": "string"},
        "voix_off_complete": {
            "type": "string",
            "description": "Script voix-off complet 30s, ~85-100 mots, québécois professionnel",
        },
        "musique_suggestion": {"type": "string"},
        "scenes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "numero": {"type": "integer"},
                    "timing": {"type": "string"},
                    "titre": {"type": "string"},
                    "description_visuelle": {"type": "string"},
                    "objectif_emotionnel": {"type": "string"},
                    "texte_ecran": {"type": "string"},
                    "voix_off": {"type": "string"},
                    "prompt_image": {"type": "string"},
                    "prompt_runway": {"type": "string"},
                },
                "required": [
                    "numero", "timing", "titre", "description_visuelle",
                    "objectif_emotionnel", "texte_ecran", "voix_off",
                    "prompt_image", "prompt_runway",
                ],
                "additionalProperties": False,
            },
        },
        "textes_ecran_recap": {
            "type": "array",
            "items": {"type": "string"},
        },
        "cta_final": {"type": "string"},
        "description_reseaux": {"type": "string"},
    },
    "required": [
        "titre_pub", "angle_marketing", "voix_off_complete",
        "musique_suggestion", "scenes", "textes_ecran_recap",
        "cta_final", "description_reseaux",
    ],
    "additionalProperties": False,
}


def generate() -> dict:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY manquante")

    payload = {
        "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        "temperature": 0.75,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Tu es directeur créatif pub performance B2B pour PME québécoises. "
                    "Style GoHighLevel : stats choc, émotion perte d'argent, solution simple. "
                    "Pas de face cam fondateur. JSON strict."
                ),
            },
            {"role": "user", "content": BRIEF},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "storyboard_noviaai",
                "strict": True,
                "schema": SCHEMA,
            },
        },
    }
    r = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=payload,
        timeout=180,
    )
    r.raise_for_status()
    return json.loads(r.json()["choices"][0]["message"]["content"])


def format_md(data: dict) -> str:
    lines = [
        f"# {data['titre_pub']}",
        "",
        f"**Angle :** {data['angle_marketing']}",
        "",
        "## Voix-off complète (30 s)",
        data["voix_off_complete"],
        "",
        f"**Musique :** {data['musique_suggestion']}",
        "",
        "---",
        "",
    ]
    for s in data["scenes"]:
        lines += [
            f"## Scène {s['numero']} — {s['titre']} ({s['timing']})",
            "",
            f"**Visuel :** {s['description_visuelle']}",
            "",
            f"**Émotion :** {s['objectif_emotionnel']}",
            "",
            f"**Texte à l'écran :** « {s['texte_ecran']} »",
            "",
            f"**Voix-off :** {s['voix_off']}",
            "",
            "**Prompt image (GPT Image) :**",
            f"```\n{s['prompt_image']}\n```",
            "",
            "**Prompt Runway :**",
            f"```\n{s['prompt_runway']}\n```",
            "",
            "---",
            "",
        ]
    lines += [
        "## Textes écran — récap",
        "",
    ]
    for i, t in enumerate(data["textes_ecran_recap"], 1):
        lines.append(f"{i}. {t}")
    lines += [
        "",
        f"## CTA final",
        data["cta_final"],
        "",
        "## Description réseaux sociaux",
        data["description_reseaux"],
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    load_secrets_into_env()
    log.info("Generation storyboard NoviaAI demo PME…")
    data = generate()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "STORYBOARD_LATEST.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "STORYBOARD_LATEST.md").write_text(format_md(data), encoding="utf-8")
    print(format_md(data))
    print(f"\nSauvegarde : {OUT / 'STORYBOARD_LATEST.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
