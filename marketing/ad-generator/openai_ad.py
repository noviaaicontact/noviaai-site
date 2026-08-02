"""Client OpenAI — génération de publicités structurées."""
from __future__ import annotations

import json
import os
from typing import Any

import requests

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

AD_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "hook": {
            "type": "string",
            "description": "Accroche percutante (1-2 phrases max), première seconde de la pub",
        },
        "script_30s": {
            "type": "string",
            "description": "Script voix off ou narration, ~75-90 mots, durée 30 secondes",
        },
        "texte_ecran": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Textes à afficher à l'écran, un par plan ou beat (5-8 lignes)",
        },
        "description": {
            "type": "string",
            "description": "Description/caption pour la plateforme sociale avec CTA et hashtags",
        },
        "prompt_image": {
            "type": "string",
            "description": "Prompt détaillé EN ANGLAIS pour GPT Image — vertical 9:16, scène pub performance",
        },
        "prompt_video_motion": {
            "type": "string",
            "description": "Prompt EN ANGLAIS court pour Runway image-to-video : mouvement caméra, animation subtile, 5s",
        },
    },
    "required": [
        "hook",
        "script_30s",
        "texte_ecran",
        "description",
        "prompt_image",
        "prompt_video_motion",
    ],
    "additionalProperties": False,
}

NOVIA_CONTEXT = """
NoviaAI (noviaai.ca) — SaaS québécois pour PME locales.
Proposition de valeur :
- Appel manqué → texto automatique en ~8 secondes
- Agent IA qui qualifie le client et propose un RDV par SMS
- Dashboard : inbox, stats appels rattrapés, RDV bookés
- Essai gratuit 14 jours, forfait ~199$/mois
Ton : direct, québécois (tu/vous selon niche), concret, pas de jargon tech.
Style pub : stats choc, mockup SMS sur téléphone, dashboard, cuts rapides — PAS de face cam fondateur.
"""


def build_messages(niche: str, produit: str, objectif: str, plateforme: str) -> list[dict[str, str]]:
    user = f"""Génère une publicité complète pour :

- Niche / audience : {niche}
- Produit / offre : {produit}
- Objectif marketing : {objectif}
- Plateforme cible : {plateforme}

Contexte produit :
{NOVIA_CONTEXT}

Exigences :
- Langue : français québécois (sauf prompt_image en anglais)
- Script 30 s : ~75-90 mots, segments [0-3s], [3-10s], etc.
- texte_ecran : 5-8 phrases courtes pour overlay vidéo (style CapCut)
- description : CTA noviaai.ca/signup?utm_source={plateforme.lower()}&utm_campaign={niche.lower().replace(' ', '-')}
- prompt_image : EN ANGLAIS, ultra détaillé pour GPT Image
  * format vertical 9:16 (1024x1536)
  * scène visuelle FORTE pour la niche (ex: plombier sous évier, garage, salon)
  * inclure smartphone avec notification SMS si pertinent
  * couleurs navy #13325b et lime #c8f135 en accent
  * photoréaliste, pub performance, pas de texte illisible dans l'image
  * objectif visuel : {objectif}
- prompt_video_motion : EN ANGLAIS, 1-2 phrases pour Runway (mouvement caméra lent, notification pulse, ambiance pub TikTok verticale)
"""
    return [
        {
            "role": "system",
            "content": (
                "Tu es un directeur créatif pub performance pour PME québécoises. "
                "Tu produis des concepts prêts à devenir une vidéo verticale 30 s. "
                "Réponds UNIQUEMENT en JSON valide selon le schéma."
            ),
        },
        {"role": "user", "content": user},
    ]


def generate_ad_concept(
    niche: str,
    produit: str,
    objectif: str,
    plateforme: str = "TikTok",
    *,
    model: str | None = None,
) -> dict[str, Any]:
    """Génère le concept publicitaire (texte + prompt image)."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "OPENAI_API_KEY manquante. Créez noviaai-site/secrets/openai.env"
        )

    model = model or DEFAULT_MODEL
    payload = {
        "model": model,
        "messages": build_messages(niche, produit, objectif, plateforme),
        "temperature": 0.85,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "publicite_sociale",
                "strict": True,
                "schema": AD_JSON_SCHEMA,
            },
        },
    }

    r = requests.post(
        OPENAI_URL,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=payload,
        timeout=120,
    )
    if r.status_code != 200:
        raise RuntimeError(f"OpenAI API erreur {r.status_code}: {r.text[:500]}")

    data = json.loads(r.json()["choices"][0]["message"]["content"])
    data["meta"] = {
        "niche": niche,
        "produit": produit,
        "objectif": objectif,
        "plateforme": plateforme,
        "model": model,
    }
    return data


# Alias rétrocompat
def generate_ad(niche: str, produit: str, plateforme: str, *, model: str | None = None) -> dict[str, Any]:
    return generate_ad_concept(
        niche,
        produit,
        "Convertir les appels manqués en clients payants",
        plateforme,
        model=model,
    )
