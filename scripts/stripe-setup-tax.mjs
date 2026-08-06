/**
 * Prépare Stripe Tax pour NoviaAI (produit SaaS + prix tax_behavior).
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
const priceId = env.STRIPE_PRICE_PRO;
if (!priceId) {
  console.error('❌ STRIPE_PRICE_PRO manquant');
  process.exit(1);
}

console.log('\n🧾 Stripe Tax — setup produit/prix\n');

const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
const productId = typeof price.product === 'string' ? price.product : price.product.id;

await stripe.products.update(productId, { tax_code: TAX_CODE_SAAS_BUSINESS });
console.log(`✓ Produit ${productId} → tax_code ${TAX_CODE_SAAS_BUSINESS} (SaaS business)`);

let nextPriceId = priceId;
if (price.tax_behavior === 'exclusive' || price.tax_behavior === 'inclusive') {
  console.log(`✓ Prix ${priceId} tax_behavior déjà = ${price.tax_behavior}`);
} else {
  // tax_behavior n'est pas modifiable une fois fixé ; on crée un prix exclusif.
  const created = await stripe.prices.create({
    product: productId,
    unit_amount: price.unit_amount,
    currency: price.currency,
    recurring: price.recurring ? { interval: price.recurring.interval } : undefined,
    tax_behavior: 'exclusive',
    metadata: { ...(price.metadata || {}), novia_plan: 'pro', replaces: priceId },
  });
  await stripe.prices.update(priceId, { active: false });
  nextPriceId = created.id;
  console.log(`✓ Nouveau prix exclusive: ${nextPriceId} (ancien désactivé)`);

  let envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  envText = setEnvKey(envText, 'STRIPE_PRICE_PRO', nextPriceId);
  writeFileSync(envPath, envText, 'utf8');
  console.log(`✓ .env mis à jour (${envPath})`);

  try {
    execFileSync('npx', ['netlify-cli', 'env:set', 'STRIPE_PRICE_PRO', nextPriceId], {
      stdio: 'inherit',
      shell: true,
      cwd: root,
    });
  } catch (e) {
    console.warn('⚠️  Sync Netlify échouée — lancez: npx netlify-cli env:set STRIPE_PRICE_PRO', nextPriceId);
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
  4. Redéployer Netlify si le prix a changé

Checkout: automatic_tax déjà activé dans lib/stripe.js
`);
