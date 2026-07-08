/**
 * Configure le webhook Stripe pour NoviaAI Rattrapeur.
 *
 * Usage:
 *   node scripts/stripe-webhook-setup.mjs              # liste les endpoints existants
 *   node scripts/stripe-webhook-setup.mjs --create     # crée l'endpoint (PUBLIC_BASE_URL)
 *   node scripts/stripe-webhook-setup.mjs --url https://mon-app.netlify.app
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
];

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error('❌ .env manquant');
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

function webhookUrl(base) {
  return `${base.replace(/\/$/, '')}/.netlify/functions/api-stripe-webhook`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const create = args.includes('--create');
  const urlIdx = args.indexOf('--url');
  const url = urlIdx !== -1 ? args[urlIdx + 1] : null;
  return { create, url };
}

const env = loadEnv();
const secret = env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error('❌ STRIPE_SECRET_KEY manquante dans .env');
  process.exit(1);
}

const { create, url: urlArg } = parseArgs();
const baseUrl = urlArg || env.PUBLIC_BASE_URL || '';
const targetUrl = baseUrl ? webhookUrl(baseUrl) : '';
const isLocal = /localhost|127\.0\.0\.1/.test(baseUrl);

const stripe = new Stripe(secret);
const mode = secret.startsWith('sk_live_') ? 'LIVE' : 'TEST';

console.log(`\n🔗 Stripe webhook setup (${mode})\n`);

const existing = await stripe.webhookEndpoints.list({ limit: 20 });

if (existing.data.length) {
  console.log('Endpoints existants :\n');
  for (const ep of existing.data) {
    console.log(`  • ${ep.url}`);
    console.log(`    id: ${ep.id} | status: ${ep.status}`);
    console.log(`    events: ${ep.enabled_events.join(', ')}\n`);
  }
} else {
  console.log('Aucun endpoint webhook configuré.\n');
}

if (!create) {
  if (env.STRIPE_WEBHOOK_SECRET) {
    console.log('✅ STRIPE_WEBHOOK_SECRET déjà présent dans .env');
  } else {
    console.log('⚠️  STRIPE_WEBHOOK_SECRET vide dans .env');
  }
  if (isLocal) {
    console.log('\n📍 Mode local détecté (localhost) — Stripe ne peut pas appeler localhost directement.');
    console.log('\nOption A — Stripe CLI (recommandé en dev) :');
    console.log('  stripe listen --forward-to http://localhost:8888/.netlify/functions/api-stripe-webhook');
    console.log('  → copiez whsec_... dans STRIPE_WEBHOOK_SECRET\n');
    console.log('Option B — Déployez sur Netlify puis :');
    console.log('  node scripts/stripe-webhook-setup.mjs --create --url https://VOTRE-APP.netlify.app\n');
  } else if (targetUrl) {
    console.log(`Pour créer l'endpoint vers ${targetUrl} :`);
    console.log('  node scripts/stripe-webhook-setup.mjs --create\n');
  }
  process.exit(0);
}

if (!targetUrl) {
  console.error('❌ URL manquante. Définissez PUBLIC_BASE_URL ou passez --url https://...');
  process.exit(1);
}

if (isLocal) {
  console.error('❌ Impossible de créer un webhook Stripe vers localhost.');
  console.error('   Utilisez "stripe listen" en local, ou --url avec votre URL Netlify.');
  process.exit(1);
}

const duplicate = existing.data.find((ep) => ep.url === targetUrl);
if (duplicate) {
  console.log(`✓ Endpoint déjà configuré : ${targetUrl}`);
  console.log(`  id: ${duplicate.id}`);
  if (env.STRIPE_WEBHOOK_SECRET) {
    console.log('\n✅ STRIPE_WEBHOOK_SECRET déjà dans .env');
  } else {
    console.log('\n⚠️  Le secret signing (whsec_...) n\'est visible qu\'à la création.');
    console.log('   Dashboard → Developers → Webhooks → cliquez l\'endpoint → Signing secret → Reveal');
    console.log(`   ${mode === 'TEST' ? 'https://dashboard.stripe.com/test/webhooks' : 'https://dashboard.stripe.com/webhooks'}`);
  }
  process.exit(0);
}

console.log(`Création de l'endpoint → ${targetUrl}\n`);
const endpoint = await stripe.webhookEndpoints.create({
  url: targetUrl,
  enabled_events: EVENTS,
  description: 'NoviaAI Rattrapeur — activation abonnements',
});

let envText = readFileSync(envPath, 'utf8');
envText = setEnvKey(envText, 'STRIPE_WEBHOOK_SECRET', endpoint.secret);
writeFileSync(envPath, envText, 'utf8');

console.log('✅ Webhook créé');
console.log(`   id: ${endpoint.id}`);
console.log(`   events: ${EVENTS.join(', ')}`);
console.log('\n✅ STRIPE_WEBHOOK_SECRET enregistré dans .env');
console.log('\nProchaine étape : redéployez Netlify si vous avez changé .env en production.');
