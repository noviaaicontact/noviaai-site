const Stripe = require('stripe');
const { PLANS, DEFAULT_PLAN, normalizePlan, TRIAL_PLAN, isTrialPlan } = require('./plans');

/** API requise pour wallet_options.link.display */
const CHECKOUT_API_VERSION = '2025-04-30.basil';

/** BNPL / wallets à exclure — ne pas passer payment_method_types (conflit dynamic methods). */
const EXCLUDED_CHECKOUT_METHODS = [
  'klarna',
  'affirm',
  'afterpay_clearpay',
];

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: CHECKOUT_API_VERSION });
}

function priceIdForPlan(plan) {
  const p = PLANS[normalizePlan(plan)] || PLANS[DEFAULT_PLAN];
  return process.env[p.priceEnv] || '';
}

/**
 * Jours d'essai Stripe restants.
 * Uniquement pour Essentiel — Croissance / Pro facturent dès l'activation.
 * 0 si l'essai local est déjà consommé/expiré.
 */
function stripeTrialDays(tenant, plan) {
  if (!isTrialPlan(plan || TRIAL_PLAN)) return 0;
  if (!tenant || tenant.stripe_subscription_id) return 0;
  if (['inactive', 'canceled', 'past_due', 'active'].includes(tenant.subscription_status)) return 0;
  if (!tenant.trial_ends_at) return 0;
  const leftMs = new Date(tenant.trial_ends_at).getTime() - Date.now();
  const leftDays = Math.ceil(leftMs / 86400000);
  if (leftDays <= 0) return 0;
  return Math.min(14, leftDays);
}

async function createCheckoutSession({ tenant, plan, successUrl, cancelUrl }) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe non configuré');
  const normalized = normalizePlan(plan);
  const price = priceIdForPlan(normalized);
  if (!price) throw new Error('Price ID Stripe manquant pour le forfait ' + normalized);

  let customerId = tenant.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: tenant.email,
      metadata: { tenant_id: tenant.id },
    });
    customerId = customer.id;
  }

  const trialDays = stripeTrialDays(tenant, normalized);
  const params = {
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    excluded_payment_method_types: EXCLUDED_CHECKOUT_METHODS,
    wallet_options: {
      link: { display: 'never' },
    },
    // Stripe Tax (TPS/TVQ…) — ne collecte que si une inscription fiscale
    // active existe dans le Dashboard (Tax → Registrations).
    automatic_tax: { enabled: true },
    // Adresse entrée au checkout prime sur l'adresse client sauvegardée.
    customer_update: { address: 'auto', name: 'auto' },
    tax_id_collection: { enabled: true },
    // Champ « Ajouter un code promo » sur la page Checkout Stripe
    allow_promotion_codes: true,
    subscription_data: {
      // Essai Stripe seulement pour Essentiel + jours locaux restants.
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
      metadata: { tenant_id: tenant.id, plan: normalized },
    },
    metadata: { tenant_id: tenant.id, plan: normalized },
  };

  if (process.env.STRIPE_PMC_CHECKOUT) {
    params.payment_method_configuration = process.env.STRIPE_PMC_CHECKOUT;
  }

  const session = await stripe.checkout.sessions.create(params);

  return { url: session.url, customerId };
}

/** Checkout : lier le customer Stripe, jamais plan ni subscription_status. */
function dbPatchAfterCheckoutCreate(tenant, customerId) {
  const patch = { updated_at: new Date().toISOString() };
  if (customerId && tenant && customerId !== tenant.stripe_customer_id) {
    patch.stripe_customer_id = customerId;
  }
  return patch;
}

function tenantPatchFromCheckoutSession(session, extras = {}) {
  const patch = {
    stripe_customer_id: session.customer,
    stripe_subscription_id: session.subscription,
    plan: normalizePlan((session.metadata && session.metadata.plan) || 'croissance'),
  };
  if (extras.subscriptionStatus) patch.subscription_status = extras.subscriptionStatus;
  if (extras.trialEnds) patch.trial_ends_at = extras.trialEnds;
  return patch;
}

async function createPortalSession(customerId, returnUrl) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe non configuré');
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

module.exports = {
  getStripe,
  createCheckoutSession,
  createPortalSession,
  dbPatchAfterCheckoutCreate,
  tenantPatchFromCheckoutSession,
  PLANS,
  priceIdForPlan,
};
