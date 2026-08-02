"""
Sélecteur automatique de framework publicitaire NoviaAI.

Entrée : niche + objectif marketing + problème (+ options campagne)
Sortie : framework choisi + plan de pub 30s (5 scènes) prêt pour génération IA

Usage :
    from framework_selector import select_ad_plan

    plan = select_ad_plan(
        niche="plombier",
        objectif="obtenir des démos",
        probleme="appels manqués",
    )
    print(plan.format_text())
"""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from framework_db import get_framework, load_db, resolve_framework

ROOT = Path(__file__).resolve().parent

# ─── Normalisation texte ───────────────────────────────────────────────────────

def _norm(text: str) -> str:
    t = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in t if not unicodedata.combining(c))


# ─── Signaux d'entrée ──────────────────────────────────────────────────────────

PROBLEM_SIGNALS: dict[str, list[str]] = {
    "appels_manques": [
        "appel manque", "appels manques", "decrocher", "repondre assez vite",
        "personne ne repond", "telephone sonne", "occupe en job",
    ],
    "clients_perdus": [
        "client perdu", "clients perdus", "concurrent", "part ailleurs", "raccroche",
    ],
    "revenus": [
        "revenu", "argent", "perte", "cout", "coût", "roi", "rentabil", "dollar",
    ],
    "horaire_trou": [
        "horaire", "agenda", "creneau", "rdv", "rendez-vous", "trou", "remplir",
    ],
    "surcharge": [
        "debord", "stress", "chaos", "trop occupe", "pas le temps", "surcharge",
    ],
    "objection_ia": [
        "ia", "robot", "confiance", "peur", "complexe", "outil de plus",
    ],
    "reponse_lente": [
        "lent", "lenteur", "8 sec", "secondes", "attend", "delai", "délai",
    ],
}

GOAL_SIGNALS: dict[str, list[str]] = {
    "demo": ["demo", "démonstration", "demonstration", "demos", "démos", "montrer"],
    "signup": ["inscription", "essai", "signup", "inscrire", "compte", "gratuit"],
    "roi": ["roi", "rentabil", "retour", "investissement", "calcul"],
    "notoriete": ["notoriete", "notoriété", "marque", "awareness", "decouvrir"],
    "conversion": ["convertir", "conversion", "client payant", "booker", "book"],
}

NICHE_PROFILES: dict[str, dict[str, Any]] = {
    "plombier": {"urgency": "high", "style": "urgent", "metier_label": "plombier"},
    "electricien": {"urgency": "high", "style": "urgent", "metier_label": "électricien"},
    "garage": {"urgency": "medium", "style": "rational", "metier_label": "garage mécanique"},
    "salon": {"urgency": "low", "style": "aspiration", "metier_label": "salon de coiffure"},
    "coiffure": {"urgency": "low", "style": "aspiration", "metier_label": "salon de coiffure"},
    "clinique": {"urgency": "medium", "style": "aspiration", "metier_label": "clinique"},
}

# Score framework selon signaux (framework_id → règles)
FRAMEWORK_SCORE_RULES: dict[str, dict[str, float]] = {
    "pas_classic": {
        "appels_manques": 10, "clients_perdus": 8, "demo": 6, "conversion": 5,
        "niche_urgent": 5,
    },
    "bab_avant_apres": {
        "surcharge": 8, "horaire_trou": 6, "niche_aspiration": 8, "demo": 4,
    },
    "customer_story": {
        "clients_perdus": 7, "appels_manques": 5, "notoriete": 5, "conversion": 4,
    },
    "product_demo": {
        "demo": 9, "signup": 6, "reponse_lente": 5, "traffic_warm": 6,
    },
    "common_mistake": {
        "appels_manques": 6, "notoriete": 6, "clients_perdus": 5,
    },
    "transformation": {
        "surcharge": 7, "niche_aspiration": 7, "conversion": 5,
    },
    "comparison": {
        "demo": 5, "roi": 5, "conversion": 6, "traffic_warm": 4,
    },
    "day_in_life": {
        "surcharge": 6, "niche_aspiration": 6, "horaire_trou": 5,
    },
    "objection_response": {
        "objection_ia": 10, "traffic_retargeting": 10, "demo": 4,
    },
    "irresistible_offer": {
        "signup": 9, "demo": 7, "traffic_retargeting": 6,
    },
    "lost_revenue": {
        "revenus": 10, "roi": 9, "appels_manques": 5, "traffic_warm": 4,
    },
    "social_proof": {
        "conversion": 6, "demo": 5, "has_stats": 10,
    },
}

# Résumés scène plain-language (framework × niche) — sortie utilisateur
SCENE_PLAIN: dict[str, dict[str, list[str]]] = {
    "pas_classic": {
        "plombier": [
            "Plombier occupé en intervention, téléphone qui sonne — impossible de décrocher.",
            "Client attend une réponse : appel manqué, il contacte un concurrent.",
            "NoviaAI envoie un texto en 8 sec et collecte les infos (urgence, adresse, disponibilités).",
            "Résumé qualifié + RDV confirmé envoyé au plombier pendant qu'il travaille.",
            "Appel à l'action : demandez votre démo gratuite NoviaAI.",
        ],
        "garage": [
            "Mécanicien sous le capot, téléphone qui vibre — mains occupées.",
            "Client attend une réponse pour ses freins — appel manqué, il part.",
            "NoviaAI qualifie la demande par SMS (problème, véhicule, urgence).",
            "Résumé + RDV mécanique confirmé dans le dashboard du garage.",
            "Appel à l'action : essai gratuit 14 jours — noviaai.ca",
        ],
        "salon": [
            "Coiffeuse en pleine coloration, téléphone qui sonne — mains occupées.",
            "Cliente attend une réponse pour un créneau samedi — elle appelle ailleurs.",
            "NoviaAI propose les disponibilités et collecte les préférences par SMS.",
            "Nouvelle cliente confirmée — résumé envoyé à la coiffeuse.",
            "Appel à l'action : démo gratuite pour salons — essai 14 jours.",
        ],
        "electricien": [
            "Électricien au panneau, téléphone qui sonne — impossible de répondre.",
            "Client avec panne urgente — appel manqué, il cherche ailleurs.",
            "NoviaAI collecte nature de la panne, adresse et urgence par texto.",
            "Résumé + RDV confirmé pendant que l'électricien termine son job.",
            "Appel à l'action : démonstration gratuite NoviaAI.",
        ],
    },
    "bab_avant_apres": {
        "plombier": [
            "AVANT : journée chaos — appels manqués, stress, clients perdus.",
            "APRÈS (aperçu) : même plombier serein, focus sur son métier.",
            "Le pont : NoviaAI répond par SMS et book les urgences automatiquement.",
            "Preuve : +4 urgences bookées cette semaine.",
            "Appel à l'action : passez de l'avant à l'après — démo gratuite.",
        ],
        "garage": [
            "AVANT : horaire troué, appels sans réponse.",
            "APRÈS : agenda rempli, mécanicien concentré sur les réparations.",
            "Le pont : qualification auto par SMS NoviaAI.",
            "Preuve : +6 RDV qualifiés cette semaine.",
            "Appel à l'action : essai 14 jours.",
        ],
        "salon": [
            "AVANT : samedi chaotique, clientes perdues.",
            "APRÈS : samedi serein, créneaux remplis à l'avance.",
            "Le pont : NoviaAI book les RDV par SMS pendant la coupe.",
            "Preuve : agenda plein sans décrocher.",
            "Appel à l'action : démo salon gratuite.",
        ],
    },
    "product_demo": {
        "plombier": [
            "Stat choc : 60% des clients ne rappellent jamais.",
            "Plombier en job — contexte appel manqué.",
            "DÉMO : conversation SMS NoviaAI en direct (texto 8 sec + qualification).",
            "DÉMO : dashboard mobile — inbox, RDV, stats.",
            "Appel à l'action : essai gratuit 14 jours.",
        ],
        "garage": [
            "Stat : 8 secondes — temps max avant qu'un client parte.",
            "Garage occupé — appel manqué.",
            "DÉMO SMS NoviaAI : qualification freins/pneus.",
            "DÉMO dashboard : RDV qualifiés en un coup d'œil.",
            "Appel à l'action : noviaai.ca",
        ],
        "salon": [
            "Stat : 3 clientes perdues par semaine en moyenne.",
            "Salon occupé samedi — impossible de répondre.",
            "DÉMO SMS : créneaux proposés automatiquement.",
            "DÉMO dashboard : clientes et RDV centralisés.",
            "Appel à l'action : essai 14 jours gratuit.",
        ],
    },
    "customer_story": {
        "plombier": [
            "Accroche : votre téléphone vous coûte des urgences à 500$.",
            "Marc a une fuite — 3 appels, personne ne répond, il part.",
            "Avec NoviaAI : texto en 8 sec, questions qualification, proposition RDV.",
            "Marc booké demain 8h — plombier toujours sous l'évier.",
            "Appel à l'action : démo gratuite.",
        ],
        "garage": [
            "Un client freins bruyants — parti en 30 secondes sans réponse.",
            "Histoire : il appelle le garage voisin.",
            "NoviaAI l'aurait rattrapé par SMS en 8 sec.",
            "RDV confirmé le lendemain.",
            "Appel à l'action : essai 14 jours.",
        ],
        "salon": [
            "Julie veut une coupe samedi — personne ne répond.",
            "Elle réserve au salon d'à côté.",
            "NoviaAI aurait proposé un créneau par SMS instantanément.",
            "Julie confirmée — coiffeuse jamais interrompue.",
            "Appel à l'action : démo salon.",
        ],
    },
    "common_mistake": {
        "plombier": [
            "Erreur #1 : rappeler seulement le soir au lieu de répondre tout de suite.",
            "60% des clients ne laissent jamais de message vocal.",
            "Bonne pratique : NoviaAI envoie un texto en 8 sec après l'appel manqué.",
            "Client rattrapé, urgence bookée.",
            "Appel à l'action : corrigez l'erreur — démo gratuite.",
        ],
        "garage": [
            "Erreur #1 : compter sur la boîte vocale.",
            "Les clients appellent ailleurs en 30 secondes.",
            "Solution : texto auto NoviaAI dès l'appel manqué.",
            "RDV qualifié confirmé.",
            "Appel à l'action : essai 14 jours.",
        ],
        "salon": [
            "Erreur #1 : « rappelez-nous plus tard ».",
            "Les clientes ne rappellent pas — elles bookent ailleurs.",
            "Solution : NoviaAI propose les créneaux par SMS immédiatement.",
            "Nouvelle cliente confirmée.",
            "Appel à l'action : démo gratuite.",
        ],
    },
    "objection_response": {
        "plombier": [
            "Objection : « J'ai pas le temps de gérer un robot. »",
            "Réponse : NoviaAI travaille PENDANT que vous travaillez.",
            "Preuve SMS : le client est servi, vous recevez le résumé.",
            "199$/mois — 1 urgence rattrapée = rentabilisé.",
            "Appel à l'action : essai 14 jours, zéro engagement.",
        ],
        "garage": [
            "Objection : « L'IA va dire n'importe quoi. »",
            "Réponse : qualification contrôlée, vous validez les RDV.",
            "Preuve : mockup SMS professionnel.",
            "ROI en 1 job mécanique.",
            "Appel à l'action : démo garage gratuite.",
        ],
        "salon": [
            "Objection : « Mes clientes veulent une vraie personne. »",
            "Réponse : ton humain par SMS, disponible 24/7.",
            "Preuve : conversation naturelle + RDV confirmé.",
            "Essai sans risque 14 jours.",
            "Appel à l'action : noviaai.ca",
        ],
    },
    "lost_revenue": {
        "plombier": [
            "1 urgence manquée = 500$ perdus.",
            "× 3 par semaine = 6000$/mois envolés.",
            "NoviaAI rattrape l'appel en 8 sec par texto.",
            "1 client rattrapé = forfait NoviaAI payé.",
            "Appel à l'action : calculez vos pertes — démo gratuite.",
        ],
        "garage": [
            "1 freinage perdu = 350$.",
            "12 RDV perdus par mois = milliers en moins.",
            "NoviaAI remplit les trous de l'horaire.",
            "Rentable dès le premier job.",
            "Appel à l'action : démo ROI.",
        ],
        "salon": [
            "1 coloration perdue = 120$.",
            "480$/semaine si 4 clientes perdues.",
            "NoviaAI book 24/7 sans décrocher.",
            "14 jours gratuits pour tester.",
            "Appel à l'action : noviaai.ca",
        ],
    },
    "comparison": {
        "plombier": [
            "Sans NoviaAI vs Avec NoviaAI — quelle différence?",
            "SANS : appel manqué → client perdu → 0$.",
            "AVEC : texto 8 sec → qualification → RDV booké.",
            "8 sec vs jamais · +12 RDV vs 0.",
            "Appel à l'action : choisissez « Avec » — démo gratuite.",
        ],
        "garage": [
            "Comparaison directe pour garages.",
            "SANS : boîte vocale, client parti.",
            "AVEC : NoviaAI qualifie et book.",
            "Stats comparatives animées.",
            "Appel à l'action : essai 14 jours.",
        ],
        "salon": [
            "Comparaison pour salons.",
            "SANS : cliente perdue samedi.",
            "AVEC : créneau confirmé par SMS.",
            "Agenda plein vs troué.",
            "Appel à l'action : démo salon.",
        ],
    },
    "day_in_life": {
        "plombier": [
            "6h du matin — premier appel de la journée.",
            "11h : sous l'évier, appel manqué.",
            "Midi : NoviaAI a répondu et qualifié par SMS.",
            "17h : 3 RDV confirmés, journée sereine.",
            "Appel à l'action : simplifiez votre journée — essai 14 jours.",
        ],
        "garage": [
            "8h : ouverture du garage.",
            "12h : sous le capot, impossible de répondre.",
            "NoviaAI book 2 RDV pendant la réparation.",
            "16h : agenda rempli pour demain.",
            "Appel à l'action : démo gratuite.",
        ],
        "salon": [
            "9h : première cliente.",
            "14h : coloration — téléphone ignoré.",
            "NoviaAI book 3 RDV en arrière-plan.",
            "18h : samedi complet sans stress.",
            "Appel à l'action : essai salon 14 jours.",
        ],
    },
    "transformation": {
        "plombier": [
            "Avant : je perdais 3 clients par semaine.",
            "Point tournant : NoviaAI répond automatiquement.",
            "Maintenant : texto 8 sec, qualification, RDV auto.",
            "+12 RDV/mois, zéro stress.",
            "Appel à l'action : votre transformation — essai 14 jours.",
        ],
        "garage": [
            "Avant : horaire troué, appels manqués.",
            "Découverte de NoviaAI.",
            "Maintenant : RDV qualifiés en SMS auto.",
            "Agenda plein chaque semaine.",
            "Appel à l'action : démo gratuite.",
        ],
        "salon": [
            "Avant : clientes perdues chaque samedi.",
            "NoviaAI change la donne.",
            "RDV bookés pendant que je coiffe.",
            "Agenda rempli, sérénité.",
            "Appel à l'action : démo salon.",
        ],
    },
    "irresistible_offer": {
        "plombier": [
            "Offre PME : essai 14j + démo + setup — valeur 500$, gratuit.",
            "Rappel : chaque appel manqué = argent perdu.",
            "Inclus : agent IA + SMS auto + dashboard.",
            "Annulez quand vous voulez · 1 job = rentabilisé.",
            "Appel à l'action : réservez votre démo — places limitées.",
        ],
        "garage": [
            "Stack offre garage : essai + config agent mécanique.",
            "Problème : clients perdus sous le capot.",
            "Inclus : qualification freins/pneus/inspection.",
            "Garantie essai 14 jours.",
            "Appel à l'action : réservez maintenant.",
        ],
        "salon": [
            "Offre salon : essai + RDV auto configuré en 24h.",
            "Clientes perdues = revenus envolés.",
            "Inclus : booking SMS + rappels.",
            "Sans engagement.",
            "Appel à l'action : essai 14 jours.",
        ],
    },
    "social_proof": {
        "plombier": [
            "+12 urgences bookées en 7 jours — plombier comme vous.",
            "Même problème : trop d'appels manqués en job.",
            "Comment : NoviaAI texto 8 sec + qualification.",
            "Résultat : RDV confirmés sans décrocher.",
            "Appel à l'action : rejoignez les PME qui convertissent.",
        ],
        "garage": [
            "+8 RDV qualifiés cette semaine — garage Québec.",
            "Même défi : répondre quand on est sous le capot.",
            "Demo SMS NoviaAI.",
            "Agenda plein.",
            "Appel à l'action : essai 14 jours.",
        ],
        "salon": [
            "+15 nouvelles clientes ce mois — salon comme le vôtre.",
            "Impossible de répondre en pleine coupe.",
            "NoviaAI book par SMS 24/7.",
            "Samedi rempli.",
            "Appel à l'action : démo salon.",
        ],
    },
}


def _detect_signals(text: str) -> set[str]:
    n = _norm(text)
    found: set[str] = set()
    for signal, keywords in {**PROBLEM_SIGNALS, **GOAL_SIGNALS}.items():
        if any(kw in n for kw in keywords):
            found.add(signal)
    return found


def _niche_key(niche: str) -> str:
    n = _norm(niche)
    for key in NICHE_PROFILES:
        if key in n or n in key:
            return key
    if "coiff" in n or "salon" in n:
        return "salon"
    if "mecan" in n or "garage" in n:
        return "garage"
    if "electr" in n:
        return "electricien"
    if "plomb" in n:
        return "plombier"
    return "plombier"


@dataclass
class FrameworkScore:
    framework_id: str
    name: str
    score: float
    reasons: list[str] = field(default_factory=list)


@dataclass
class ScenePlan:
    number: int
    timing: str
    role: str
    summary: str
    texte_ecran: str
    voix_off: str
    emotion: str
    asset: str
    scene_type: str
    proof_type: str | None = None


@dataclass
class AdPlan:
    niche: str
    objectif: str
    probleme: str
    framework_id: str
    framework_name: str
    psychological_objective: str
    selection_reasons: list[str]
    hook_3s: str
    scene_count: int
    scenes: list[ScenePlan]
    cta_primary: str
    cta_secondary: str
    alternative_frameworks: list[FrameworkScore] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def format_text(self) -> str:
        lines = [
            "=== PLAN PUBLICITAIRE NOVIAAI ===",
            "",
            f"Entrée :",
            f"  Niche      : {self.niche}",
            f"  Objectif   : {self.objectif}",
            f"  Problème   : {self.probleme}",
            "",
            f"Framework choisi : {self.framework_name}",
            f"  (id: {self.framework_id})",
            f"  Objectif psychologique : {self.psychological_objective}",
            "",
            "Pourquoi ce framework :",
        ]
        for r in self.selection_reasons:
            lines.append(f"  • {r}")
        lines += [
            "",
            f"Hook (3 premières secondes) :",
            f"  {self.hook_3s}",
            "",
            f"Structure — {self.scene_count} scènes / 30 secondes :",
            "",
        ]
        for s in self.scenes:
            lines += [
                f"Scène {s.number} ({s.timing}) :",
                f"  {s.summary}",
                f"  Texte écran : {s.texte_ecran}",
                f"  Émotion : {s.emotion} | Asset : {s.asset}",
                "",
            ]
        lines += [
            "Call-to-action :",
            f"  {self.cta_primary}",
            f"  {self.cta_secondary}",
        ]
        if self.alternative_frameworks:
            lines += ["", "Alternatives considérées :"]
            for alt in self.alternative_frameworks[:3]:
                lines.append(f"  - {alt.name} (score {alt.score:.0f})")
        return "\n".join(lines)


def score_frameworks(
    niche: str,
    objectif: str,
    probleme: str = "",
    *,
    traffic: str = "cold",
    has_stats: bool = False,
) -> list[FrameworkScore]:
    """Score tous les frameworks — retourne liste triée par score décroissant."""
    db = load_db()
    niche_k = _niche_key(niche)
    profile = NICHE_PROFILES.get(niche_k, NICHE_PROFILES["plombier"])

    combined = f"{objectif} {probleme}"
    signals = _detect_signals(combined)

    results: list[FrameworkScore] = []

    for fid, rules in FRAMEWORK_SCORE_RULES.items():
        fw = db["frameworks"].get(fid)
        if not fw:
            continue
        score = 0.0
        reasons: list[str] = []

        for signal in signals:
            pts = rules.get(signal, 0)
            if pts:
                score += pts
                reasons.append(f"+{pts} — signal « {signal} »")

        if profile.get("urgency") == "high" and rules.get("niche_urgent"):
            score += rules["niche_urgent"]
            reasons.append(f"+{rules['niche_urgent']} — niche urgence ({niche_k})")

        if profile.get("style") == "aspiration" and rules.get("niche_aspiration"):
            score += rules["niche_aspiration"]
            reasons.append(f"+{rules['niche_aspiration']} — niche aspiration ({niche_k})")

        if traffic == "retargeting" and rules.get("traffic_retargeting"):
            score += rules["traffic_retargeting"]
            reasons.append(f"+{rules['traffic_retargeting']} — trafic retargeting")

        if traffic in ("warm", "retargeting") and rules.get("traffic_warm"):
            score += rules["traffic_warm"] * 0.5
            reasons.append(f"+{rules['traffic_warm'] * 0.5:.0f} — trafic tiède")

        if has_stats and rules.get("has_stats"):
            score += rules["has_stats"]
            reasons.append(f"+{rules['has_stats']} — stats clients disponibles")

        # Bonus alignement tags framework ↔ niche
        tags = fw.get("tags", [])
        if niche_k in ("plombier", "electricien") and "urgence" in tags or "pas" in tags:
            if "appels_manques" in signals or "clients_perdus" in signals:
                score += 2
        if niche_k == "salon" and "aspiration" in tags:
            score += 2

        results.append(FrameworkScore(fid, fw["name"], score, reasons))

    results.sort(key=lambda x: x.score, reverse=True)
    return results


def _plain_scenes(framework_id: str, niche_k: str, resolved_scenes: list[dict]) -> list[str]:
    """Résumés plain-language — fallback sur description technique."""
    by_fw = SCENE_PLAIN.get(framework_id, {})
    plain = by_fw.get(niche_k) or by_fw.get("plombier")
    if plain and len(plain) == len(resolved_scenes):
        return plain
    return [s.get("description", s.get("visual_brief", "")) for s in resolved_scenes]


def select_ad_plan(
    niche: str,
    objectif: str,
    probleme: str = "",
    *,
    traffic: str = "cold",
    has_stats: bool = False,
    framework_override: str | None = None,
) -> AdPlan:
    """
    Point d'entrée principal du moteur marketing.

    Choisit le meilleur framework et produit un plan de pub 30s structuré.
    """
    niche = niche.strip()
    objectif = objectif.strip()
    probleme = (probleme or "").strip()
    niche_k = _niche_key(niche)

    rankings = score_frameworks(
        niche, objectif, probleme, traffic=traffic, has_stats=has_stats
    )

    if framework_override:
        fid = framework_override
        chosen = next((r for r in rankings if r.framework_id == fid), rankings[0])
    else:
        chosen = rankings[0] if rankings else FrameworkScore("pas_classic", "PAS", 0)
        fid = chosen.framework_id

    fw = resolve_framework(fid, niche_k)
    plain = _plain_scenes(fid, niche_k, fw["scenes_resolved"])

    hook = fw["hook_3s_resolved"].get("example_fr") or fw["hook_3s_resolved"].get("text_fr", "")

    scenes: list[ScenePlan] = []
    for i, (rs, summary) in enumerate(zip(fw["scenes_resolved"], plain)):
        scenes.append(ScenePlan(
            number=rs["number"],
            timing=rs["timing"],
            role=rs["role"],
            summary=summary,
            texte_ecran=rs["texte_ecran"],
            voix_off=rs["voix_off"],
            emotion=rs["emotion"],
            asset=rs["asset"],
            scene_type=rs["scene_type"],
            proof_type=rs.get("proof_type"),
        ))

    selection_reasons = chosen.reasons.copy() if chosen.framework_id == fid else [
        f"Framework imposé manuellement : {fid}"
    ]
    if not selection_reasons:
        selection_reasons = ["Framework par défaut — meilleur match global NoviaAI PME"]

    alts = [r for r in rankings if r.framework_id != fid][:3]

    return AdPlan(
        niche=niche,
        objectif=objectif,
        probleme=probleme or "non spécifié",
        framework_id=fid,
        framework_name=fw["name"],
        psychological_objective=fw["psychological_objective"],
        selection_reasons=selection_reasons,
        hook_3s=hook,
        scene_count=fw["scene_count"],
        scenes=scenes,
        cta_primary=fw["cta"]["primary"],
        cta_secondary=fw["cta"]["secondary"],
        alternative_frameworks=alts,
    )


def save_plan(plan: AdPlan, out_dir: Path | None = None) -> Path:
    """Sauvegarde le plan en JSON + texte."""
    out_dir = out_dir or (ROOT / "output" / f"{_niche_key(plan.niche)}_{plan.framework_id}")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "AD_PLAN_LATEST.json").write_text(
        json.dumps(plan.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "AD_PLAN_LATEST.txt").write_text(plan.format_text(), encoding="utf-8")
    return out_dir
