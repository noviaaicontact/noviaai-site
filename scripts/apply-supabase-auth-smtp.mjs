/**
 * Configure Supabase Auth SMTP (Resend), email template et URLs via Management API.
 * Prérequis dans .env : SUPABASE_ACCESS_TOKEN, RESEND_API_KEY
 * Token : https://supabase.com/dashboard/account/tokens (permission auth_config_write)
 *
 * Usage: node scripts/apply-supabase-auth-smtp.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'aynnqboglkgquyvzvoat';
const SITE_URL = 'https://noviaai.ca';
const REDIRECT_URL = 'https://noviaai.ca/auth/callback.html';

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

function loadTemplate() {
  const path = join(root, 'supabase', 'email-template-confirm-signup.html');
  if (!existsSync(path)) throw new Error(`Template introuvable: ${path}`);
  return readFileSync(path, 'utf8');
}

async function main() {
  const env = loadEnv();
  const token = env.SUPABASE_ACCESS_TOKEN;
  const resendKey = env.RESEND_API_KEY;

  if (!token) {
    console.error(`
❌ SUPABASE_ACCESS_TOKEN manquant dans .env

Le plugin Supabase dans Cursor ne peut pas modifier SMTP / modèles de courriel.
Il faut un token personnel (1 minute) :

  1. Ouvrez https://supabase.com/dashboard/account/tokens
  2. Generate new token → cochez « auth_config_write » (ou accès projet complet)
  3. Ajoutez dans rattrapeur-sms/.env :
     SUPABASE_ACCESS_TOKEN=sbp_...

  4. Relancez : node scripts/apply-supabase-auth-smtp.mjs
`);
    process.exit(1);
  }

  if (!resendKey) {
    console.error('❌ RESEND_API_KEY manquante dans .env');
    process.exit(1);
  }

  const template = loadTemplate();
  const body = {
    external_email_enabled: true,
    mailer_autoconfirm: false,
    site_url: SITE_URL,
    uri_allow_list: `${SITE_URL}/**,${REDIRECT_URL},${SITE_URL}/auth/callback.html`,
    smtp_admin_email: 'onboarding@resend.dev',
    smtp_host: 'smtp.resend.com',
    smtp_port: '465',
    smtp_user: 'resend',
    smtp_pass: resendKey,
    smtp_sender_name: 'NoviaAI',
    mailer_subjects_confirmation: 'Confirmez votre compte NoviaAI',
    mailer_templates_confirmation_content: template,
    rate_limit_email_sent: 100,
    smtp_max_frequency: 100,
  };

  console.log('⏳ Configuration Auth Supabase (SMTP Resend + template + URLs)...');

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
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    console.error(`❌ Erreur API Supabase (${res.status}):`, data.message || data.error || data);
    if (res.status === 401 || res.status === 403) {
      console.error('\nVérifiez que le token a la permission auth_config_write.');
    }
    process.exit(1);
  }

  console.log(`
✅ Supabase Auth configuré pour ${PROJECT_REF}

  SMTP:      smtp.resend.com:465 (Resend)
  Expéditeur: NoviaAI <onboarding@resend.dev>
  Sujet:     Confirmez votre compte NoviaAI
  Site URL:  ${SITE_URL}
  Redirect:  ${REDIRECT_URL}

Testez : https://noviaai.ca/signup.html (fenêtre privée)
`);
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
