/**
 * Prépare Stripe Tax pour les 3 forfaits NoviaAI (produit SaaS + prix tax_behavior).
 *
 * Le Checkout a déjà automatic_tax: enabled. Pour que la TPS/TVQ soit
 * réellement collectée, il faut AUSSI dans le Dashboard (mode Live) :
 *   1. Tax → Settings → adresse du siège (head office)
 *   2. Tax → Registrations → ajouter Canada (TPS/TVH) et Québec (TVQ)
 *      si vous êtes déjà inscrits auprès de l'ARC / Revenu Québec
 *
 *   node scripts/stripe-setup-tax.mjs
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

/** SaaS — usage professionnel (clients PME). */
const TAX_CODE_SAAS_BUSINESS = 'txcd_10103001';

const PLANS = [
  { key: 'STRIPE_PRICE_ESSENTIEL', plan: 'essentiel' },
  { key: 'STRIPE_PRICE_CROISSANCE', plan: 'croissance' },
  { key: 'STRIPE_PRICE_PRO', plan: 'pro' },
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
    return { env, envPath };
  }
  return { env: {}, envPath: envPaths[0] };
}

function setEnvKey(envText, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(envText)) return envText.replace(re, `${key}=${value}`);
  return `${envText.trimEnd()}\n${key}=${value}\n`;
}

const { env, envPath } = loadEnv();
const secret = env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error('❌ STRIPE_SECRET_KEY manquante');
  process.exit(1);
}

const stripe = new Stripe(secret, { apiVersion: '2025-04-30.basil' });

console.log('\n🧾 Stripe Tax — setup produits/prix\n');

/** Retrouve le prix actif du forfait, via .env puis via les metadata Stripe. */
async function resolvePrice({ key, plan }) {
  const fromEnv = env[key];
  if (fromEnv) {
    try {
      const price = await stripe.prices.retrieve(fromEnv);
      if (price.active) return price;
      console.log(`  ~ ${key} pointe vers un prix archivé (${fromEnv})`);
    } catch {
      console.log(`  ~ ${key} introuvable dans Stripe (${fromEnv})`);
    }
  }
  const search = await stripe.prices.search({
    query: `active:'true' AND metadata['novia_plan']:'${plan}'`,
  });
  return search.data[0] || null;
}

const resolved = {};

for (const entry of PLANS) {
  console.log(`\n${entry.plan}:`);
  const price = await resolvePrice(entry);
  if (!price) {
    console.error(`  ❌ Aucun prix actif — lancez d'abord: npm run stripe:bootstrap`);
    continue;
  }
  resolved[entry.key] = price.id;

  const productId = typeof price.product === 'string' ? price.product : price.product.id;
  await stripe.products.update(productId, { tax_code: TAX_CODE_SAAS_BUSINESS });
  console.log(`  ✓ Produit ${productId} → tax_code ${TAX_CODE_SAAS_BUSINESS} (SaaS business)`);

  if (price.tax_behavior === 'exclusive' || price.tax_behavior === 'inclusive') {
    console.log(`  ✓ Prix ${price.id} tax_behavior déjà = ${price.tax_behavior}`);
    continue;
  }

  try {
    await stripe.prices.update(price.id, { tax_behavior: 'exclusive' });
    console.log(`  ✓ Prix ${price.id} → tax_behavior exclusive`);
  } catch (e) {
    // tax_behavior n'est plus modifiable une fois fixé ; on crée un prix exclusif.
    const created = await stripe.prices.create({
      product: productId,
      unit_amount: price.unit_amount,
      currency: price.currency,
      recurring: price.recurring ? { interval: price.recurring.interval } : undefined,
      tax_behavior: 'exclusive',
      metadata: { ...(price.metadata || {}), novia_plan: entry.plan, replaces: price.id },
    });
    await stripe.prices.update(price.id, { active: false });
    resolved[entry.key] = created.id;
    console.log(`  + Nouveau prix exclusive: ${created.id} (ancien désactivé — ${e.message})`);
  }
}

let envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
for (const [key, value] of Object.entries(resolved)) {
  envText = setEnvKey(envText, key, value);
}
writeFileSync(envPath, envText, 'utf8');
console.log(`\n✓ .env mis à jour (${envPath})`);

for (const [key, value] of Object.entries(resolved)) {
  try {
    execFileSync('npx', ['netlify-cli', 'env:set', key, value], {
      stdio: 'inherit',
      shell: true,
      cwd: root,
    });
  } catch {
    console.warn(`⚠️  Sync Netlify échouée — lancez: npx netlify-cli env:set ${key} ${value}`);
  }
}

try {
  const settings = await stripe.tax.settings.retrieve();
  console.log(`\nTax settings status: ${settings.status}`);
  if (settings.status !== 'active') {
    console.log('→ manquant:', JSON.stringify(settings.status_details || {}));
  }
  const regs = await stripe.tax.registrations.list({ limit: 20 });
  console.log(`Inscriptions fiscales: ${regs.data.length}`);
} catch (e) {
  console.warn('Tax settings:', e.message);
}

console.log(`
Prochaines étapes Dashboard (obligatoire pour collecter vraiment) :
  1. https://dashboard.stripe.com/settings/tax  (mode Live)
  2. Ajouter l'adresse du siège (head office) — Québec
  3. https://dashboard.stripe.com/tax/registrations
     → Canada (GST/HST) et Québec (QST) si vous êtes inscrits
  4. Redéployer Netlify si un prix a changé

Checkout: automatic_tax déjà activé dans lib/stripe.js
`);
