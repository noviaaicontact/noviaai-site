#!/usr/bin/env python3
"""
Pipeline de production pub vidéo NoviaAI — étape créative complète.

Entrée  : niche + problème + objectif
Sortie  : dossier de production (script, storyboard, prompts, ordre montage)

Sans génération image/vidéo — uniquement le brief créatif structuré.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from framework_db import ai_generation_context, ai_generation_prompt
from framework_selector import AdPlan, select_ad_plan

ROOT = Path(__file__).resolve().parent
PRODUCTION_ROOT = ROOT / "output" / "production"

STORYBOARD_SCHEMA = {
    "type": "object",
    "properties": {
        "titre_pub": {"type": "string"},
        "hook": {
            "type": "string",
            "description": "Accroche 3 premières secondes — 1-2 phrases percutantes FR",
        },
        "angle_marketing": {"type": "string"},
        "script_30s": {
            "type": "string",
            "description": "Script voix-off complet ~85-100 mots, FR québécois, segments [0-3s] etc.",
        },
        "voix_off_complete": {
            "type": "string",
            "description": "Identique à script_30s — narration fluide sans marqueurs timing",
        },
        "musique_suggestion": {"type": "string"},
        "scenes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "numero": {"type": "integer"},
                    "timing": {"type": "string"},
                    "role": {"type": "string"},
                    "scene_type": {"type": "string"},
                    "asset": {"type": "string"},
                    "titre": {"type": "string"},
                    "description_visuelle": {"type": "string"},
                    "objectif_emotionnel": {"type": "string"},
                    "texte_ecran": {"type": "string"},
                    "voix_off": {"type": "string"},
                    "prompt_image": {"type": "string"},
                    "prompt_video": {"type": "string"},
                    "notes_montage": {
                        "type": "string",
                        "description": "Instructions montage : asset source, durée, transition",
                    },
                },
                "required": [
                    "numero", "timing", "role", "scene_type", "asset",
                    "titre", "description_visuelle", "objectif_emotionnel",
                    "texte_ecran", "voix_off", "prompt_image", "prompt_video",
                    "notes_montage",
                ],
                "additionalProperties": False,
            },
        },
        "textes_ecran_recap": {"type": "array", "items": {"type": "string"}},
        "cta_final": {"type": "string"},
        "description_reseaux": {"type": "string"},
    },
    "required": [
        "titre_pub", "hook", "angle_marketing", "script_30s", "voix_off_complete",
        "musique_suggestion", "scenes", "textes_ecran_recap", "cta_final",
        "description_reseaux",
    ],
    "additionalProperties": False,
}


def _slug(s: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "_", s.lower().strip())
    return out.strip("_") or "pub"


def _generate_storyboard_creative(
    plan: AdPlan,
    *,
    model: str | None = None,
) -> dict[str, Any]:
    """Appel OpenAI — storyboard complet à partir du plan framework."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY manquante (secrets/openai.env)")

    ctx = ai_generation_context(plan.framework_id, plan.niche, objectif=plan.objectif)
    plan_block = plan.format_text()

    user_prompt = f"""Brief campagne NoviaAI :

Niche       : {plan.niche}
Objectif    : {plan.objectif}
Problème    : {plan.probleme}
Framework   : {plan.framework_name} ({plan.framework_id})

Plan pré-sélectionné (structure obligatoire — 5 scènes, 30s total) :
{plan_block}

Produit NoviaAI :
- Appel manqué → texto automatique ~8 secondes
- Agent IA qualification SMS + RDV
- Dashboard inbox/stats
- Essai 14 jours · noviaai.ca
- Couleurs : navy #13325b, lime #c8f135
- Style GoHighLevel : réaliste, pro, pas de face cam fondateur

Génère le storyboard JSON complet.

Règles strictes :
- Exactement 5 scènes, timings du framework ({', '.join(s.timing for s in plan.scenes)})
- hook = accroche 3 premières secondes (FR québécois, percutant)
- script_30s = voix-off segmentée [0-3s], [3-10s], etc.
- voix_off_complete = même contenu, narration fluide continue
- prompt_image EN ANGLAIS, vertical 9:16, photorealistic ad
- prompt_video EN ANGLAIS, camera motion 5s max
- Si asset=sms_mockup : prompt_image="Playwright capture SMS NoviaAI", prompt_video="N/A — Playwright"
- Si asset=dashboard : prompt_image="Playwright dashboard mobile", prompt_video="N/A — Playwright"
- Si asset=stat ou cta : prompt_image="N/A — MoviePy", prompt_video="N/A — MoviePy"
- notes_montage = instruction concrète pour l'assembleur (source, durée, overlay texte)
- texte_ecran et voix_off en FR québécois
"""

    payload = {
        "model": model or os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        "temperature": 0.72,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Directeur créatif pub performance B2B SaaS pour PME québécoises. "
                    "JSON strict selon schéma. Qualité GoHighLevel."
                ),
            },
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "production_storyboard",
                "strict": True,
                "schema": STORYBOARD_SCHEMA,
            },
        },
    }

    r = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=payload,
        timeout=180,
    )
    if r.status_code != 200:
        raise RuntimeError(f"OpenAI {r.status_code}: {r.text[:500]}")

    data = json.loads(r.json()["choices"][0]["message"]["content"])

    # Normaliser prompt_runway → prompt_video si legacy
    for s in data.get("scenes", []):
        if "prompt_runway" in s and "prompt_video" not in s:
            s["prompt_video"] = s.pop("prompt_runway")

    return data


def _build_montage_order(storyboard: dict, plan: AdPlan) -> list[dict[str, Any]]:
    """Ordre de montage dérivé des scènes."""
    order = []
    for i, scene in enumerate(storyboard.get("scenes", [])):
        plan_scene = plan.scenes[i] if i < len(plan.scenes) else None
        order.append({
            "ordre": scene["numero"],
            "timing": scene["timing"],
            "titre": scene.get("titre", ""),
            "asset": scene.get("asset", plan_scene.asset if plan_scene else "runway"),
            "scene_type": scene.get("scene_type", ""),
            "duree_estimee_s": _parse_duration(scene.get("timing", "")),
            "texte_overlay": scene.get("texte_ecran", ""),
            "voix_off_segment": scene.get("voix_off", ""),
            "source_production": _asset_source_hint(scene.get("asset", "")),
            "notes": scene.get("notes_montage", ""),
            "transition": "cut" if i > 0 else "fade_in",
        })
    return order


def _parse_duration(timing: str) -> float:
    m = re.match(r"(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)", timing.replace("s", ""))
    if m:
        return float(m.group(2)) - float(m.group(1))
    return 0.0


def _asset_source_hint(asset: str) -> str:
    hints = {
        "runway": "Runway image-to-video OU Pexels b-roll + Ken Burns",
        "sms_mockup": "Playwright — clips/local/sms_novia_{niche}_01.mp4",
        "dashboard": "Playwright — scripts/demo-missed-call-video.mjs",
        "stat": "MoviePy — ghl_compositor.stat_clip",
        "cta": "MoviePy — ghl_compositor.cta_clip",
    }
    return hints.get(asset, "À déterminer")


def _write_production_folder(
    folder: Path,
    plan: AdPlan,
    storyboard: dict,
    montage: list[dict],
) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    scenes_dir = folder / "scenes"
    prompts_dir = folder / "prompts"
    scenes_dir.mkdir(exist_ok=True)
    prompts_dir.mkdir(exist_ok=True)

    brief = {
        "niche": plan.niche,
        "probleme": plan.probleme,
        "objectif": plan.objectif,
        "framework_id": plan.framework_id,
        "framework_name": plan.framework_name,
        "psychological_objective": plan.psychological_objective,
        "selection_reasons": plan.selection_reasons,
        "hook_plan": plan.hook_3s,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    (folder / "01_brief.json").write_text(
        json.dumps(brief, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    hook = storyboard.get("hook", plan.hook_3s)
    (folder / "02_hook.txt").write_text(hook.strip() + "\n", encoding="utf-8")

    script = storyboard.get("script_30s") or storyboard.get("voix_off_complete", "")
    (folder / "03_script_voix_off.txt").write_text(script.strip() + "\n", encoding="utf-8")

    voix_fluide = storyboard.get("voix_off_complete", script)
    (folder / "03b_voix_off_fluide.txt").write_text(voix_fluide.strip() + "\n", encoding="utf-8")

    textes_lines = ["# Textes à l'écran — pub 30s\n"]
    for i, t in enumerate(storyboard.get("textes_ecran_recap", []), 1):
        textes_lines.append(f"{i}. {t}")
    for s in storyboard.get("scenes", []):
        textes_lines.append(f"\n[Scène {s['numero']} — {s['timing']}]")
        textes_lines.append(s.get("texte_ecran", ""))
    (folder / "04_textes_ecran.txt").write_text("\n".join(textes_lines) + "\n", encoding="utf-8")

    montage_payload = {
        "format": "1080x1920 vertical, 30 fps, H.264",
        "duree_totale_s": 30,
        "musique": storyboard.get("musique_suggestion", ""),
        "sequence": montage,
    }
    (folder / "05_ordre_montage.json").write_text(
        json.dumps(montage_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    img_lines = ["# Prompts image (GPT Image / DALL-E) — EN\n"]
    vid_lines = ["# Prompts vidéo (Runway / b-roll) — EN\n"]
    for s in storyboard.get("scenes", []):
        n = s["numero"]
        img_lines += [
            f"## Scène {n} — {s.get('titre', '')} ({s.get('timing', '')})",
            f"Asset: {s.get('asset', '?')}",
            s.get("prompt_image", ""),
            "",
        ]
        vid_lines += [
            f"## Scène {n} — {s.get('titre', '')} ({s.get('timing', '')})",
            f"Asset: {s.get('asset', '?')}",
            s.get("prompt_video", s.get("prompt_runway", "")),
            "",
        ]
        scene_file = scenes_dir / f"scene_{n:02d}.json"
        scene_file.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")

    (prompts_dir / "prompts_images.txt").write_text("\n".join(img_lines), encoding="utf-8")
    (prompts_dir / "prompts_video.txt").write_text("\n".join(vid_lines), encoding="utf-8")

    production = {
        "version": "1.0",
        "brief": brief,
        "titre_pub": storyboard.get("titre_pub"),
        "hook": hook,
        "angle_marketing": storyboard.get("angle_marketing"),
        "script_30s": script,
        "voix_off_complete": voix_fluide,
        "musique_suggestion": storyboard.get("musique_suggestion"),
        "scenes": storyboard.get("scenes"),
        "textes_ecran_recap": storyboard.get("textes_ecran_recap"),
        "cta_final": storyboard.get("cta_final"),
        "description_reseaux": storyboard.get("description_reseaux"),
        "ordre_montage": montage_payload,
    }
    (folder / "PRODUCTION.json").write_text(
        json.dumps(production, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    readme = _format_readme(plan, storyboard, montage, folder)
    (folder / "README.md").write_text(readme, encoding="utf-8")

    latest = PRODUCTION_ROOT / f"{_slug(plan.niche)}_LATEST"
    if latest.is_symlink() or latest.exists():
        if latest.is_symlink():
            latest.unlink()
        elif latest.is_dir():
            import shutil
            shutil.rmtree(latest, ignore_errors=True)
    try:
        latest.symlink_to(folder.name, target_is_directory=True)
    except OSError:
        import shutil
        if latest.exists():
            shutil.rmtree(latest)
        shutil.copytree(folder, latest)


def _format_readme(
    plan: AdPlan,
    storyboard: dict,
    montage: list[dict],
    folder: Path,
) -> str:
    lines = [
        f"# Dossier de production — {storyboard.get('titre_pub', 'Pub NoviaAI')}",
        "",
        "## Entrée",
        f"- **Niche :** {plan.niche}",
        f"- **Problème :** {plan.probleme}",
        f"- **Objectif :** {plan.objectif}",
        "",
        "## Framework choisi",
        f"**{plan.framework_name}** (`{plan.framework_id}`)",
        "",
        plan.psychological_objective,
        "",
        "### Pourquoi ce framework",
    ]
    for r in plan.selection_reasons:
        lines.append(f"- {r}")

    lines += [
        "",
        "## Hook (3 sec)",
        storyboard.get("hook", plan.hook_3s),
        "",
        "## Script voix-off (30 s)",
        "```",
        storyboard.get("script_30s", ""),
        "```",
        "",
        "## Storyboard — 5 scènes",
        "",
    ]
    for s in storyboard.get("scenes", []):
        lines += [
            f"### Scène {s['numero']} — {s.get('titre', '')} ({s.get('timing', '')})",
            f"- **Rôle :** {s.get('role', '')} · **Asset :** `{s.get('asset', '')}`",
            f"- **Visuel :** {s.get('description_visuelle', '')}",
            f"- **Texte écran :** {s.get('texte_ecran', '')}",
            f"- **Voix-off :** {s.get('voix_off', '')}",
            f"- **Montage :** {s.get('notes_montage', '')}",
            "",
        ]

    lines += [
        "## Ordre de montage",
        "",
        "| # | Timing | Asset | Texte overlay |",
        "|---|--------|-------|---------------|",
    ]
    for m in montage:
        lines.append(
            f"| {m['ordre']} | {m['timing']} | `{m['asset']}` | {m['texte_overlay'][:40]}… |"
        )

    lines += [
        "",
        "## Fichiers",
        "",
        "| Fichier | Contenu |",
        "|---------|---------|",
        "| `PRODUCTION.json` | Master — tout le dossier |",
        "| `01_brief.json` | Entrée + framework |",
        "| `02_hook.txt` | Accroche 3 sec |",
        "| `03_script_voix_off.txt` | Script segmenté |",
        "| `03b_voix_off_fluide.txt` | Narration continue |",
        "| `04_textes_ecran.txt` | Overlays vidéo |",
        "| `05_ordre_montage.json` | Séquence montage |",
        "| `scenes/scene_XX.json` | Détail par scène |",
        "| `prompts/prompts_images.txt` | Prompts GPT Image |",
        "| `prompts/prompts_video.txt` | Prompts Runway/b-roll |",
        "",
        f"*Généré le {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}*",
        f"*Dossier : `{folder.name}`*",
    ]
    return "\n".join(lines)


def run_production_pipeline(
    niche: str,
    objectif: str,
    probleme: str,
    *,
    traffic: str = "cold",
    framework_override: str | None = None,
) -> Path:
    """
    Pipeline complet — sélection framework + storyboard OpenAI + dossier production.

    Returns:
        Path du dossier de production créé.
    """
    niche = niche.strip()
    objectif = objectif.strip()
    probleme = (probleme or "appels manqués").strip()

    plan = select_ad_plan(
        niche, objectif, probleme,
        traffic=traffic,
        framework_override=framework_override,
    )

    storyboard = _generate_storyboard_creative(plan)
    montage = _build_montage_order(storyboard, plan)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    folder_name = f"{_slug(niche)}_{plan.framework_id}_{ts}"
    folder = PRODUCTION_ROOT / folder_name

    _write_production_folder(folder, plan, storyboard, montage)
    return folder
