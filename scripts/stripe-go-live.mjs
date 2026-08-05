/**
 * Passe NoviaAI en Stripe LIVE : prix 199$, webhook noviaai.ca, Klarna/Link off, sync Netlify.
 *
 * Prérequis : STRIPE_SECRET_KEY=sk_live_... dans rattrapeur-sms/.env (ou noviaai-site/.env)
 *
 * Usage:
 *   node scripts/stripe-go-live.mjs
 *   node scripts/stripe-go-live.mjs --url https://noviaai.ca
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
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

const OFF = { display_preference: { preference: 'off' } };
const METHODS_TO_DISABLE = ['klarna', 'affirm', 'afterpay_clearpay', 'link'];

function loadEnvFile() {
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
    return { env, envPath };
  }
  return { env: {}, envPath: envPaths[0] };
}

function setEnvKey(envText, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(envText)) return envText.replace(re, `${key}=${value}`);
  return `${envText.trimEnd()}\n${key}=${value}\n`;
}

function webhookUrl(base) {
  return `${base.replace(/\/$/, '')}/.netlify/functions/api-stripe-webhook`;
}

async function findOrCreateProPrice(stripe) {
  const amount = 19900;
  const plan = 'pro';
  const name = 'NoviaAI Pro';

  const products = await stripe.products.search({
    query: `active:'true' AND metadata['novia_plan']:'${plan}'`,
  });
  let product = products.data[0];
  if (!product) {
    product = await stripe.products.create({ name, metadata: { novia_plan: plan } });
    console.log(`  + Produit live créé: ${product.id}`);
  } else {
    console.log(`  ✓ Produit live: ${product.id}`);
  }

  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 20 });
  const match = prices.data.find(
    (p) => p.unit_amount === amount && p.currency === 'cad' && p.recurring?.interval === 'month',
  );
  if (match) {
    console.log(`  ✓ Prix live: ${match.id} (199 CAD/mois)`);
    return match.id;
  }

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: amount,
    currency: 'cad',
    recurring: { interval: 'month' },
    metadata: { novia_plan: plan },
  });
  console.log(`  + Prix live créé: ${price.id} (199 CAD/mois)`);
  return price.id;
}

async function ensureWebhook(stripe, targetUrl) {
  const existing = await stripe.webhookEndpoints.list({ limit: 20 });
  const duplicate = existing.data.find((ep) => ep.url === targetUrl);
  if (duplicate) {
    console.log(`  ✓ Webhook live déjà présent: ${duplicate.id}`);
    return null;
  }

  const endpoint = await stripe.webhookEndpoints.create({
    url: targetUrl,
    enabled_events: EVENTS,
    description: 'NoviaAI — abonnements live',
  });
  console.log(`  + Webhook live créé: ${endpoint.id}`);
  return endpoint.secret;
}

async function disableBnpl(stripe) {
  const { data: configs } = await stripe.paymentMethodConfigurations.list({ limit: 20 });
  if (!configs.length) return null;
  const target = configs.find((c) => c.is_default) || configs[0];
  const patch = {};
  for (const method of METHODS_TO_DISABLE) {
    if (target[method] != null) patch[method] = OFF;
  }
  if (!Object.keys(patch).length) return target.id;
  await stripe.paymentMethodConfigurations.update(target.id, patch);
  console.log(`  ✓ Klarna / Link désactivés (config ${target.id})`);
  return target.id;
}

function syncNetlify(vars) {
  console.log('\n📤 Sync Netlify…');
  for (const [key, value] of Object.entries(vars)) {
    if (!value) continue;
    execFileSync('npx', ['netlify-cli', 'env:set', key, value], {
      stdio: 'inherit',
      shell: true,
      cwd: root,
    });
  }
}

const baseUrl = (process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : null) || 'https://noviaai.ca';

const { env, envPath } = loadEnvFile();
const secret = env.STRIPE_SECRET_KEY;

if (!secret) {
  console.error('\n❌ STRIPE_SECRET_KEY manquante.');
  console.error('   1. Ouvrez https://dashboard.stripe.com/apikeys (mode Live, pas Test)');
  console.error('   2. Créez / révélez la clé secrète sk_live_...');
  console.error(`   3. Collez-la dans ${envPath}`);
  console.error('   4. Relancez: npm run stripe:go-live\n');
  process.exit(1);
}

if (!secret.startsWith('sk_live_')) {
  console.error('\n❌ La clé actuelle est en mode TEST (sk_test_...).');
  console.error('   Remplacez STRIPE_SECRET_KEY par sk_live_... dans votre .env');
  console.error('   Dashboard → bascule « Mode test » OFF → Developers → API keys\n');
  process.exit(1);
}

console.log('\n🚀 Stripe LIVE — NoviaAI\n');
console.log('URL:', baseUrl);

const stripe = new Stripe(secret, { apiVersion: '2025-04-30.basil' });

try {
  const account = await stripe.accounts.retrieve();
  console.log(`\nCompte: ${account.settings?.dashboard?.display_name || account.id}`);
  if (!account.charges_enabled) {
    console.warn('\n⚠️  charges_enabled=false — terminez l\'activation du compte Stripe (identité + banque).');
  }
} catch (e) {
  console.warn('⚠️  Impossible de lire le compte:', e.message);
}

console.log('\n1) Prix Pro 199 CAD/mois');
const pricePro = await findOrCreateProPrice(stripe);

console.log('\n2) Webhook live');
const targetUrl = webhookUrl(baseUrl);
const webhookSecret = await ensureWebhook(stripe, targetUrl);

console.log('\n3) Moyens de paiement (carte seulement)');
const pmcId = await disableBnpl(stripe);

let envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
envText = setEnvKey(envText, 'STRIPE_SECRET_KEY', secret);
envText = setEnvKey(envText, 'STRIPE_PRICE_PRO', pricePro);
envText = setEnvKey(envText, 'PUBLIC_BASE_URL', baseUrl);
if (webhookSecret) envText = setEnvKey(envText, 'STRIPE_WEBHOOK_SECRET', webhookSecret);
if (pmcId) envText = setEnvKey(envText, 'STRIPE_PMC_CHECKOUT', pmcId);
writeFileSync(envPath, envText, 'utf8');
console.log(`\n✅ .env mis à jour (${envPath})`);

const netlifyVars = {
  STRIPE_SECRET_KEY: secret,
  STRIPE_PRICE_PRO: pricePro,
  PUBLIC_BASE_URL: baseUrl,
};
if (webhookSecret) netlifyVars.STRIPE_WEBHOOK_SECRET = webhookSecret;
if (pmcId) netlifyVars.STRIPE_PMC_CHECKOUT = pmcId;
syncNetlify(netlifyVars);

console.log('\n✅ Stripe LIVE configuré.');
console.log('   • Plus de bandeau « Bac à sable » au checkout');
console.log('   • Paiements réels sur votre compte bancaire');
if (!webhookSecret) {
  console.log('\n⚠️  Webhook déjà existant — si STRIPE_WEBHOOK_SECRET manque sur Netlify:');
  console.log('   Dashboard → Developers → Webhooks → Signing secret → Reveal');
  console.log('   puis: npx netlify-cli env:set STRIPE_WEBHOOK_SECRET whsec_...\n');
} else {
  console.log('\nNetlify redéploie automatiquement (~2 min).\n');
}
