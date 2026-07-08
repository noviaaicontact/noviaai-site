/**
 * Copie STRIPE_WEBHOOK_SECRET du .env local vers Netlify (site noviaai.ca).
 * Usage: node scripts/sync-webhook-secret-netlify.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const siteDir = join(root, '..', 'noviaai-site');

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

const secret = env.STRIPE_WEBHOOK_SECRET;
if (!secret) {
  console.error('❌ STRIPE_WEBHOOK_SECRET manquant — lancez d\'abord:');
  console.error('   node scripts/stripe-webhook-setup.mjs --create --url https://noviaai.ca');
  process.exit(1);
}

console.log('\n📤 Mise à jour STRIPE_WEBHOOK_SECRET sur Netlify…\n');
execFileSync(
  'npx',
  ['netlify-cli', 'env:set', 'STRIPE_WEBHOOK_SECRET', secret],
  { stdio: 'inherit', shell: true, cwd: siteDir },
);
console.log('\n✅ Terminé — Netlify redéploiera automatiquement.\n');
