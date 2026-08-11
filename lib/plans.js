/** Forfaits NoviaAI — prix CAD / mois, limites en conversations distinctes.
 * Une conversation ≈ un client distinct qui répond après un appel manqué.
 * Limites calibrées pour PME QC : peu de commerces manquent >50 appels/mois.
 *
 * L'essai 14 jours (sans carte) est uniquement sur Essentiel.
 * Croissance / Pro s'activent au paiement (après ou pendant l'essai).
 */
const TRIAL_PLAN = 'essentiel';
/** Forfait recommandé à l'activation / si plan invalide côté payant. */
const DEFAULT_PLAN = 'croissance';

const PLANS = {
  essentiel: {
    name: 'Essentiel',
    price: 149,
    priceEnv: 'STRIPE_PRICE_ESSENTIEL',
    tagline: 'Idéal pour 10–40 appels manqués par mois.',
    featured: false,
    monthlyConversations: 50,
  },
  croissance: {
    name: 'Croissance',
    price: 299,
    priceEnv: 'STRIPE_PRICE_CROISSANCE',
    tagline: 'Pour les commerces actifs — jusqu’à ~150 appels manqués / mois.',
    featured: true,
    monthlyConversations: 200,
  },
  pro: {
    name: 'Pro',
    price: 499,
    priceEnv: 'STRIPE_PRICE_PRO',
    tagline: 'Haut volume — multi-lignes ou très forte demande.',
    featured: false,
    monthlyConversations: 750,
  },
};

/** Anciens identifiants éventuels → nouveaux forfaits */
const PLAN_ALIASES = {
  starter: 'essentiel',
  business: 'pro',
  entreprise: 'pro',
};

function normalizePlan(plan) {
  if (!plan) return DEFAULT_PLAN;
  const key = PLAN_ALIASES[plan] || plan;
  if (PLANS[key]) return key;
  return DEFAULT_PLAN;
}

function planLabel(plan) {
  const p = PLANS[normalizePlan(plan)];
  return p ? p.name : PLANS[DEFAULT_PLAN].name;
}

function planPriceLabel(plan) {
  const p = PLANS[normalizePlan(plan)];
  return `${p.price} $ CAD`;
}

function recommendPlanKey(projectedMonthlyConversations) {
  const n = Math.max(0, Number(projectedMonthlyConversations) || 0);
  if (n <= PLANS.essentiel.monthlyConversations) return 'essentiel';
  if (n <= PLANS.croissance.monthlyConversations) return 'croissance';
  return 'pro';
}

function isTrialPlan(plan) {
  return normalizePlan(plan) === TRIAL_PLAN;
}

module.exports = {
  PLANS,
  TRIAL_PLAN,
  DEFAULT_PLAN,
  normalizePlan,
  isTrialPlan,
  planLabel,
  planPriceLabel,
  recommendPlanKey,
};
