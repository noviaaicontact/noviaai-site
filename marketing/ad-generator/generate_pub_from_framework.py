#!/usr/bin/env python3
"""Génère un storyboard 30s à partir d'un framework publicitaire + niche."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
PIPELINE = ROOT.parent / "video-pipeline"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(PIPELINE))

from framework_db import (  # noqa: E402
    ai_generation_context,
    ai_generation_prompt,
    get_framework as get_framework_db,
    list_frameworks as list_frameworks_db,
    load_db,
    recommend_framework as recommend_framework_db,
)
from framework_selector import select_ad_plan  # noqa: E402
from utils import load_secrets_into_env, setup_logging  # noqa: E402

log = setup_logging("framework_pub", "framework_pub.log")
OUTPUT = ROOT / "output"

SCHEMA = {
    "type": "object",
    "properties": {
        "framework_id": {"type": "string"},
        "framework_name": {"type": "string"},
        "niche": {"type": "string"},
        "titre_pub": {"type": "string"},
        "angle_marketing": {"type": "string"},
        "objectif": {"type": "string"},
        "format": {"type": "string"},
        "style": {"type": "string"},
        "voix_off_complete": {"type": "string"},
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
                    "prompt_runway": {"type": "string"},
                },
                "required": [
                    "numero", "timing", "role", "scene_type", "asset",
                    "titre", "description_visuelle", "objectif_emotionnel",
                    "texte_ecran", "voix_off", "prompt_image", "prompt_runway",
                ],
                "additionalProperties": False,
            },
        },
        "textes_ecran_recap": {"type": "array", "items": {"type": "string"}},
        "cta_final": {"type": "string"},
        "description_reseaux": {"type": "string"},
    },
    "required": [
        "framework_id", "framework_name", "niche", "titre_pub", "angle_marketing",
        "objectif", "format", "style", "voix_off_complete", "musique_suggestion",
        "scenes", "textes_ecran_recap", "cta_final", "description_reseaux",
    ],
    "additionalProperties": False,
}


def _generate_storyboard(
    framework_id: str,
    niche: str,
    objectif: str,
) -> dict:
    prompt = ai_generation_prompt(framework_id, niche, objectif=objectif)
    ctx = ai_generation_context(framework_id, niche, objectif=objectif)

    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY manquante")

    payload = {
        "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        "temperature": 0.7,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Directeur creatif pub performance B2B SaaS pour PME quebecoises. "
                    "Tu DOIS respecter le framework et les timings fournis. "
                    "prompt_image et prompt_runway en ANGLAIS. Textes ecran et voix-off en FR quebecois. "
                    "Pour asset=sms_mockup ou dashboard : prompt_runway = 'N/A — Playwright mockup'. "
                    "Pour asset=stat ou cta : prompt_image/runway = 'N/A — MoviePy compositor'."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "framework_storyboard",
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
    data = json.loads(r.json()["choices"][0]["message"]["content"])
    data["framework_id"] = framework_id
    data["framework_name"] = ctx["framework"]["name"]
    data["niche"] = niche
    return data


def _format_md(data: dict) -> str:
    lines = [
        f"# {data['titre_pub']}",
        "",
        f"**Framework :** {data.get('framework_name', data.get('framework_id', '?'))}",
        f"**Niche :** {data.get('niche', '?')}",
        f"**Angle :** {data['angle_marketing']}",
        "",
        "## Voix-off complète",
        data["voix_off_complete"],
        "",
        "---",
        "",
    ]
    for s in data["scenes"]:
        lines += [
            f"## Scène {s['numero']} — {s['titre']} ({s['timing']})",
            f"*{s.get('role', '')} · {s.get('scene_type', '')} · asset={s.get('asset', '?')}*",
            "",
            f"**Visuel :** {s['description_visuelle']}",
            f"**Texte écran :** « {s['texte_ecran']} »",
            f"**Voix-off :** {s['voix_off']}",
            "",
            "---",
            "",
        ]
    lines += [
        "## CTA",
        data["cta_final"],
        "",
        "## Description réseaux",
        data["description_reseaux"],
    ]
    return "\n".join(lines)


def save_storyboard(data: dict, niche: str, framework_id: str) -> Path:
    folder = OUTPUT / f"{niche}_{framework_id}"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "STORYBOARD_LATEST.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (folder / "STORYBOARD_LATEST.md").write_text(_format_md(data), encoding="utf-8")
    return folder


def _safe_print(text: str) -> None:
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode("ascii", errors="replace").decode("ascii"))


def cmd_list() -> int:
    _safe_print("\n=== Bibliotheque frameworks NoviaAI (12) ===\n")
    db = load_db()
    _safe_print(f"Source: {db['schema_version']} | {db['framework_count']} frameworks\n")
    for fw in list_frameworks_db():
        _safe_print(f"  [{fw['id']}] {fw['name']}")
        if fw.get("aliases"):
            _safe_print(f"      aliases: {', '.join(fw['aliases'])}")
        _safe_print(f"      -> {fw['psychological_objective'][:85]}...")
        _safe_print(f"      scenes: {fw['scene_count']} | cible: {fw['target_client'][:50]}...")
        _safe_print(f"      tags: {', '.join(fw['tags'])}")
        _safe_print("")
    return 0


def cmd_export() -> int:
    path = ROOT / "frameworks" / "ad_frameworks_db.json"
    if not path.exists():
        import build_framework_db

        build_framework_db.main()
    _safe_print(f"Base de donnees: {path}")
    _safe_print(f"Frameworks: {load_db()['framework_count']}")
    return 0


def cmd_recommend(niche: str, traffic: str, goal: str) -> int:
    fid = recommend_framework_db(niche, traffic=traffic, goal=goal)
    fw = get_framework_db(fid)
    _safe_print(f"Niche: {niche} | Trafic: {traffic} | Objectif: {goal}")
    _safe_print(f"Recommande: {fid} — {fw['name']}")
    _safe_print(f"Raison: {fw['psychological_objective']}")
    return 0


def main() -> int:
    load_secrets_into_env()
    ap = argparse.ArgumentParser(description="Génération pub NoviaAI par framework")
    sub = ap.add_subparsers(dest="cmd")

    sub.add_parser("list", help="Lister les frameworks")
    sub.add_parser("export", help="Exporter FRAMEWORKS.json")

    p_rec = sub.add_parser("recommend", help="Recommander un framework")
    p_rec.add_argument("--niche", default="plombier")
    p_rec.add_argument("--traffic", default="cold", choices=["cold", "warm", "retargeting"])
    p_rec.add_argument("--goal", default="demo", choices=["demo", "roi", "signup"])

    p_gen = sub.add_parser("generate", help="Générer storyboard depuis framework")
    p_gen.add_argument("--framework", "-f", help="ID framework (ex: pas_classic)")
    p_gen.add_argument("--niche", "-n", default="plombier", choices=["plombier", "garage", "salon", "electricien"])
    p_gen.add_argument("--probleme", "-p", default="", help="Probleme client (ex: appels manques)")
    p_gen.add_argument("--objectif", default="Obtenir des démos avec propriétaires de PME")
    p_gen.add_argument("--traffic", default="cold", choices=["cold", "warm", "retargeting"])
    p_gen.add_argument("--auto", action="store_true", help="Choisir framework automatiquement")
    p_gen.add_argument("--assemble", action="store_true", help="Lancer assemble_pub_30s après génération")
    p_gen.add_argument(
        "--allow-runway",
        action="store_true",
        help="APPROUVER Runway lors de l'assemblage video (consomme des credits)",
    )

    args = ap.parse_args()
    if args.cmd == "list":
        return cmd_list()
    if args.cmd == "export":
        return cmd_export()
    if args.cmd == "recommend":
        return cmd_recommend(args.niche, args.traffic, args.goal)
    if args.cmd == "generate":
        fid = args.framework
        if args.auto or not fid:
            plan = select_ad_plan(
                args.niche, args.objectif, args.probleme or "",
                traffic=args.traffic,
            )
            fid = plan.framework_id
            log.info("Framework auto (selector): %s — %s", fid, plan.framework_name)
            _safe_print(plan.format_text())
            _safe_print("")
        log.info("Generation %s / %s…", fid, args.niche)
        data = _generate_storyboard(fid, args.niche, args.objectif)
        folder = save_storyboard(data, args.niche, fid)
        print(_format_md(data))
        print(f"\nSauvegardé : {folder / 'STORYBOARD_LATEST.json'}")
        if args.assemble:
            import assemble_pub_30s as asm
            from runway_guard import grant_runway_approval

            if args.allow_runway:
                grant_runway_approval()

            asm.OUT_DIR = folder
            asm.STORYBOARD = folder / "STORYBOARD_LATEST.json"
            asm.SMS_CLIP = asm.LOCAL_CLIPS_DIR / f"sms_novia_{args.niche if args.niche != 'electricien' else 'electro'}_01.mp4"
            if not asm.SMS_CLIP.exists():
                asm.SMS_CLIP = asm.LOCAL_CLIPS_DIR / "sms_novia_plombier_01.mp4"
            asm.build_pub_30s(skip_runway=not args.allow_runway)
        return 0

    ap.print_help()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log.exception("Echec: %s", e)
        sys.exit(1)
