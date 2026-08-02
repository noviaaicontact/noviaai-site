#!/usr/bin/env python3
"""CLI — Sélection automatique framework + plan pub 30s."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from framework_selector import AdPlan, save_plan, score_frameworks, select_ad_plan  # noqa: E402


def _safe_print(text: str) -> None:
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode("ascii", errors="replace").decode("ascii"))


def cmd_select(args: argparse.Namespace) -> int:
    plan = select_ad_plan(
        args.niche,
        args.objectif,
        args.probleme or "",
        traffic=args.traffic,
        has_stats=args.has_stats,
        framework_override=args.framework,
    )
    _safe_print(plan.format_text())
    if args.save:
        folder = save_plan(plan)
        _safe_print(f"\nSauvegarde : {folder / 'AD_PLAN_LATEST.json'}")
    if args.json:
        _safe_print("\n--- JSON ---")
        _safe_print(json.dumps(plan.to_dict(), ensure_ascii=False, indent=2))
    return 0


def cmd_rank(args: argparse.Namespace) -> int:
    rankings = score_frameworks(
        args.niche, args.objectif, args.probleme or "",
        traffic=args.traffic, has_stats=args.has_stats,
    )
    _safe_print(f"\nClassement frameworks — {args.niche} / {args.objectif}\n")
    for i, r in enumerate(rankings, 1):
        _safe_print(f"{i:2}. [{r.score:5.1f}] {r.name} ({r.framework_id})")
        for reason in r.reasons[:4]:
            _safe_print(f"      {reason}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Moteur marketing NoviaAI — selection auto de framework publicitaire",
    )
    sub = ap.add_subparsers(dest="cmd")

    p_sel = sub.add_parser("select", help="Choisir framework + generer plan 30s")
    p_sel.add_argument("--niche", "-n", required=True, help="Ex: plombier, garage, salon")
    p_sel.add_argument("--objectif", "-o", required=True, help="Ex: obtenir des demos")
    p_sel.add_argument("--probleme", "-p", default="", help="Ex: appels manques")
    p_sel.add_argument("--traffic", default="cold", choices=["cold", "warm", "retargeting"])
    p_sel.add_argument("--has-stats", action="store_true", help="Stats clients disponibles")
    p_sel.add_argument("--framework", "-f", help="Forcer un framework (skip auto)")
    p_sel.add_argument("--save", "-s", action="store_true", help="Sauvegarder JSON + TXT")
    p_sel.add_argument("--json", action="store_true", help="Afficher JSON complet")
    p_sel.set_defaults(func=cmd_select)

    p_rank = sub.add_parser("rank", help="Classer tous les frameworks par score")
    p_rank.add_argument("--niche", "-n", required=True)
    p_rank.add_argument("--objectif", "-o", required=True)
    p_rank.add_argument("--probleme", "-p", default="")
    p_rank.add_argument("--traffic", default="cold", choices=["cold", "warm", "retargeting"])
    p_rank.add_argument("--has-stats", action="store_true")
    p_rank.set_defaults(func=cmd_rank)

    args = ap.parse_args()
    if not args.cmd:
        ap.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
