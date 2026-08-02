"""
Chargeur de la base de données frameworks NoviaAI.

Source canonique : frameworks/ad_frameworks_db.json
Regénérer : python build_framework_db.py

Usage IA / pipeline :
    from framework_db import load_db, get_framework, ai_generation_context

    ctx = ai_generation_context("pas_classic", niche="plombier")
    # → prompt structuré pour OpenAI storyboard generator
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "frameworks" / "ad_frameworks_db.json"


@lru_cache(maxsize=1)
def load_db() -> dict[str, Any]:
    if not DB_PATH.exists():
        raise FileNotFoundError(
            f"Base frameworks manquante: {DB_PATH}\n"
            "Exécutez: python build_framework_db.py"
        )
    return json.loads(DB_PATH.read_text(encoding="utf-8"))


def list_frameworks() -> list[dict[str, Any]]:
    db = load_db()
    return [
        {
            "id": fid,
            "name": fw["name"],
            "aliases": fw.get("aliases", []),
            "psychological_objective": fw["psychological_objective"],
            "scene_count": fw["scene_count"],
            "target_client": fw["target_client"]["profile"],
            "tags": fw.get("tags", []),
        }
        for fid, fw in db["frameworks"].items()
    ]


# Rétrocompat IDs anciens → nouveaux
_ID_ALIASES = {
    "bab_transformation": "bab_avant_apres",
    "stat_shock_ghl": "product_demo",
    "hso_hook_story_offer": "customer_story",
    "objection_crusher": "objection_response",
    "social_proof_micro": "social_proof",
    "aida_compact": "pas_classic",  # fallback proche
}


def get_framework(framework_id: str) -> dict[str, Any]:
    db = load_db()
    fid = _ID_ALIASES.get(framework_id, framework_id)
    fw = db["frameworks"].get(fid)
    if not fw:
        ids = ", ".join(db["frameworks"])
        raise KeyError(f"Framework '{framework_id}' inconnu. Disponibles: {ids}")
    return fw


def get_niche_vars(niche: str) -> dict[str, str]:
    db = load_db()
    return dict(db["niche_defaults"].get(niche.lower(), db["niche_defaults"]["plombier"]))


def _substitute(text: str, vars_: dict[str, str]) -> str:
    for k, v in vars_.items():
        text = text.replace("{" + k + "}", str(v))
    return text


def resolve_framework(framework_id: str, niche: str) -> dict[str, Any]:
    """Framework avec templates résolus pour une niche."""
    fw = get_framework(framework_id).copy()
    vars_ = get_niche_vars(niche)
    hook_ex = fw["hook_3s"].get("examples_by_niche", {})
    vars_["hook_question"] = hook_ex.get(niche.lower(), hook_ex.get("plombier", ""))
    vars_["hook_voix"] = vars_["hook_question"]
    vars_["avant_apres"] = "sans"  # pour templates BAB

    fw["hook_3s_resolved"] = {
        **fw["hook_3s"],
        "text_fr": _substitute(fw["hook_3s"].get("template_fr", ""), vars_),
        "example_fr": hook_ex.get(niche.lower(), ""),
    }

    resolved_scenes = []
    for s in fw["scenes"]:
        rs = dict(s)
        rs["texte_ecran"] = _substitute(s["texte_ecran_template"], vars_)
        rs["voix_off"] = _substitute(s["voix_off_template"], vars_)
        resolved_scenes.append(rs)
    fw["scenes_resolved"] = resolved_scenes
    fw["niche"] = niche.lower()
    return fw


def recommend_framework(
    niche: str,
    *,
    traffic: str = "cold",
    goal: str = "demo",
    has_stats: bool = False,
) -> str:
    db = load_db()
    m = db["recommendation_matrix"]
    if traffic == "retargeting":
        return m["retargeting"]
    if goal == "roi":
        return m["roi_focus"]
    if has_stats:
        return m["has_client_stats"]
    if traffic == "cold" and niche.lower() in ("plombier", "electricien"):
        return m["cold_urgent"]
    if niche.lower() in ("salon", "coiffure"):
        return m["aspiration"]
    if traffic == "cold":
        return m["cold_distracted"]
    return m["cold_urgent"]


def ai_generation_context(
    framework_id: str,
    niche: str,
    *,
    objectif: str = "Obtenir des démonstrations avec propriétaires de PME",
    plateforme: str = "facebook",
) -> dict[str, Any]:
    """
    Contexte structuré pour qu'une IA génère storyboard / script / prompts.
    Format stable — ne pas modifier sans bump schema_version.
    """
    fw = resolve_framework(framework_id, niche)
    db = load_db()

    return {
        "schema_version": db["schema_version"],
        "task": "generate_storyboard_30s",
        "product": db["product"],
        "framework": {
            "id": fw["id"],
            "name": fw["name"],
            "psychological_objective": fw["psychological_objective"],
            "noviaai_adaptation": fw["noviaai_adaptation"],
            "proof_strategy": fw["proof_strategy"],
        },
        "campaign": {
            "niche": niche,
            "objectif": objectif,
            "plateforme": plateforme,
            "format": "9:16 vertical, 30 secondes",
            "language": "fr-CA",
            "style": "GoHighLevel — réaliste, pro, émotionnel, pas de face cam",
        },
        "target_client": fw["target_client"],
        "hook_3s": fw["hook_3s_resolved"],
        "scene_count": fw["scene_count"],
        "scenes": fw["scenes_resolved"],
        "cta": {
            **fw["cta"],
            "url": fw["cta"]["url_template"].format(
                platform=plateforme, niche=niche, framework=framework_id
            ),
        },
        "output_requirements": {
            "scenes_count": fw["scene_count"],
            "total_duration_s": 30,
            "each_scene_fields": [
                "numero", "timing", "role", "scene_type", "asset",
                "description_visuelle", "objectif_emotionnel", "texte_ecran",
                "voix_off", "prompt_image", "prompt_runway",
            ],
            "prompt_image_lang": "en",
            "prompt_runway_lang": "en",
            "brand_colors": db["product"]["brand_colors"],
        },
    }


def ai_generation_prompt(framework_id: str, niche: str, **kwargs: Any) -> str:
    """Prompt texte prêt pour OpenAI à partir du contexte structuré."""
    ctx = ai_generation_context(framework_id, niche, **kwargs)
    lines = [
        f"# Génération pub 30s — {ctx['framework']['name']}",
        f"Niche: {niche} | Objectif: {ctx['campaign']['objectif']}",
        f"Objectif psychologique: {ctx['framework']['psychological_objective']}",
        f"Adaptation NoviaAI: {ctx['framework']['noviaai_adaptation']}",
        f"Stratégie preuve: {ctx['framework']['proof_strategy']}",
        "",
        f"## Hook 3 secondes ({ctx['hook_3s']['type']})",
        ctx["hook_3s"]["text_fr"] or ctx["hook_3s"]["example_fr"],
        f"Visuel: {ctx['hook_3s']['visual']}",
        "",
        f"## Structure — {ctx['scene_count']} scènes / 30s",
    ]
    for s in ctx["scenes"]:
        lines += [
            f"### Scène {s['number']} ({s['timing']}) — {s['role']}",
            f"- Type: {s['scene_type']} | Asset: {s['asset']}",
            f"- Description: {s['description']}",
            f"- Émotion: {s['emotion']}",
            f"- Preuve: {s.get('proof_type') or '—'}",
            f"- Texte écran: {s['texte_ecran']}",
            f"- Voix-off: {s['voix_off']}",
            "",
        ]
    cta = ctx["cta"]
    lines += [
        "## CTA",
        f"- Primary: {cta['primary']}",
        f"- Secondary: {cta['secondary']}",
        f"- URL: {cta['url']}",
        "",
        "Génère le storyboard JSON complet conforme à cette structure.",
    ]
    return "\n".join(lines)


def validate_storyboard(storyboard: dict) -> list[str]:
    """Valide qu'un storyboard respecte le framework déclaré."""
    errors: list[str] = []
    fid = storyboard.get("framework_id")
    if not fid:
        return ["framework_id manquant"]
    try:
        fw = get_framework(fid)
    except KeyError as e:
        return [str(e)]

    scenes = storyboard.get("scenes", [])
    if len(scenes) != fw["scene_count"]:
        errors.append(f"Attendu {fw['scene_count']} scènes, reçu {len(scenes)}")

    total = 0.0
    for s in scenes:
        timing = s.get("timing", "")
        m = re.match(r"(\d+)-(\d+)s?", timing)
        if m:
            total = max(total, float(m.group(2)))

    if abs(total - 30.0) > 1.0:
        errors.append(f"Durée totale ~{total}s, attendu 30s")

    return errors
