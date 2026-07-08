import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error('❌ Fichier .env manquant. Copiez .env.example vers .env');
    process.exit(1);
  }
  readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i === -1) return;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  });
}

function ok(label, pass, hint) {
  console.log(`${pass ? '✅' : '❌'} ${label}${pass ? '' : ` — ${hint}`}`);
  return pass;
}

async function testSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/rest/v1/tenants?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.status === 404 || res.status === 406) return false;
    return res.ok || res.status === 200;
  } catch {
    return false;
  }
}

async function testStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return false;
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(key);
    await stripe.products.list({ limit: 1 });
    return true;
  } catch {
    return false;
  }
}

async function testOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.startsWith('sk-...')) return false;
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

loadEnv();

const checks = [
  ['OpenAI (IA SMS)', !!process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('...'), 'Clé sur platform.openai.com'],
  ['Supabase URL', !!process.env.SUPABASE_URL, 'Project Settings → API'],
  ['Supabase anon key', !!process.env.SUPABASE_ANON_KEY, 'Project Settings → API'],
  ['Supabase service role', !!process.env.SUPABASE_SERVICE_ROLE_KEY, 'Project Settings → API (secret)'],
  ['Stripe secret', !!process.env.STRIPE_SECRET_KEY, 'dashboard.stripe.com → Developers'],
  ['Stripe webhook secret', !!process.env.STRIPE_WEBHOOK_SECRET, 'stripe listen (local) ou Dashboard → Webhooks'],
  ['Stripe price Starter', !!process.env.STRIPE_PRICE_STARTER, 'npm run stripe:bootstrap'],
  ['Stripe price Pro', !!process.env.STRIPE_PRICE_PRO, 'npm run stripe:bootstrap'],
  ['Stripe price Business', !!process.env.STRIPE_PRICE_BUSINESS, 'npm run stripe:bootstrap'],
  ['Twilio SID', !!process.env.TWILIO_ACCOUNT_SID, 'console.twilio.com'],
  ['Twilio auth token', !!process.env.TWILIO_AUTH_TOKEN, 'console.twilio.com'],
  ['Resend API', !!process.env.RESEND_API_KEY, 'resend.com → API Keys'],
  ['PUBLIC_BASE_URL', !!process.env.PUBLIC_BASE_URL, 'http://localhost:8888 en local'],
];

console.log('\n🔧 NoviaAI Rattrapeur — vérification setup\n');
let score = 0;
for (const [label, pass, hint] of checks) {
  if (ok(label, pass, hint)) score++;
}

console.log('\n🔗 Tests de connexion…\n');
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const dbOk = await testSupabase();
  ok('Supabase DB (table tenants)', dbOk, 'Exécutez supabase/schema.sql dans SQL Editor');
  if (dbOk) score++;
}
if (process.env.STRIPE_SECRET_KEY) {
  const stripeOk = await testStripe();
  ok('Stripe API', stripeOk, 'Clé invalide ou expirée');
  if (stripeOk) score++;
}
if (process.env.OPENAI_API_KEY) {
  const aiOk = await testOpenAI();
  ok('OpenAI API', aiOk, 'Clé invalide ou expirée');
  if (aiOk) score++;
}

console.log(`\n📊 Score: ${score}/${checks.length + 3} (approx.)`);
console.log('\nProchaines étapes:');
if (!process.env.SUPABASE_URL) console.log('  1. Créer projet Supabase → coller clés dans .env → exécuter schema.sql');
else if (!(await testSupabase())) console.log('  1. Exécuter supabase/schema.sql dans Supabase SQL Editor');
else if (!process.env.STRIPE_PRICE_STARTER) console.log('  2. npm run stripe:bootstrap  puis configurer webhook (stripe listen)');
else if (!process.env.STRIPE_WEBHOOK_SECRET) console.log('  2. Webhook: stripe listen --forward-to http://localhost:8888/.netlify/functions/api-stripe-webhook');
else if (!process.env.STRIPE_SECRET_KEY) console.log('  2. Configurer Stripe (3 produits + clés)');
else if (!process.env.TWILIO_ACCOUNT_SID) console.log('  3. Configurer Twilio (~20$ crédit)');
else console.log('  → Lancez: npm run dev  puis ouvrez http://localhost:8888/setup.html');
console.log('');
