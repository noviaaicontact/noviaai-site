/**
 * Affiche les variables Netlify à copier (valeurs lues depuis .env local).
 * Usage: node scripts/export-netlify-env.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (!existsSync(envPath)) {
  console.error('❌ .env manquant');
  process.exit(1);
}

const keys = [
  'OPENAI_API_KEY', 'OPENAI_MODEL',
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_BUSINESS',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_DEFAULT_AREA_CODE', 'TWILIO_AUTO_PROVISION',
  'RESEND_API_KEY', 'EMAIL_FROM', 'ADMIN_EMAIL',
  'PUBLIC_BASE_URL', 'ADMIN_SECRET',
];

const env = {};
readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const i = t.indexOf('=');
  if (i === -1) return;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
});

console.log('\n📋 Variables à coller dans Netlify → Environment variables\n');
console.log('─'.repeat(50));
for (const k of keys) {
  const v = env[k] || '';
  const missing = !v ? '  ← MANQUANT' : '';
  console.log(`${k}=${v}${missing}`);
}
console.log('─'.repeat(50));
console.log('\n⚠️  Production: PUBLIC_BASE_URL=https://noviaai.ca');
console.log('    Puis: node scripts/configure-production.mjs');
console.log('    Stripe: npm run stripe:webhook:create -- --url https://noviaai.ca\n');
