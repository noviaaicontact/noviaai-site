/**
 * Resend domain + Supabase email template (Management API).
 * Usage: node scripts/setup-resend-domain.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOMAIN = 'noviaai.ca';

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

async function resend(path, key, opts = {}) {
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
  const env = loadEnv();
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.error('❌ RESEND_API_KEY manquant');
    process.exit(1);
  }

  console.log(`\n🔍 Domaines Resend pour ${DOMAIN}...\n`);

  const list = await resend('/domains', key);
  if (!list.ok) {
    console.error('❌ Liste domaines:', list.data);
    process.exit(1);
  }

  let domain = (list.data?.data || []).find((d) => d.name === DOMAIN);

  if (!domain) {
    console.log(`⏳ Création du domaine ${DOMAIN}...`);
    const created = await resend('/domains', key, {
      method: 'POST',
      body: JSON.stringify({ name: DOMAIN }),
    });
    if (!created.ok) {
      console.error('❌ Création domaine:', created.data);
      process.exit(1);
    }
    domain = created.data;
    console.log('✅ Domaine créé');
  } else {
    console.log(`✅ Domaine trouvé — statut: ${domain.status}`);
  }

  const id = domain.id || domain.data?.id;
  if (id) {
    const detail = await resend(`/domains/${id}`, key);
    if (detail.ok) domain = detail.data;
  }

  const records = domain.records || [];
  if (records.length) {
    console.log('\n📋 Enregistrements DNS à ajouter chez votre registrar (noviaai.ca):\n');
    for (const r of records) {
      console.log(`  ${r.type}  ${r.name}  →  ${r.value}  (${r.status || 'pending'})`);
    }
  }

  console.log(`\nStatut vérification: ${domain.status || 'unknown'}`);
  if (domain.status === 'verified') {
    console.log('\n✅ Domaine vérifié — utilisez: NoviaAI <notifications@noviaai.ca>');
  } else {
    console.log('\n⚠️  Domaine non vérifié — les courriels vers aetienne511@gmail.com restent bloqués en mode test.');
    console.log('   En attendant, testez avec noviaai.contact@gmail.com');
  }
}

main().catch((e) => {
  console.error('❌', e.message || e);
  process.exit(1);
});
