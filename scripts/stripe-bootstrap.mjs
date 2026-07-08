/**
 * Crée les 3 produits/forfaits NoviaAI dans Stripe (mode test ou live selon la clé)
 * et met à jour STRIPE_PRICE_* dans .env
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

const PLANS = [
  { key: 'STRIPE_PRICE_STARTER', name: 'NoviaAI Essentiel', amount: 14900, plan: 'starter' },
  { key: 'STRIPE_PRICE_PRO', name: 'NoviaAI Pro', amount: 29900, plan: 'pro' },
  { key: 'STRIPE_PRICE_BUSINESS', name: 'NoviaAI Entreprise', amount: 49900, plan: 'business' },
];

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error('❌ .env manquant — copiez .env.example vers .env');
    process.exit(1);
  }
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

function setEnvKey(envText, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(envText)) return envText.replace(re, `${key}=${value}`);
  return envText.trimEnd() + `\n${key}=${value}\n`;
}

async function findOrCreatePrice(stripe, { name, amount, plan }) {
  const products = await stripe.products.search({
    query: `active:'true' AND metadata['novia_plan']:'${plan}'`,
  });
  let product = products.data[0];
  if (!product) {
    product = await stripe.products.create({
      name,
      metadata: { novia_plan: plan },
    });
    console.log(`  + Produit créé: ${name} (${product.id})`);
  } else {
    console.log(`  ✓ Produit existant: ${name} (${product.id})`);
  }

  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 20 });
  const match = prices.data.find(
    (p) => p.unit_amount === amount && p.currency === 'cad' && p.recurring?.interval === 'month',
  );
  if (match) {
    console.log(`  ✓ Prix existant: ${match.id} (${amount / 100} CAD/mois)`);
    return match.id;
  }

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: amount,
    currency: 'cad',
    recurring: { interval: 'month' },
    metadata: { novia_plan: plan },
  });
  console.log(`  + Prix créé: ${price.id} (${amount / 100} CAD/mois)`);
  return price.id;
}

const env = loadEnv();
const secret = env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error('❌ STRIPE_SECRET_KEY manquante dans .env');
  process.exit(1);
}

const mode = secret.startsWith('sk_live_') ? 'LIVE' : 'TEST';
console.log(`\n💳 Stripe bootstrap (${mode})\n`);

const stripe = new Stripe(secret);
const priceIds = {};

for (const plan of PLANS) {
  console.log(`\n${plan.name}:`);
  priceIds[plan.key] = await findOrCreatePrice(stripe, plan);
}

let envText = readFileSync(envPath, 'utf8');
for (const [key, value] of Object.entries(priceIds)) {
  envText = setEnvKey(envText, key, value);
}
writeFileSync(envPath, envText, 'utf8');

console.log('\n✅ .env mis à jour avec les Price ID');
console.log('\nWebhook (local) — installez Stripe CLI puis :');
console.log('  stripe listen --forward-to http://localhost:8888/.netlify/functions/api-stripe-webhook');
console.log('  → copiez whsec_... dans STRIPE_WEBHOOK_SECRET\n');
