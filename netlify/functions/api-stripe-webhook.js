const { getStripe, createPortalSession, tenantPatchFromCheckoutSession } = require('../../lib/stripe');
const { getAdmin } = require('../../lib/db');
const { provisionTenant, suspendTenant } = require('../../lib/provision');
const { sendTrialEndingEmail, sendPaymentFailedEmail, sendPaymentReceiptEmail } = require('../../lib/email');
const { planLabel, planPriceLabel, normalizePlan } = require('../../lib/plans');
const { getUsageSnapshot } = require('../../lib/usage-limits');

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
    .select('id, business_name, email, contact_email, trial_ends_at, stripe_customer_id, plan, created_at, subscription_status')
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

function amountLabelFromInvoice(invoice, plan) {
  if (invoice && invoice.amount_due != null) {
    const dollars = (Number(invoice.amount_due) / 100).toFixed(0);
    const currency = String(invoice.currency || 'cad').toUpperCase();
    return `${dollars} $ ${currency}`;
  }
  return planPriceLabel(plan);
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
          let trialEnds = null;
          if (session.subscription) {
            try {
              const sub = await stripe.subscriptions.retrieve(session.subscription);
              subStatus = statusFromSub(sub);
              trialEnds = trialEndsFromSub(sub);
            } catch (e) {
              console.warn('webhook subscription retrieve', e.message);
            }
          }
          const patch = tenantPatchFromCheckoutSession(session, {
            subscriptionStatus: subStatus,
            trialEnds,
          });
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
          .eq('stripe_customer_id', invoice.customer)
          .select('id, business_name, email, contact_email, trial_ends_at, stripe_customer_id, plan');
        if (['active', 'trialing'].includes(status) && tenants && tenants[0]) {
          await provisionTenant(tenants[0].id);
        }
        // Reçu client seulement si un vrai montant a été prélevé (pas la facture 0 $ d'essai).
        if (tenants && tenants[0] && Number(invoice.amount_paid) > 0) {
          try {
            const portalUrl = await portalLinkForCustomer(invoice.customer);
            const paidCents = Number(invoice.amount_paid);
            const currency = String(invoice.currency || 'cad').toUpperCase();
            const amountLabel = `${(paidCents / 100).toFixed(paidCents % 100 ? 2 : 0)} $ ${currency}`;
            let periodLabel = '';
            if (invoice.lines?.data?.[0]?.period) {
              const p = invoice.lines.data[0].period;
              const a = new Date(p.start * 1000).toLocaleDateString('fr-CA', { timeZone: 'America/Toronto' });
              const b = new Date(p.end * 1000).toLocaleDateString('fr-CA', { timeZone: 'America/Toronto' });
              periodLabel = `${a} → ${b}`;
            }
            await sendPaymentReceiptEmail(tenants[0], {
              amountLabel,
              portalUrl,
              invoiceUrl: invoice.hosted_invoice_url || invoice.invoice_pdf || '',
              periodLabel,
              planLabel: planLabel(tenants[0].plan),
            });
          } catch (e) {
            console.warn('invoice.paid receipt email', e.message);
          }
        }
        break;
      }
      case 'invoice.payment_failed': {
        // Grace period : marque inactive mais NE libère PAS le numéro Twilio.
        // Le numéro n'est libéré qu'à la résiliation (subscription.deleted / canceled).
        const invoice = stripeEvent.data.object;
        const { data: tenants } = await db.from('tenants').update({
          subscription_status: 'inactive',
        }).eq('stripe_customer_id', invoice.customer).select('id, business_name, email, contact_email, trial_ends_at, stripe_customer_id, plan');
        if (tenants && tenants[0]) {
          await suspendTenant(tenants[0].id, { release: false });
          try {
            const portalUrl = await portalLinkForCustomer(invoice.customer);
            await sendPaymentFailedEmail(tenants[0], {
              portalUrl,
              amountLabel: amountLabelFromInvoice(invoice, tenants[0].plan),
              planLabel: planLabel(tenants[0].plan),
            });
          } catch (e) {
            console.warn('payment_failed email', e.message);
          }
          try {
            const { notifyAdminClientError } = require('../../lib/admin-alert');
            await notifyAdminClientError({
              area: 'paiement',
              error: 'Échec de paiement Stripe — compte suspendu (numéro conservé)',
              tenant: tenants[0],
              extra: {
                invoice: invoice.id,
                amount: amountLabelFromInvoice(invoice, tenants[0].plan),
                plan: planLabel(tenants[0].plan),
              },
              maxPerHour: 5,
            });
          } catch (e) {
            console.warn('payment_failed admin alert', e.message);
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
          const usage = await getUsageSnapshot({
            ...tenant,
            trial_ends_at: trialEnds || tenant.trial_ends_at,
            subscription_status: 'trialing',
          });
          const reco = usage.recommendation;
          const recommendedKey = normalizePlan(reco.plan);
          await sendTrialEndingEmail(
            { ...tenant, trial_ends_at: trialEnds || tenant.trial_ends_at },
            {
              trialEndsAt: trialEnds || tenant.trial_ends_at,
              portalUrl,
              amountLabel: planPriceLabel(recommendedKey),
              planLabel: planLabel(recommendedKey),
              recommendationHtml:
                `<p style="background:#f4f7fb;border-radius:8px;padding:12px 14px;line-height:1.45">${reco.message}</p>`,
            },
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
