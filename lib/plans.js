/** Forfaits NoviaAI — prix CAD / mois, limites en conversations distinctes. */
const DEFAULT_PLAN = 'croissance';

const PLANS = {
  essentiel: {
    name: 'Essentiel',
    price: 149,
    priceEnv: 'STRIPE_PRICE_ESSENTIEL',
    tagline: 'Pour les petites entreprises qui reçoivent un faible volume de demandes.',
    featured: false,
    monthlyConversations: 100,
  },
  croissance: {
    name: 'Croissance',
    price: 299,
    priceEnv: 'STRIPE_PRICE_CROISSANCE',
    tagline: 'Pour les entreprises qui reçoivent un volume régulier de demandes.',
    featured: true,
    monthlyConversations: 300,
  },
  pro: {
    name: 'Pro',
    price: 499,
    priceEnv: 'STRIPE_PRICE_PRO',
    tagline: 'Pour les entreprises qui reçoivent un volume élevé de demandes.',
    featured: false,
    monthlyConversations: 1000,
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

module.exports = {
  PLANS,
  DEFAULT_PLAN,
  normalizePlan,
  planLabel,
  planPriceLabel,
  recommendPlanKey,
};
