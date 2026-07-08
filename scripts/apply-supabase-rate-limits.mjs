/**
 * Augmente les limites d'envoi de courriels Auth Supabase (tests + prod légère).
 * Prérequis: SUPABASE_ACCESS_TOKEN dans .env
 *
 * Usage: node scripts/apply-supabase-rate-limits.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'aynnqboglkgquyvzvoat';

function loadEnv() {
  const env = {};
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return env;
  readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  });
  return env;
}

async function main() {
  const token = loadEnv().SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error(`
❌ SUPABASE_ACCESS_TOKEN manquant dans .env

Option A — Dashboard (30 sec):
  https://supabase.com/dashboard/project/${PROJECT_REF}/auth/rate-limits
  → « Emails sent » : montez à 100 / heure

Option B — Automatique:
  1. https://supabase.com/dashboard/account/tokens
  2. Ajoutez SUPABASE_ACCESS_TOKEN=sbp_... dans .env
  3. Relancez ce script
`);
    process.exit(1);
  }

  const body = {
    rate_limit_email_sent: 100,
    smtp_max_frequency: 100,
    rate_limit_verify: 100,
    rate_limit_otp: 100,
  };

  console.log('⏳ Augmentation des limites courriel Auth...');

  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    console.error(`❌ Erreur (${res.status}):`, data.message || data.error || data);
    process.exit(1);
  }

  console.log(`
✅ Limites mises à jour (${PROJECT_REF})
  rate_limit_email_sent: 100 / heure
  smtp_max_frequency:    100

Réessayez l'inscription sur https://noviaai.ca/signup.html
`);
}

main().catch((e) => {
  console.error('❌', e.message || e);
  process.exit(1);
});
