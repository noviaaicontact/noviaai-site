"""
Bibliothèque de frameworks publicitaires B2B SaaS → PME.

Sources : PAS, BAB, AIDA, Hook-Story-Offer (Hormozi), structures GoHighLevel /
LeadConnector, patterns Meta Ads performance (Andromeda), agences SaaS locales.

Usage :
    from ad_frameworks import get_framework, list_frameworks, recommend_framework
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

# Types de scènes supportés par le pipeline NoviaAI
SCENE_TYPES = {
    "hook_busy_missed_call": "Entrepreneur en job, téléphone vibre, impossible de répondre (Runway/b-roll)",
    "hook_stat_shock": "Stat animée plein écran (MoviePy stat_clip)",
    "hook_pattern_interrupt": "Visuel inattendu ou question provocante (Runway)",
    "problem_missed_calls": "Appels manqués, notifications, client frustré (Runway)",
    "problem_client_leaves": "Client raccroche, cherche concurrent (Runway)",
    "problem_revenue_loss": "Perte d'argent visualisée — factures, calendrier vide (Runway/stat)",
    "agitate_urgency": "Montage rapide stressant, accumulation de problèmes (Runway cuts)",
    "before_chaos": "Journée chaotique sans système (Runway/b-roll)",
    "after_calm": "Même entrepreneur serein, RDV bookés (Runway)",
    "solution_sms_mockup": "Conversation SMS NoviaAI animée (Playwright mockup)",
    "solution_dashboard": "Dashboard NoviaAI mobile (Playwright capture)",
    "proof_rdv_confirmed": "Notification « RDV confirmé » + soulagement (Runway)",
    "proof_social_stat": "Chiffres résultats (+3 RDV, 8 sec réponse) (stat_clip)",
    "objection_answer": "Réponse visuelle à une objection (Runway/texte)",
    "cta_demo": "Slide CTA navy/lime + noviaai.ca (MoviePy cta_clip)",
}

HOOK_TYPES = {
    "question_pain": "Question directe sur la douleur (« Combien de clients avez-vous perdus…? »)",
    "stat_shock": "Chiffre choc (« 60 % ne rappellent jamais »)",
    "pattern_interrupt": "Affirmation contre-intuitive (« Votre téléphone vous coûte de l'argent »)",
    "relatable_moment": "Scène reconnaissable instantanément (mains sales, sous l'évier)",
    "before_after_tease": "Aperçu transformation (« Avant / Après NoviaAI »)",
    "social_proof_open": "Résultat d'abord (« +12 RDV cette semaine »)",
}


@dataclass
class Beat30s:
    """Un beat d'une pub 30 secondes."""
    start_s: float
    end_s: float
    role: str
    scene_type: str
    hook_type: str | None
    texte_ecran_template: str
    voix_off_template: str
    visual_brief: str
    asset: str  # runway | sms_mockup | dashboard | stat | cta | broll


@dataclass
class NicheExample:
    hook: str
    textes_ecran: list[str]
    voix_off: str


@dataclass
class AdFramework:
    id: str
    name: str
    origin: str
    psychological_objective: str
    when_to_use: list[str]
    when_not_to_use: list[str]
    hook_types: list[str]
    scene_types_required: list[str]
    beats: list[Beat30s]
    noviaai_adaptation: str
    examples: dict[str, NicheExample]
    tags: list[str] = field(default_factory=list)

    def total_duration(self) -> float:
        return self.beats[-1].end_s if self.beats else 30.0

    def to_storyboard_brief(self, niche: str, objectif: str = "Obtenir des démos") -> str:
        """Brief OpenAI structuré pour générer un storyboard conforme au framework."""
        beats_txt = []
        for b in self.beats:
            beats_txt.append(
                f"- {b.start_s:.0f}-{b.end_s:.0f}s [{b.role}] scene_type={b.scene_type} "
                f"asset={b.asset}\n"
                f"  Texte écran (template): {b.texte_ecran_template}\n"
                f"  Voix-off (template): {b.voix_off_template}\n"
                f"  Visuel: {b.visual_brief}"
            )
        ex = self.examples.get(niche.lower(), self.examples.get("plombier"))
        return f"""Framework publicitaire : {self.name} ({self.id})
Objectif psychologique : {self.psychological_objective}
Adaptation NoviaAI : {self.noviaai_adaptation}

Niche cible : {niche}
Objectif campagne : {objectif}

Exemple de référence pour cette niche :
- Hook : {ex.hook}
- Textes écran : {ex.textes_ecran}
- Voix-off : {ex.voix_off}

Structure OBLIGATOIRE (30 s, 9:16, style GoHighLevel, FR québécois) :
{chr(10).join(beats_txt)}

Règles :
- Respecter exactement les timings et le nombre de scènes ({len(self.beats)} scènes)
- Chaque scène : prompt_image EN, prompt_runway EN (sauf sms_mockup/dashboard → note « asset Playwright »)
- Pas de face cam fondateur
- Produit = NoviaAI (SMS auto ~8s, agent IA qualification, dashboard RDV)
- Couleurs accent navy #13325b et lime #c8f135
"""


def _beat(
    start: float,
    end: float,
    role: str,
    scene_type: str,
    texte: str,
    voix: str,
    visual: str,
    asset: str = "runway",
    hook: str | None = None,
) -> Beat30s:
    return Beat30s(start, end, role, scene_type, hook, texte, voix, visual, asset)


FRAMEWORKS: dict[str, AdFramework] = {}


def _register(fw: AdFramework) -> AdFramework:
    FRAMEWORKS[fw.id] = fw
    return fw


# ─── 1. PAS — Problem Agitate Solution ───────────────────────────────────────
_register(AdFramework(
    id="pas_classic",
    name="PAS — Problème · Agitation · Solution",
    origin="Direct response (Eugene Schwartz) · Standard agences performance SaaS",
    psychological_objective="Amplifier la douleur existante jusqu'à ce que la solution devienne évidente et urgente.",
    when_to_use=[
        "Audience qui vit déjà le problème (appels manqués) mais ne connaît pas NoviaAI",
        "Cold traffic Meta / TikTok — pas de notoriété de marque",
        "Première pub d'une campagne de conversion",
        "Niches à forte urgence (plombier, électricien, dépannage)",
    ],
    when_not_to_use=[
        "Retargeting chaud qui a déjà vu une démo",
        "Audience sceptique de l'IA — préférer objection_crusher",
    ],
    hook_types=["question_pain", "relatable_moment"],
    scene_types_required=[
        "hook_busy_missed_call", "problem_missed_calls", "agitate_urgency",
        "solution_sms_mockup", "cta_demo",
    ],
    beats=[
        _beat(0, 3, "hook", "hook_busy_missed_call", "{hook_question}",
              "{hook_voix}", "Gros plan téléphone qui vibre, mains occupées", "runway", "question_pain"),
        _beat(3, 10, "problem", "problem_missed_calls", "Un appel manqué = un client perdu.",
              "Chaque jour, des clients vous appellent. Personne ne répond assez vite.",
              "Appels manqués, client qui part chez le concurrent", "runway"),
        _beat(10, 18, "agitate+solution", "solution_sms_mockup", "Votre assistant IA disponible 24/7.",
              "NoviaAI répond en 8 secondes, qualifie et propose un RDV.",
              "Mockup SMS conversation qualification", "sms_mockup"),
        _beat(18, 26, "solution_proof", "proof_rdv_confirmed", "Nouveau rendez-vous confirmé.",
              "Pendant que vous travaillez, votre entreprise continue de répondre.",
              "Notification RDV, entrepreneur serein", "runway"),
        _beat(26, 30, "cta", "cta_demo", "Demandez votre démonstration.",
              "Essai gratuit 14 jours — noviaai.ca", "Slide CTA navy/lime", "cta"),
    ],
    noviaai_adaptation=(
        "Scène 1-2 = douleur appel manqué. Scène 3 = mockup SMS réel (preuve produit). "
        "Scène 4 = notification RDV (résultat tangible). Ne jamais expliquer l'IA — montrer le texto."
    ),
    examples={
        "plombier": NicheExample(
            "Combien de fuites urgentes avez-vous perdues parce que vous étiez sous l'évier?",
            ["Combien de fuites perdues aujourd'hui?", "Un appel manqué = un client perdu.",
             "NoviaAI répond en 8 sec", "RDV confirmé demain 8h", "Essai gratuit 14 jours"],
            "T'es en job, le téléphone sonne, tu peux pas répondre. NoviaAI envoie un texto en 8 secondes et book le client.",
        ),
        "garage": NicheExample(
            "Combien de clients ont raccroché pendant que vous étiez sous le capot?",
            ["Clients perdus sous le capot?", "60% ne rappellent jamais",
             "Texto auto + qualification", "3 RDV bookés cette semaine", "Démo gratuite"],
            "Pendant que tu répares, tes clients appellent ailleurs. NoviaAI répond et remplit ton horaire.",
        ),
        "salon": NicheExample(
            "Combien de clientes avez-vous perdues pendant une coloration?",
            ["Mains dans les cheveux, téléphone qui sonne?", "Elle appelle le salon d'à côté",
             "NoviaAI book pendant que vous coiffez", "Nouvelle cliente confirmée", "Essai 14 jours"],
            "Tu es en pleine coupe, tu peux pas décrocher. NoviaAI répond et propose les créneaux libres.",
        ),
    },
    tags=["cold", "conversion", "urgence", "default"],
))


# ─── 2. BAB — Before After Bridge ───────────────────────────────────────────
_register(AdFramework(
    id="bab_transformation",
    name="BAB — Avant · Après · Pont",
    origin="StoryBrand · Agences GHL · SaaS onboarding ads",
    psychological_objective="Créer un contraste émotionnel fort : chaos → sérénité. Le produit est le pont.",
    when_to_use=[
        "Propriétaires qui se sentent débordés mais pas encore en crise",
        "Salons, cliniques, garages avec horaire à remplir",
        "Quand la vidéo doit inspirer (aspiration) plus qu'effrayer",
    ],
    when_not_to_use=["Urgence extrême (fuite, panne) — PAS convertit mieux"],
    hook_types=["before_after_tease", "relatable_moment"],
    scene_types_required=["before_chaos", "after_calm", "solution_sms_mockup", "cta_demo"],
    beats=[
        _beat(0, 4, "before", "before_chaos", "Votre journée sans NoviaAI.",
              "Avant : téléphone qui sonne, stress, clients perdus.", "Montage chaotique, multiples appels manqués", "runway", "relatable_moment"),
        _beat(4, 12, "after_tease", "after_calm", "Votre journée avec NoviaAI.",
              "Après : vous travaillez, NoviaAI répond à votre place.", "Même métier, calme, notification positive", "runway", "before_after_tease"),
        _beat(12, 22, "bridge", "solution_sms_mockup", "Le pont : texto en 8 sec + RDV auto.",
              "NoviaAI envoie le texto, qualifie et confirme le rendez-vous.", "Mockup SMS complet", "sms_mockup"),
        _beat(22, 26, "proof", "proof_social_stat", "+{n} RDV cette semaine",
              "Résultats concrets dès la première semaine.", "Stat animée ou notification", "stat"),
        _beat(26, 30, "cta", "cta_demo", "Passez de l'avant à l'après.",
              "Demandez votre démo — essai 14 jours.", "CTA slide", "cta"),
    ],
    noviaai_adaptation="Contraste visuel avant/après sur le MÊME métier. Le mockup SMS = le pont concret entre les deux états.",
    examples={
        "plombier": NicheExample("Avant NoviaAI vs après NoviaAI — même plombier, deux journées.",
            ["Journée chaos", "Journée sereine", "Texto auto en 8 sec", "+4 urgences bookées", "Démo gratuite"],
            "Avant, tu courais partout et tu perdais des appels. Maintenant NoviaAI répond pendant que tu travailles."),
        "garage": NicheExample("Garage débordé? Voici la différence en une semaine.",
            ["Avant : horaire troué", "Après : agenda plein", "Qualification auto", "+6 RDV", "Essai 14 jours"],
            "Ton garage sans système vs avec NoviaAI qui remplit tes créneaux."),
        "salon": NicheExample("Coiffeuse débordée le samedi? Regardez la différence.",
            ["Samedi sans NoviaAI", "Samedi avec NoviaAI", "RDV bookés en SMS", "Agenda plein", "Démo salon"],
            "Avant tu perdais des clientes. Maintenant NoviaAI book pendant que tu coiffes."),
    },
    tags=["aspiration", "salon", "garage"],
))


# ─── 3. Stat Shock GHL ───────────────────────────────────────────────────────
_register(AdFramework(
    id="stat_shock_ghl",
    name="Stat Shock → Démo → Preuve → CTA",
    origin="GoHighLevel / LeadConnector · Agences white-label US",
    psychological_objective="Arrêter le scroll avec un chiffre inconfortable, puis prouver avec le produit.",
    when_to_use=[
        "Trafic froid très distrait (Reels, TikTok)",
        "Message quantifiable fort (60%, 8 sec, 3 RDV)",
        "Retargeting léger",
    ],
    when_not_to_use=["Audience déjà convaincue du problème — trop répétitif"],
    hook_types=["stat_shock"],
    scene_types_required=["hook_stat_shock", "solution_sms_mockup", "solution_dashboard", "cta_demo"],
    beats=[
        _beat(0, 3, "hook", "hook_stat_shock", "{stat}% de vos clients\nne rappellent jamais",
              "Soixante pour cent de vos clients ne rappellent jamais.", "Stat plein écran animée", "stat", "stat_shock"),
        _beat(3, 7, "context", "hook_busy_missed_call", "Pendant que t'es en job…",
              "Pendant que vous êtes occupé, ils partent ailleurs.", "B-roll métier occupé", "runway"),
        _beat(7, 15, "demo", "solution_sms_mockup", "Texto automatique en 8 secondes",
              "NoviaAI envoie un texto en huit secondes et qualifie le client.", "SMS mockup", "sms_mockup"),
        _beat(15, 24, "demo", "solution_dashboard", "Ton dashboard en direct",
              "Tous vos leads et RDV au même endroit.", "Capture dashboard mobile", "dashboard"),
        _beat(24, 30, "cta", "cta_demo", "Essai gratuit 14 jours\nnoviaai.ca",
              "Commencez votre essai gratuit aujourd'hui.", "CTA", "cta"),
    ],
    noviaai_adaptation="Utiliser stat_clip MoviePy + mockup SMS + dashboard Playwright. C'est le framework du pub_plombier_GHL existant.",
    examples={
        "plombier": NicheExample("60% de tes clients ne rappellent jamais.",
            ["60% ne rappellent jamais", "Pendant que t'es en job…", "Texto en 8 sec", "Dashboard live", "Essai 14 jours"],
            "Soixante pour cent ne rappellent jamais. NoviaAI envoie le texto pendant que tu répares."),
        "garage": NicheExample("8 secondes — c'est le temps de réponse de vos clients.",
            ["8 sec pour répondre", "Sinon ils partent", "NoviaAI = 8 sec", "RDV qualifiés", "noviaai.ca"],
            "Tes clients attendent huit secondes. NoviaAI répond à ta place."),
        "salon": NicheExample("3 clientes perdues par semaine — en moyenne.",
            ["3 clientes perdues/sem.", "Elles appellent ailleurs", "NoviaAI book 24/7", "Agenda rempli", "Essai gratuit"],
            "Trois clientes perdues par semaine. NoviaAI réserve pendant que tu travailles."),
    },
    tags=["ghl", "stat", "cold", "proven"],
))


# ─── 4. Hook-Story-Offer (HSO) ───────────────────────────────────────────────
_register(AdFramework(
    id="hso_hook_story_offer",
    name="Hook · Story · Offer",
    origin="Alex Hormozi · Agences info-produits · Adapté SaaS par GHL agencies",
    psychological_objective="Capturer l'attention, créer l'identification via micro-histoire, offrir une sortie claire.",
    when_to_use=[
        "Storytelling court (un client, une journée)",
        "Quand le fondateur n'est pas à l'écran — l'histoire est celle du PME",
        "Campagnes evergreen",
    ],
    when_not_to_use=["Besoin de preuve produit immédiate — préférer stat_shock_ghl"],
    hook_types=["pattern_interrupt", "question_pain"],
    scene_types_required=["hook_pattern_interrupt", "problem_client_leaves", "solution_sms_mockup", "cta_demo"],
    beats=[
        _beat(0, 3, "hook", "hook_pattern_interrupt", "Votre téléphone vous coûte de l'argent.",
              "Votre téléphone vous coûte de l'argent.", "Visuel provocant — téléphone = fuite d'argent", "runway", "pattern_interrupt"),
        _beat(3, 12, "story", "problem_client_leaves", "Marc a appelé. Personne n'a répondu.",
              "Marc avait une urgence. Il a appelé trois fois. Puis il a googlé votre concurrent.",
              "Micro-histoire client fictif mais crédible", "runway", None),
        _beat(12, 22, "offer_setup", "solution_sms_mockup", "Et si quelqu'un répondait à votre place?",
              "NoviaAI répond en huit secondes, pose les bonnes questions et book le RDV.", "SMS demo", "sms_mockup"),
        _beat(22, 26, "offer", "proof_rdv_confirmed", "Marc a booké demain 8h.",
              "Marc a reçu une confirmation. Vous, vous étiez en job.", "Notification succès", "runway"),
        _beat(26, 30, "cta", "cta_demo", "Offre : démo gratuite + 14 jours.",
              "Demandez votre démonstration gratuite.", "CTA", "cta"),
    ],
    noviaai_adaptation="Personnifier le client final (Marc, Julie) — jamais le propriétaire NoviaAI. L'offre = démo + essai, pas discount.",
    examples={
        "plombier": NicheExample("Votre téléphone vous coûte des urgences à 500$.",
            ["Votre tel vous coûte cher", "Marc avait une fuite", "NoviaAI répond", "Marc booké 8h", "Démo gratuite"],
            "Marc avait une fuite à minuit. Personne n'a répondu. Avec NoviaAI, il aurait booké en deux minutes."),
        "garage": NicheExample("Un client avec un bruit de frein. Parti en 30 secondes.",
            ["30 sec et c'est fini", "Il appelle le garage voisin", "NoviaAI intercepte", "RDV demain", "Essai 14 jours"],
            "Un client appelle pour ses freins. Pas de réponse. NoviaAI l'a rattrapé par texto."),
        "salon": NicheExample("Julie voulait une coupe pour samedi. Elle a appelé ailleurs.",
            ["Julie cherche un créneau", "Personne ne répond", "NoviaAI propose 14h", "Julie confirmée", "Démo salon"],
            "Julie voulait samedi. NoviaAI lui a proposé un créneau pendant que tu coiffais."),
    },
    tags=["story", "evergreen"],
))


# ─── 5. Lost Revenue Calculator ──────────────────────────────────────────────
_register(AdFramework(
    id="lost_revenue",
    name="Calculateur de revenus perdus",
    origin="SaaS B2B (HubSpot, ServiceTitan ads) · Agences comptables PME",
    psychological_objective="Rendre la perte concrète en dollars — la douleur devient un calcul, pas une émotion vague.",
    when_to_use=[
        "PME sensibles au ROI (garage, plombier commercial)",
        "Décideurs rationnels",
        "Retargeting après vidéo émotionnelle",
    ],
    when_not_to_use=["Première impression — trop froid sans contexte émotionnel"],
    hook_types=["stat_shock", "pattern_interrupt"],
    scene_types_required=["problem_revenue_loss", "hook_stat_shock", "solution_sms_mockup", "cta_demo"],
    beats=[
        _beat(0, 4, "hook", "hook_stat_shock", "1 appel manqué = {montant}$ perdus",
              "Un seul appel manqué peut vous coûter cinq cents dollars.", "Chiffre dollar animé", "stat", "stat_shock"),
        _beat(4, 11, "problem", "problem_revenue_loss", "× 3 par semaine = {montant_mois}$/mois",
              "Multipliez par trois par semaine. Ça fait des milliers par mois.", "Calendrier vide, factures manquantes", "runway"),
        _beat(11, 20, "solution", "solution_sms_mockup", "NoviaAI rattrape l'appel en 8 sec",
              "NoviaAI envoie un texto automatique et transforme l'appel manqué en RDV.", "SMS mockup", "sms_mockup"),
        _beat(20, 26, "proof", "proof_social_stat", "ROI : 1 client = forfait payé",
              "Un seul client rattrapé paie votre abonnement.", "Stat ROI", "stat"),
        _beat(26, 30, "cta", "cta_demo", "Calculez vos pertes — démo gratuite",
              "Demandez une démo et voyez combien vous perdez.", "CTA", "cta"),
    ],
    noviaai_adaptation="Adapter {montant} par niche : urgence plombier 500$, garage 300$, salon 80$. Forfait NoviaAI ~199$/mois = ancrage ROI.",
    examples={
        "plombier": NicheExample("1 urgence manquée = 500$ dans le vide.",
            ["500$ par appel manqué", "×3/semaine = 6000$/mois", "NoviaAI rattrape", "1 job = abonnement payé", "Démo ROI"],
            "Une urgence à cinq cents dollars. Trois par semaine. NoviaAI les rattrape toutes."),
        "garage": NicheExample("1 freinage perdu = 350$. Combien par mois?",
            ["350$ par RDV perdu", "12 RDV/mois perdus?", "Texto auto 8 sec", "Rentable en 1 job", "Démo gratuite"],
            "Un freinage à trois cent cinquante. NoviaAI remplit les trous dans ton horaire."),
        "salon": NicheExample("1 coloration perdue = 120$. × 4/semaine?",
            ["120$ par cliente perdue", "480$/semaine envolés", "NoviaAI book 24/7", "14 jours gratuits", "noviaai.ca"],
            "Cent vingt dollars par coloration. NoviaAI ne laisse plus sonner dans le vide."),
    },
    tags=["roi", "rational", "retargeting"],
))


# ─── 6. Objection Crusher ────────────────────────────────────────────────────
_register(AdFramework(
    id="objection_crusher",
    name="Brise-objections",
    origin="SaaS enterprise · Meta retargeting · GHL webinar funnels",
    psychological_objective="Lever les freins à l'achat avant le CTA — trop occupé, trop cher, pas confiance IA.",
    when_to_use=[
        "Retargeting visiteurs noviaai.ca",
        "Audience 35-55 ans sceptique tech",
        "Après 3+ impressions sans conversion",
    ],
    when_not_to_use=["Cold traffic — objections prématurées"],
    hook_types=["pattern_interrupt"],
    scene_types_required=["objection_answer", "solution_sms_mockup", "proof_social_stat", "cta_demo"],
    beats=[
        _beat(0, 4, "objection", "objection_answer", "« Je suis trop occupé pour un autre outil. »",
              "Vous pensez être trop occupé pour un autre outil?", "Texte objection + entrepreneur occupé", "runway", "pattern_interrupt"),
        _beat(4, 10, "answer", "objection_answer", "NoviaAI travaille PENDANT que vous travaillez.",
              "NoviaAI ne demande pas plus de temps. Il répond quand vous ne pouvez pas.", "Split écran travail / SMS auto", "runway"),
        _beat(10, 18, "proof", "solution_sms_mockup", "Pas besoin de toucher votre téléphone.",
              "Le client reçoit un texto en huit secondes. Vous recevez un résumé.", "SMS mockup", "sms_mockup"),
        _beat(18, 26, "objection2", "proof_social_stat", "199$/mois · 1 client = rentabilisé",
              "Cent quatre-vingt-dix-neuf dollars. Un client rattrapé et c'est payé.", "Stat prix/ROI", "stat"),
        _beat(26, 30, "cta", "cta_demo", "Essai 14 jours — zéro engagement",
              "Essai gratuit quatorze jours. Annulez quand vous voulez.", "CTA", "cta"),
    ],
    noviaai_adaptation="Nommer l'objection en texte écran (guillemets). Répondre par preuve produit, pas argumentation. Essai 14j = risque zéro.",
    examples={
        "plombier": NicheExample("« J'ai pas le temps de gérer un robot. »",
            ["Trop occupé?", "NoviaAI répond seul", "Vous recevez le résumé", "199$/mois · 1 job", "14 jours gratuits"],
            "T'as pas le temps? C'est exactement pour ça que NoviaAI existe."),
        "garage": NicheExample("« L'IA va dire n'importe quoi à mes clients. »",
            ["Peur de l'IA?", "Qualification contrôlée", "Vous validez les RDV", "Essai sans risque", "Démo garage"],
            "L'agent pose les bonnes questions. Vous gardez le contrôle."),
        "salon": NicheExample("« Mes clientes veulent parler à une vraie personne. »",
            ["Elles veulent du personnel?", "Réponse humaine par SMS", "RDV confirmé par texto", "14 jours gratuits", "noviaai.ca"],
            "NoviaAI répond comme votre réceptionniste — disponible vingt-quatre heures sur sept."),
    },
    tags=["retargeting", "objection"],
))


# ─── 7. Social Proof Micro ───────────────────────────────────────────────────
_register(AdFramework(
    id="social_proof_micro",
    name="Micro preuve sociale",
    origin="Case study ads (Intercom, Jobber) · Témoignages GHL",
    psychological_objective="Réduire le risque perçu via résultats d'un pair (même métier, même ville).",
    when_to_use=[
        "Quand vous avez des stats clients (même anonymisées)",
        "Phase scaling — lookalike audiences",
        "Niches où le bouche-à-oreille domine",
    ],
    when_not_to_use=["Sans chiffres crédibles — paraît fake"],
    hook_types=["social_proof_open"],
    scene_types_required=["proof_social_stat", "solution_sms_mockup", "proof_rdv_confirmed", "cta_demo"],
    beats=[
        _beat(0, 4, "hook", "proof_social_stat", "+{n} RDV bookés en 7 jours",
              "Plus douze rendez-vous bookés en une semaine.", "Stat résultat plein écran", "stat", "social_proof_open"),
        _beat(4, 10, "context", "hook_busy_missed_call", "Un {metier} comme vous",
              "Un plombier comme vous, même problème : trop d'appels manqués.", "B-roll métier", "runway"),
        _beat(10, 18, "how", "solution_sms_mockup", "Voici comment ça marche",
              "NoviaAI envoie un texto en huit secondes et qualifie automatiquement.", "SMS demo", "sms_mockup"),
        _beat(18, 26, "proof", "proof_rdv_confirmed", "Résultat : inbox zero stress",
              "Rendez-vous confirmés sans décrocher.", "Notification + calme", "runway"),
        _beat(26, 30, "cta", "cta_demo", "Rejoignez les PME qui convertissent",
              "Demandez votre démo — essai quatorze jours.", "CTA", "cta"),
    ],
    noviaai_adaptation="Utiliser stats réelles dashboard quand disponibles. Sinon fourchette conservative (+3 RDV/semaine). Jamais inventer un nom de client sans consentement.",
    examples={
        "plombier": NicheExample("+12 urgences bookées en 7 jours — plombier Laval.",
            ["+12 RDV en 7 jours", "Même problème que vous", "Texto en 8 sec", "Inbox under control", "Démo gratuite"],
            "Douze urgences en une semaine. NoviaAI pendant qu'il était en job."),
        "garage": NicheExample("Garage Québec : +8 RDV qualifiés cette semaine.",
            ["+8 RDV cette semaine", "Garage comme le vôtre", "Qualification auto", "Agenda plein", "Essai 14 jours"],
            "Huit rendez-vous qualifiés. NoviaAI a filtré les vrais clients."),
        "salon": NicheExample("Salon Montréal : 15 nouvelles clientes via SMS ce mois.",
            ["+15 clientes ce mois", "Salon comme le vôtre", "RDV auto samedi", "Agenda rempli", "Démo salon"],
            "Quinze nouvelles clientes bookées par texto ce mois-ci."),
    },
    tags=["proof", "scaling", "lookalike"],
))


# ─── 8. AIDA compact ─────────────────────────────────────────────────────────
_register(AdFramework(
    id="aida_compact",
    name="AIDA — Attention · Intérêt · Désir · Action",
    origin="Classic marketing · Meta creative testing frameworks",
    psychological_objective="Progression logique du scroll-stop à l'action sans saut émotionnel.",
    when_to_use=[
        "Tests A/B de hooks",
        "Audiences mixtes (froid + tiède)",
        "Format éducatif léger",
    ],
    when_not_to_use=["Urgence extrême — trop linéaire, manque d'agitation"],
    hook_types=["question_pain", "stat_shock"],
    scene_types_required=["hook_busy_missed_call", "problem_missed_calls", "solution_sms_mockup", "cta_demo"],
    beats=[
        _beat(0, 3, "attention", "hook_busy_missed_call", "{hook}",
              "{hook_voix}", "Scroll-stop visuel", "runway", "question_pain"),
        _beat(3, 9, "interest", "problem_missed_calls", "Le vrai coût d'un appel manqué",
              "Saviez-vous que la plupart des clients ne rappellent jamais?", "Éducation problème", "runway"),
        _beat(9, 18, "desire", "solution_sms_mockup", "Imaginez : réponse en 8 sec, 24/7",
              "Imaginez un assistant qui répond en huit secondes, vingt-quatre heures sur sept.", "SMS demo désirable", "sms_mockup"),
        _beat(18, 26, "desire+", "proof_rdv_confirmed", "RDV confirmés. Sérénité.",
              "Des rendez-vous confirmés pendant que vous travaillez.", "Résultat", "runway"),
        _beat(26, 30, "action", "cta_demo", "Action : démo gratuite",
              "Passez à l'action — essai gratuit quatorze jours.", "CTA", "cta"),
    ],
    noviaai_adaptation="Ton légèrement plus éducatif que PAS. « Imaginez » à la scène désir — pas de hard sell avant scène 3.",
    examples={
        "plombier": NicheExample("Saviez-vous que 60% des appels urgents ne laissent pas de message?",
            ["60% pas de message", "Coût d'un appel manqué", "Réponse en 8 sec", "RDV auto", "Démo gratuite"],
            "La plupart des urgences ne laissent pas de message. NoviaAI les rattrape par texto."),
        "garage": NicheExample("Vos clients attendent combien de temps avant d'appeler ailleurs?",
            ["30 sec max", "Puis ils partent", "NoviaAI 24/7", "RDV qualifiés", "Essai 14 jours"],
            "Trente secondes. C'est tout ce qu'ils attendent."),
        "salon": NicheExample("Une cliente sur deux n'attend pas plus d'une sonnerie.",
            ["1 sonnerie max", "Elle book ailleurs", "NoviaAI répond", "Créneaux remplis", "Démo salon"],
            "Une sonnerie. NoviaAI répond pendant que vous avez les mains occupées."),
    },
    tags=["testing", "education", "aida"],
))


# ─── API ─────────────────────────────────────────────────────────────────────

NICHE_DEFAULTS = {
    "plombier": {"metier": "plombier", "montant": "500", "montant_mois": "6000", "n": "12", "stat": "60"},
    "garage": {"metier": "garage", "montant": "350", "montant_mois": "4200", "n": "8", "stat": "60"},
    "salon": {"metier": "salon", "montant": "120", "montant_mois": "1920", "n": "15", "stat": "50"},
    "electricien": {"metier": "électricien", "montant": "400", "montant_mois": "4800", "n": "10", "stat": "60"},
}


def list_frameworks() -> list[dict[str, Any]]:
    return [
        {
            "id": fw.id,
            "name": fw.name,
            "psychological_objective": fw.psychological_objective,
            "tags": fw.tags,
            "hook_types": fw.hook_types,
            "scenes": len(fw.beats),
        }
        for fw in FRAMEWORKS.values()
    ]


def get_framework(framework_id: str) -> AdFramework:
    fw = FRAMEWORKS.get(framework_id)
    if not fw:
        raise KeyError(f"Framework inconnu: {framework_id}. Disponibles: {', '.join(FRAMEWORKS)}")
    return fw


def recommend_framework(
    niche: str,
    *,
    traffic: str = "cold",
    goal: str = "demo",
    has_stats: bool = False,
) -> str:
    """Recommande un framework selon le contexte campagne."""
    niche = niche.lower()
    if traffic == "retargeting":
        return "objection_crusher"
    if goal == "roi" or traffic == "warm":
        return "lost_revenue"
    if has_stats:
        return "social_proof_micro"
    if niche in ("salon", "coiffure", "esthetique"):
        return "bab_transformation"
    if niche in ("plombier", "electricien", "depannage"):
        return "pas_classic"
    if traffic == "cold":
        return "stat_shock_ghl"
    return "pas_classic"


def resolve_beat_templates(fw: AdFramework, niche: str) -> list[Beat30s]:
    """Remplace {placeholders} dans les templates selon la niche."""
    vars_ = {**NICHE_DEFAULTS.get(niche.lower(), NICHE_DEFAULTS["plombier"])}
    ex = fw.examples.get(niche.lower(), fw.examples.get("plombier"))
    vars_["hook"] = ex.hook
    vars_["hook_question"] = ex.hook
    vars_["hook_voix"] = ex.voix_off.split(".")[0] + "."

    resolved = []
    for b in fw.beats:
        def sub(s: str) -> str:
            for k, v in vars_.items():
                s = s.replace("{" + k + "}", str(v))
            return s

        resolved.append(Beat30s(
            b.start_s, b.end_s, b.role, b.scene_type, b.hook_type,
            sub(b.texte_ecran_template), sub(b.voix_off_template),
            b.visual_brief, b.asset,
        ))
    return resolved


def framework_to_dict(framework_id: str) -> dict[str, Any]:
    fw = get_framework(framework_id)
    d = asdict(fw)
    d["beats"] = [asdict(b) for b in fw.beats]
    d["examples"] = {k: asdict(v) for k, v in fw.examples.items()}
    return d


def export_all_json() -> dict[str, Any]:
    return {
        "scene_types": SCENE_TYPES,
        "hook_types": HOOK_TYPES,
        "frameworks": {fid: framework_to_dict(fid) for fid in FRAMEWORKS},
        "recommendation_rules": {
            "cold_urgent_niche": "pas_classic",
            "cold_distracted": "stat_shock_ghl",
            "aspiration": "bab_transformation",
            "retargeting": "objection_crusher",
            "roi_focus": "lost_revenue",
            "has_client_stats": "social_proof_micro",
            "story_evergreen": "hso_hook_story_offer",
            "ab_testing": "aida_compact",
        },
    }
