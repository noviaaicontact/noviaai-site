/**
 * Met à jour les événements écoutés par le webhook live noviaai.ca
 * (ajoute trial_will_end si manquant).
 *
 *   node scripts/stripe-sync-webhook-events.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPaths = [
  join(root, '.env'),
  join(root, '..', 'rattrapeur-sms', '.env'),
];

const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
];

function loadEnv() {
  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;
    const env = {};
    readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i === -1) return;
      env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    });
    return env;
  }
  return {};
}

const env = loadEnv();
const secret = env.STRIPE_SECRET_KEY;
if (!secret?.startsWith('sk_live_') && !secret?.startsWith('sk_test_')) {
  console.error('❌ STRIPE_SECRET_KEY manquante');
  process.exit(1);
}

const stripe = new Stripe(secret, { apiVersion: '2025-04-30.basil' });
const targetUrl = 'https://noviaai.ca/.netlify/functions/api-stripe-webhook';

const { data } = await stripe.webhookEndpoints.list({ limit: 20 });
const ep = data.find((e) => e.url === targetUrl);
if (!ep) {
  console.error('❌ Webhook noviaai.ca introuvable — lancez npm run stripe:go-live');
  process.exit(1);
}

await stripe.webhookEndpoints.update(ep.id, { enabled_events: EVENTS });
console.log(`✅ Webhook ${ep.id} mis à jour`);
console.log('Événements :');
EVENTS.forEach((e) => console.log('  •', e));
console.log('\nAussi (Dashboard, mode Live) :');
console.log('  https://dashboard.stripe.com/settings/billing/automatic');
console.log('  → activer : trial ending, upcoming invoice, failed payment, receipts');
