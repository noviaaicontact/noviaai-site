/**
 * Désactive Link, Klarna et autres BNPL sur la config Stripe par défaut.
 * Usage: node scripts/stripe-checkout-card-only.mjs
 * Requiert STRIPE_SECRET_KEY dans .env (ou variable d'environnement).
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

function loadEnv() {
  if (process.env.STRIPE_SECRET_KEY) return;
  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;
    readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i === -1) return;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    });
    if (process.env.STRIPE_SECRET_KEY) return;
  }
}

const OFF = { display_preference: { preference: 'off' } };
const METHODS_TO_DISABLE = [
  'klarna',
  'affirm',
  'afterpay_clearpay',
  'link',
  'amazon_pay',
  'cashapp',
  'paypal',
  'zip',
];

loadEnv();
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('❌ STRIPE_SECRET_KEY manquante — ajoutez-la dans .env');
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: '2025-04-30.basil' });
const mode = key.startsWith('sk_live_') ? 'LIVE' : 'TEST';

const patch = {};
for (const method of METHODS_TO_DISABLE) patch[method] = OFF;

const { data: configs } = await stripe.paymentMethodConfigurations.list({ limit: 20 });
if (!configs.length) {
  console.error('❌ Aucune payment_method_configuration trouvée');
  process.exit(1);
}

const target = configs.find((c) => c.is_default) || configs[0];
console.log(`\n💳 Stripe (${mode}) — config: ${target.id}${target.is_default ? ' (défaut)' : ''}\n`);

const updated = await stripe.paymentMethodConfigurations.update(target.id, patch);
console.log('✅ Désactivé sur le dashboard Stripe :');
for (const method of METHODS_TO_DISABLE) {
  const pref = updated[method]?.display_preference?.preference || '—';
  console.log(`   ${method}: ${pref}`);
}
console.log('\nCarte (card) reste disponible pour Checkout.\n');
