/**
 * Applique template + SMTP + limites via Supabase Management API.
 * Prérequis: SUPABASE_ACCESS_TOKEN + RESEND_API_KEY dans .env
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
  return readFileSync(path, 'utf8').trim();
}

async function patchAuth(token, body) {
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
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const env = loadEnv();
  const token = env.SUPABASE_ACCESS_TOKEN;
  const resendKey = env.RESEND_API_KEY;
  if (!token) {
    console.error('❌ SUPABASE_ACCESS_TOKEN manquant dans .env');
    process.exit(1);
  }
  if (!resendKey) {
    console.error('❌ RESEND_API_KEY manquant');
    process.exit(1);
  }

  const fromEmail = env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] || 'onboarding@resend.dev';
  const template = loadTemplate();

  console.log('⏳ Supabase: template + SMTP + limites...');

  const body = {
    external_email_enabled: true,
    mailer_autoconfirm: false,
    site_url: SITE_URL,
    uri_allow_list: `${SITE_URL}/**,${REDIRECT_URL}`,
    smtp_admin_email: fromEmail,
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

  const result = await patchAuth(token, body);
  if (!result.ok) {
    console.error(`❌ Erreur Supabase (${result.status}):`, result.data.message || result.data);
    process.exit(1);
  }

  console.log(`
✅ Supabase Auth mis à jour
  Template:  corrigé (sans parenthèses CSS)
  SMTP:      ${fromEmail}
  Limite:    100 courriels/heure
`);
}

main().catch((e) => {
  console.error('❌', e.message || e);
  process.exit(1);
});
