const Stripe = require('stripe');
const { PLANS, DEFAULT_PLAN, normalizePlan } = require('./plans');

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

async function createCheckoutSession({ tenant, plan, successUrl, cancelUrl }) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe non configuré');
  const price = priceIdForPlan(plan);
  if (!price) throw new Error('Price ID Stripe manquant pour le forfait ' + plan);

  let customerId = tenant.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: tenant.email,
      metadata: { tenant_id: tenant.id },
    });
    customerId = customer.id;
  }

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
    subscription_data: {
      trial_period_days: tenant.stripe_subscription_id ? 0 : 14,
      metadata: { tenant_id: tenant.id, plan },
    },
    metadata: { tenant_id: tenant.id, plan },
  };

  if (process.env.STRIPE_PMC_CHECKOUT) {
    params.payment_method_configuration = process.env.STRIPE_PMC_CHECKOUT;
  }

  const session = await stripe.checkout.sessions.create(params);

  return { url: session.url, customerId };
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

module.exports = { getStripe, createCheckoutSession, createPortalSession, PLANS, priceIdForPlan };
