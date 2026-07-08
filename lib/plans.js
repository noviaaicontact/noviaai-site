/** Forfait unique au lancement — tout est inclus dans Pro */
const DEFAULT_PLAN = 'pro';

const PLANS = {
  pro: {
    name: 'Pro',
    price: 299,
    priceEnv: 'STRIPE_PRICE_PRO',
    tagline: 'Accès complet — ligne, SMS IA, inbox, leads et analytics',
    featured: true,
  },
};

function normalizePlan(plan) {
  if (plan && PLANS[plan]) return plan;
  return DEFAULT_PLAN;
}

module.exports = { PLANS, DEFAULT_PLAN, normalizePlan };
