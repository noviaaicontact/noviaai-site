const { getStripe } = require('../../lib/stripe');
const { getAdmin } = require('../../lib/db');
const { provisionTenant, suspendTenant } = require('../../lib/provision');

exports.handler = async (event) => {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return { statusCode: 500, body: 'Stripe webhook non configuré' };
  }

  let rawBody = event.body || '';
  if (event.isBase64Encoded) rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error('webhook sig', err.message);
    return { statusCode: 400, body: 'Signature invalide' };
  }

  const db = getAdmin();
  if (!db) return { statusCode: 500, body: 'DB non configurée' };

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const tenantId = session.metadata && session.metadata.tenant_id;
        if (tenantId) {
          await db.from('tenants').update({
            subscription_status: 'active',
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            plan: (session.metadata && session.metadata.plan) || 'pro',
          }).eq('id', tenantId);
          await provisionTenant(tenantId);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object;
        const status = sub.status === 'active' ? 'active'
          : sub.status === 'trialing' ? 'trialing'
          : sub.status === 'canceled' ? 'canceled' : 'inactive';
        const { data: tenants } = await db.from('tenants').update({
          subscription_status: status,
          stripe_subscription_id: sub.id,
        }).eq('stripe_customer_id', sub.customer).select('id');
        if (status === 'active' && tenants && tenants[0]) {
          await provisionTenant(tenants[0].id);
        }
        if (['canceled', 'inactive'].includes(status) && tenants && tenants[0]) {
          await suspendTenant(tenants[0].id);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object;
        const { data: tenants } = await db.from('tenants').update({
          subscription_status: 'canceled',
        }).eq('stripe_customer_id', sub.customer).select('id');
        if (tenants && tenants[0]) await suspendTenant(tenants[0].id);
        break;
      }
      case 'invoice.paid': {
        const invoice = stripeEvent.data.object;
        if (!invoice.subscription) break;
        const { data: tenants } = await db.from('tenants').update({
          subscription_status: 'active',
        }).eq('stripe_customer_id', invoice.customer).select('id');
        if (tenants && tenants[0]) await provisionTenant(tenants[0].id);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        const { data: tenants } = await db.from('tenants').update({
          subscription_status: 'inactive',
        }).eq('stripe_customer_id', invoice.customer).select('id');
        if (tenants && tenants[0]) await suspendTenant(tenants[0].id);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error('webhook handler', e);
    return { statusCode: 500, body: 'Erreur traitement' };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
