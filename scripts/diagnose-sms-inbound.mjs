/**
 * Diagnose inbound SMS (no reply) — webhooks, trial limits, recent DB logs.
 * Usage: node scripts/diagnose-sms-inbound.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const env = {};
  const envPath = join(root, '.env');
  if (existsSync(envPath)) {
    readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i === -1) return;
      env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    });
  }
  const credPath = join(root, 'compte twilio.txt');
  if (existsSync(credPath)) {
    readFileSync(credPath, 'utf8').split(/\r?\n/).forEach((line) => {
      const l = line.trim();
      if (/account SID/i.test(l)) env.TWILIO_ACCOUNT_SID = l.split(';').pop().trim();
      if (/auth token/i.test(l)) env.TWILIO_AUTH_TOKEN = l.split(';').pop().trim();
    });
  }
  return env;
}

async function main() {
  const env = loadEnv();
  console.log('\n=== Diagnostic SMS entrant NoviaAI ===\n');

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    console.log('❌ Credentials Twilio manquants');
    return;
  }

  const twilio = (await import('twilio')).default;
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const expected = 'https://noviaai.ca/.netlify/functions/sms';

  const acct = await client.api.accounts(env.TWILIO_ACCOUNT_SID).fetch();
  console.log('Compte Twilio:', acct.type);
  if (acct.type === 'Trial') {
    console.log('⚠️  TRIAL — les réponses SMS partent SEULEMENT vers les numéros vérifiés Twilio');
  }

  console.log('\n--- Numéros Twilio ---');
  const nums = await client.incomingPhoneNumbers.list({ limit: 20 });
  for (const n of nums) {
    const smsOk = n.smsUrl === expected;
    console.log(`\n${n.phoneNumber} (${n.friendlyName || 'sans nom'})`);
    console.log(smsOk ? '✅' : '❌', 'SMS URL:', n.smsUrl || 'NON CONFIGURÉ');
    if (!smsOk) console.log('   → Attendu:', expected);
    console.log('   Voice:', n.voiceUrl || 'NON CONFIGURÉ');
  }

  console.log('\n--- Numéros vérifiés (trial) ---');
  try {
    const verified = await client.outgoingCallerIds.list({ limit: 20 });
    if (!verified.length) console.log('❌ Aucun numéro vérifié');
    else verified.forEach((v) => console.log('✅', v.phoneNumber));
  } catch (e) {
    console.log('Verified IDs:', e.message);
  }

  console.log('\n--- Derniers SMS entrant PAR numéro NoviaAI ---');
  for (const n of nums) {
    const toMsgs = await client.messages.list({ to: n.phoneNumber, limit: 5 });
    console.log(`\n→ ${n.phoneNumber}:`);
    if (!toMsgs.length) console.log('   (aucun SMS entrant récent côté Twilio)');
    else toMsgs.forEach((m) => console.log(`   ${m.dateCreated} | de ${m.from} | ${(m.body || '').slice(0, 45)}`));
  }

  console.log('\n--- Erreurs SMS récentes ---');
  const errors = (await client.messages.list({ limit: 30 })).filter((m) => m.errorCode);
  if (!errors.length) console.log('Aucune erreur récente');
  else errors.slice(0, 8).forEach((m) => {
    console.log(`${m.dateCreated} | ${m.from} → ${m.to} | ${m.errorCode} ${m.errorMessage}`);
  });

  console.log('\n--- Derniers SMS Twilio (inbound au numéro) ---');
  const inbound = await client.messages.list({ limit: 15 });
  inbound
    .filter((m) => m.direction === 'inbound')
    .slice(0, 8)
    .forEach((m) => {
      console.log(`${m.dateCreated} | de ${m.from} → ${m.to} | ${(m.body || '').slice(0, 40)}`);
    });

  console.log('\n--- Derniers SMS sortants (réponses) ---');
  const outbound = await client.messages.list({ limit: 15 });
  outbound
    .filter((m) => m.direction === 'outbound-api' || m.direction === 'outbound-reply')
    .slice(0, 8)
    .forEach((m) => {
      console.log(`${m.dateCreated} | ${m.from} → ${m.to} | ${m.status} | ${(m.body || '').slice(0, 40)}`);
      if (m.errorCode) console.log(`   ⚠️ Erreur ${m.errorCode}: ${m.errorMessage}`);
    });

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: msgs } = await db
      .from('sms_messages')
      .select('caller_phone, direction, body, created_at, tenant_id')
      .order('created_at', { ascending: false })
      .limit(10);
    console.log('\n--- Derniers SMS en base Supabase ---');
    (msgs || []).forEach((m) => {
      console.log(`${m.created_at} | ${m.direction} | ${m.caller_phone} | ${(m.body || '').slice(0, 50)}`);
    });
  } else {
    console.log('\n⏭️  Supabase non configuré localement — logs DB ignorés');
  }

  console.log('\n=== Causes fréquentes si pas de réponse ===');
  console.log('1. smsUrl incorrect → node scripts/sync-all-twilio-webhooks.mjs');
  console.log('2. Signature Twilio rejetée (403) → PUBLIC_BASE_URL=https://noviaai.ca sur Netlify');
  console.log('3. Compte trial + numéro expéditeur non vérifié');
  console.log('4. Client a répondu ARRET (opt-out)\n');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
