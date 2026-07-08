/**
 * Envoie un événement webhook signé vers le serveur local (sans Stripe CLI).
 *
 * Prérequis:
 *   1. STRIPE_WEBHOOK_SECRET dans .env (ex. whsec_local_dev_noviaai)
 *   2. npm run dev  (Netlify sur http://localhost:8888)
 *
 * Usage:
 *   node scripts/stripe-webhook-test.mjs
 *   node scripts/stripe-webhook-test.mjs --tenant-id UUID --plan pro
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

function loadEnv() {
  readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i === -1) return;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  });
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

if (!existsSync(envPath)) {
  console.error('❌ .env manquant');
  process.exit(1);
}
loadEnv();

const secret = process.env.STRIPE_WEBHOOK_SECRET;
if (!secret) {
  console.error('❌ STRIPE_WEBHOOK_SECRET manquant dans .env');
  process.exit(1);
}

const tenantId = arg('--tenant-id', '00000000-0000-4000-8000-000000000001');
const plan = arg('--plan', 'pro');
const base = (process.env.PUBLIC_BASE_URL || 'http://localhost:8888').replace(/\/$/, '');
const target = `${base}/.netlify/functions/api-stripe-webhook`;

const event = {
  id: 'evt_test_webhook',
  object: 'event',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_webhook',
      object: 'checkout.session',
      customer: 'cus_test_webhook',
      subscription: 'sub_test_webhook',
      metadata: { tenant_id: tenantId, plan },
    },
  },
};

const payload = JSON.stringify(event);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });

console.log(`\n🧪 Test webhook → ${target}`);
console.log(`   tenant: ${tenantId} | plan: ${plan}\n`);

const res = await fetch(target, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'stripe-signature': signature,
  },
  body: payload,
});

const body = await res.text();
console.log(`Réponse: ${res.status} ${body}`);

if (res.ok) {
  console.log('\n✅ Webhook accepté — vérifiez subscription_status du tenant dans Supabase.');
} else {
  console.log('\n❌ Échec — assurez-vous que "npm run dev" tourne sur le port 8888.');
  process.exit(1);
}
