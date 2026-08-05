const { getStripe, createPortalSession } = require('../../lib/stripe');
const { getAdmin } = require('../../lib/db');
const { provisionTenant, suspendTenant } = require('../../lib/provision');
const { sendTrialEndingEmail, sendPaymentFailedEmail } = require('../../lib/email');

function trialEndsFromSub(sub) {
  if (!sub || !sub.trial_end) return null;
  return new Date(sub.trial_end * 1000).toISOString();
}

function statusFromSub(sub) {
  if (!sub) return 'active';
  if (sub.status === 'trialing') return 'trialing';
  if (sub.status === 'active') return 'active';
  if (sub.status === 'canceled') return 'canceled';
  return 'inactive';
}

async function tenantByCustomer(db, customerId) {
  if (!customerId) return null;
  const { data } = await db.from('tenants')
    .select('id, business_name, email, contact_email, trial_ends_at, stripe_customer_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return data || null;
}

async function portalLinkForCustomer(customerId) {
  const base = (process.env.PUBLIC_BASE_URL || 'https://noviaai.ca').replace(/\/$/, '');
  try {
    return await createPortalSession(customerId, `${base}/dashboard.html`);
  } catch (e) {
    console.warn('portal session email', e.message);
    return `${base}/dashboard.html`;
  }
}

function amountLabelFromInvoice(invoice) {
  if (!invoice || invoice.amount_due == null) return '199 $ CAD';
  const dollars = (Number(invoice.amount_due) / 100).toFixed(0);
  const currency = String(invoice.currency || 'cad').toUpperCase();
  return `${dollars} $ ${currency}`;
}

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
          let subStatus = 'active';
          const patch = {
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            plan: (session.metadata && session.metadata.plan) || 'pro',
          };
          if (session.subscription) {
            try {
              const sub = await stripe.subscriptions.retrieve(session.subscription);
              subStatus = statusFromSub(sub);
              const trialEnds = trialEndsFromSub(sub);
              if (trialEnds) patch.trial_ends_at = trialEnds;
            } catch (e) {
              console.warn('webhook subscription retrieve', e.message);
            }
          }
          patch.subscription_status = subStatus;
          await db.from('tenants').update(patch).eq('id', tenantId);
          await provisionTenant(tenantId);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object;
        const status = statusFromSub(sub);
        const patch = {
          subscription_status: status,
          stripe_subscription_id: sub.id,
        };
        const trialEnds = trialEndsFromSub(sub);
        if (trialEnds) patch.trial_ends_at = trialEnds;
        else if (status === 'active') patch.trial_ends_at = null;

        const { data: tenants } = await db.from('tenants').update(patch)
          .eq('stripe_customer_id', sub.customer).select('id');
        if (['active', 'trialing'].includes(status) && tenants && tenants[0]) {
          await provisionTenant(tenants[0].id);
        }
        if (status === 'canceled' && tenants && tenants[0]) {
          // Résiliation réelle → libérer le numéro
          await suspendTenant(tenants[0].id, { release: true });
        } else if (status === 'inactive' && tenants && tenants[0]) {
          // Pause / past_due → garder la ligne (grace)
          await suspendTenant(tenants[0].id, { release: false });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object;
        const { data: tenants } = await db.from('tenants').update({
          subscription_status: 'canceled',
        }).eq('stripe_customer_id', sub.customer).select('id');
        if (tenants && tenants[0]) await suspendTenant(tenants[0].id, { release: true });
        break;
      }
      case 'invoice.paid': {
        // Ne pas forcer "active" : une facture 0 $ pendant l'essai doit rester "trialing"
        const invoice = stripeEvent.data.object;
        if (!invoice.subscription) break;
        let sub;
        try {
          sub = await stripe.subscriptions.retrieve(invoice.subscription);
        } catch (e) {
          console.warn('invoice.paid retrieve sub', e.message);
          break;
        }
        const status = statusFromSub(sub);
        const patch = { subscription_status: status };
        const trialEnds = trialEndsFromSub(sub);
        if (trialEnds) patch.trial_ends_at = trialEnds;
        else if (status === 'active') patch.trial_ends_at = null;

        const { data: tenants } = await db.from('tenants').update(patch)
          .eq('stripe_customer_id', invoice.customer).select('id');
        if (['active', 'trialing'].includes(status) && tenants && tenants[0]) {
          await provisionTenant(tenants[0].id);
        }
        break;
      }
      case 'invoice.payment_failed': {
        // Grace period : marque inactive mais NE libère PAS le numéro Twilio.
        // Le numéro n'est libéré qu'à la résiliation (subscription.deleted / canceled).
        const invoice = stripeEvent.data.object;
        const { data: tenants } = await db.from('tenants').update({
          subscription_status: 'inactive',
        }).eq('stripe_customer_id', invoice.customer).select('id, business_name, email, contact_email, trial_ends_at, stripe_customer_id');
        if (tenants && tenants[0]) {
          await suspendTenant(tenants[0].id, { release: false });
          try {
            const portalUrl = await portalLinkForCustomer(invoice.customer);
            await sendPaymentFailedEmail(tenants[0], {
              portalUrl,
              amountLabel: amountLabelFromInvoice(invoice),
            });
          } catch (e) {
            console.warn('payment_failed email', e.message);
          }
        }
        break;
      }
      case 'customer.subscription.trial_will_end': {
        // Stripe envoie cet événement ~3 jours avant la fin de l'essai.
        const sub = stripeEvent.data.object;
        const tenant = await tenantByCustomer(db, sub.customer);
        if (!tenant) break;
        const trialEnds = trialEndsFromSub(sub);
        if (trialEnds) {
          await db.from('tenants').update({ trial_ends_at: trialEnds }).eq('id', tenant.id);
        }
        try {
          const portalUrl = await portalLinkForCustomer(sub.customer);
          await sendTrialEndingEmail(
            { ...tenant, trial_ends_at: trialEnds || tenant.trial_ends_at },
            { trialEndsAt: trialEnds || tenant.trial_ends_at, portalUrl, amountLabel: '199 $ CAD' },
          );
        } catch (e) {
          console.warn('trial_will_end email', e.message);
        }
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
