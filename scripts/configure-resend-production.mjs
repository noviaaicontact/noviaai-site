/**
 * Configuration Resend production (domaine noviaai.ca).
 * Prérequis: clé API « Full access » dans .env comme RESEND_FULL_ACCESS_KEY
 * (la clé send-only actuelle ne peut pas gérer les domaines).
 *
 * Usage: node scripts/configure-resend-production.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = root;
const DOMAIN = 'noviaai.ca';
const FROM = 'NoviaAI <notifications@noviaai.ca>';

function loadEnv() {
  const env = {};
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return { env, envPath };
  const text = readFileSync(envPath, 'utf8');
  text.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  });
  return { env, envPath, text };
}

function setEnvKey(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (re.test(text)) return text.replace(re, line);
  return `${text.trimEnd()}\n${line}\n`;
}

async function resendApi(path, key, opts = {}) {
  const res = await fetch(`https://api.resend.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const { env, envPath, text: envText } = loadEnv();
  const sendKey = env.RESEND_API_KEY;
  const fullKey = env.RESEND_FULL_ACCESS_KEY || sendKey;

  if (!sendKey) {
    console.error('❌ RESEND_API_KEY manquant dans .env');
    process.exit(1);
  }

  console.log(`\n📧 Configuration Resend — ${DOMAIN}\n`);

  const list = await resendApi('/domains', fullKey);
  if (!list.ok) {
    if (list.data?.name === 'restricted_api_key') {
      console.log(`
⚠️  Votre clé Resend est « send only » — je ne peux pas ajouter le domaine via API.

FAITES CECI (5 min) :
  1. https://resend.com/api-keys → Create API Key → permission « Full access »
  2. Ajoutez dans .env : RESEND_FULL_ACCESS_KEY=re_...
  3. Relancez : node scripts/configure-resend-production.mjs

OU manuellement :
  1. https://resend.com/domains → Add domain → noviaai.ca
  2. Copiez les enregistrements DNS (DKIM, SPF, MX)
  3. Ajoutez-les chez votre registrar (Namecheap / registrar-servers.com)
  4. Cliquez Verify dans Resend
  5. Écrivez « domaine vérifié » dans Cursor
`);
      process.exit(1);
    }
    console.error('❌ API domaines:', list.data);
    process.exit(1);
  }

  let domain = (list.data?.data || []).find((d) => d.name === DOMAIN);
  if (!domain) {
    console.log(`⏳ Création domaine ${DOMAIN}...`);
    const created = await resendApi('/domains', fullKey, {
      method: 'POST',
      body: JSON.stringify({ name: DOMAIN }),
    });
    if (!created.ok) {
      console.error('❌ Création:', created.data);
      process.exit(1);
    }
    domain = created.data;
  }

  const id = domain.id || domain.data?.id;
  if (id) {
    const detail = await resendApi(`/domains/${id}`, fullKey);
    if (detail.ok) domain = detail.data;
  }

  const records = domain.records || [];
  if (records.length) {
    console.log('\n📋 DNS à ajouter chez votre registrar :\n');
    for (const r of records) {
      console.log(`  ${r.type}\t${r.name}\t${r.value}\t[${r.status || 'pending'}]`);
    }
  }

  const status = domain.status || 'unknown';
  console.log(`\nStatut domaine: ${status}`);

  if (status !== 'verified') {
    console.log('\n⚠️  Domaine pas encore vérifié — ajoutez les DNS ci-dessus puis Verify sur Resend.');
    console.log('   En attendant SIGNUP_AUTO_CONFIRM=true reste actif sur Netlify.\n');
    process.exit(0);
  }

  console.log('\n✅ Domaine vérifié — mise à jour expéditeur production...');

  let text = envText || readFileSync(envPath, 'utf8');
  text = setEnvKey(text, 'EMAIL_FROM', FROM);
  writeFileSync(envPath, text);

  const quoted = (v) => String(v).replace(/"/g, '\\"');
  execSync(`npx netlify-cli env:set EMAIL_FROM "${quoted(FROM)}"`, { stdio: 'inherit', cwd: siteDir, shell: true });
  execSync('npx netlify-cli env:set SIGNUP_AUTO_CONFIRM "false"', { stdio: 'inherit', cwd: siteDir, shell: true });

  console.log(`
✅ Production Resend configurée
  EMAIL_FROM: ${FROM}
  SIGNUP_AUTO_CONFIRM: false
  Redéployez Netlify si besoin.
`);
}

main().catch((e) => {
  console.error('❌', e.message || e);
  process.exit(1);
});
