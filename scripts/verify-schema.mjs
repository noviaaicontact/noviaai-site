/**
 * Vérifie que la base Supabase prod contient toutes les tables/colonnes requises.
 * Usage: node scripts/verify-schema.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPaths = [join(root, '.env'), join(root, '..', 'rattrapeur-sms', '.env')];

function loadEnv() {
  for (const p of envPaths) {
    if (!existsSync(p)) continue;
    readFileSync(p, 'utf8').split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i === -1) return;
      const k = t.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
    });
  }
}

const REQUIRED_TABLES = [
  'tenants', 'sms_messages', 'sms_threads', 'missed_calls', 'leads',
  'knowledge_sources', 'knowledge_chunks', 'conversation_events',
  'sms_opt_outs', 'rate_limits',
];

const REQUIRED_TENANT_COLUMNS = [
  'line_mode', 'hosted_status', 'widget_public_id', 'google_review_url',
  'terms_accepted_at', 'website_url', 'reservation_links', 'public_phone',
  'stripe_subscription_id', 'provisioning_status',
];

function ok(label, pass, hint) {
  console.log(`${pass ? '✅' : '❌'} ${label}${pass ? '' : ` — ${hint}`}`);
  return pass;
}

loadEnv();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('❌ SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };
let failed = 0;

console.log('\n🗄️  NoviaAI — vérification schéma Supabase\n');

const kbRes = await fetch(
  `${url}/rest/v1/rpc/match_knowledge_chunks`,
  {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ p_tenant_id: '00000000-0000-4000-8000-000000000001', p_query_embedding: Array(1536).fill(0), p_match_count: 1 }),
  },
);
const kbRpcOk = kbRes.status === 200 || kbRes.status === 204;

const { data: tenants, error: tErr } = await fetch(
  `${url}/rest/v1/tenants?select=*&limit=1`,
  { headers },
).then((r) => r.json().then((data) => ({ data, error: r.ok ? null : data })));

if (tErr || !tenants) {
  ok('Table tenants accessible', false, tErr?.message || 'table introuvable');
  process.exit(1);
}

ok('Table tenants accessible', true);

const row = tenants[0] || {};
for (const col of REQUIRED_TENANT_COLUMNS) {
  if (!ok(`Colonne tenants.${col}`, col in row, 'migration manquante — voir supabase/schema-v*.sql')) failed++;
}

for (const table of REQUIRED_TABLES) {
  const res = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, { headers });
  if (!ok(`Table ${table}`, res.ok || res.status === 200, `HTTP ${res.status}`)) failed++;
}

if (!ok('RPC match_knowledge_chunks (pgvector)', kbRpcOk, 'exécutez schema-v6-knowledge-base.sql')) failed++;

console.log(failed ? `\n❌ ${failed} problème(s) — appliquez les migrations manquantes.\n` : '\n✅ Schéma complet.\n');
process.exit(failed ? 1 : 0);
