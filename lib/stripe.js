const Stripe = require('stripe');
const { PLANS, DEFAULT_PLAN, normalizePlan } = require('./plans');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2024-06-20' });
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

  const checkoutApiVersion = '2025-04-30.basil';
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    payment_method_types: ['card'],
    excluded_payment_method_types: ['klarna', 'affirm', 'afterpay_clearpay'],
    wallet_options: {
      link: { display: 'never' },
    },
    subscription_data: {
      trial_period_days: tenant.stripe_subscription_id ? 0 : 14,
      metadata: { tenant_id: tenant.id, plan },
    },
    metadata: { tenant_id: tenant.id, plan },
  }, { apiVersion: checkoutApiVersion });

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
