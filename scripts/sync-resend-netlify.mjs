/**
 * Copie RESEND_API_KEY (+ EMAIL_FROM optionnel) du .env local vers Netlify.
 * Usage: node scripts/sync-resend-netlify.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

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

const key = env.RESEND_API_KEY;
if (!key) {
  console.error('❌ RESEND_API_KEY manquant dans .env');
  console.error('\n1. Créez un compte sur https://resend.com');
  console.error('2. API Keys → Create API Key');
  console.error('3. Ajoutez dans .env: RESEND_API_KEY=re_...');
  console.error('4. Relancez ce script\n');
  process.exit(1);
}

function netlifyEnvSet(name, value) {
  const quoted = String(value).replace(/"/g, '\\"');
  execSync(`npx netlify-cli env:set ${name} "${quoted}"`, {
    stdio: 'inherit',
    cwd: siteDir,
    shell: true,
  });
}

console.log('\n📤 Mise à jour Resend sur Netlify…\n');
netlifyEnvSet('RESEND_API_KEY', key);

if (env.EMAIL_FROM) {
  netlifyEnvSet('EMAIL_FROM', env.EMAIL_FROM);
}

console.log('\n✅ Terminé — les courriels (bienvenue, leads, appels manqués) seront actifs.\n');
