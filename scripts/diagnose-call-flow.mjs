/**
 * Diagnostic appels manqués / SMS — usage: node scripts/diagnose-call-flow.mjs
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

function loadEnv() {
  const env = {};
  readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i === -1) return;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  });
  return env;
}

const env = loadEnv();
const TWILIO_NUM = '+18722535474';
const TWILIO_SID = 'PN265f2f951c2493da0c6c452cbe6a2b08';

async function main() {
  console.log('\n=== Diagnostic NoviaAI — flux appel manqué ===\n');

  const checks = [];
  checks.push(['PUBLIC_BASE_URL', !!env.PUBLIC_BASE_URL, env.PUBLIC_BASE_URL || 'MANQUANT']);
  checks.push(['TWILIO_ACCOUNT_SID', !!env.TWILIO_ACCOUNT_SID]);
  checks.push(['TWILIO_AUTH_TOKEN', !!env.TWILIO_AUTH_TOKEN]);
  checks.push(['SUPABASE_URL', !!env.SUPABASE_URL]);
  checks.push(['SUPABASE_SERVICE_ROLE_KEY', !!env.SUPABASE_SERVICE_ROLE_KEY]);

  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ': ' + detail : ''}`);
  }

  // Local server
  try {
    const r = await fetch('http://127.0.0.1:8888/index.html');
    console.log(r.ok ? '✅ Serveur local :8888 actif' : `❌ Serveur local répond ${r.status}`);
  } catch {
    console.log('❌ Serveur local :8888 INACTIF — lancez npm run test:twilio');
  }

  // Twilio number webhooks
  const twilio = (await import('twilio')).default;
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const num = await client.incomingPhoneNumbers(TWILIO_SID).fetch();
  console.log('\n--- Numéro Twilio ---');
  console.log('Numéro  :', num.phoneNumber);
  console.log('Voice URL:', num.voiceUrl || 'NON CONFIGURÉ');
  console.log('SMS URL  :', num.smsUrl || 'NON CONFIGURÉ');

  const voiceOk = num.voiceUrl && !num.voiceUrl.includes('localhost');
  if (!num.voiceUrl) console.log('❌ voiceUrl vide');
  else if (num.voiceUrl.includes('localhost')) console.log('❌ voiceUrl pointe localhost — Twilio ne peut pas l\'atteindre');
  else console.log('✅ voiceUrl est une URL publique');

  // Test voice webhook (local)
  console.log('\n--- Test voice.js local ---');
  const body = new URLSearchParams({
    From: '+14185551234',
    To: TWILIO_NUM,
    CallSid: 'CA_test_diagnose',
  });
  try {
    const vr = await fetch('http://127.0.0.1:8888/.netlify/functions/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const xml = await vr.text();
    console.log('Status:', vr.status);
    console.log('Réponse:', xml.slice(0, 200));
    if (xml.includes('Hangup')) console.log('✅ voice.js répond (SMS déclenché côté serveur)');
    else console.log('⚠️ Réponse TwiML inattendue');
  } catch (e) {
    console.log('❌ Impossible de tester voice.js:', e.message);
  }

  // Supabase tenant
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: tenants, error } = await db
      .from('tenants')
      .select('id, business_name, twilio_number, existing_business_number, phone_forward, provisioning_status, subscription_status, missed_call_sms')
      .eq('twilio_number', TWILIO_NUM);
    console.log('\n--- Tenant Supabase (twilio_number match) ---');
    if (error) console.log('❌', error.message);
    else if (!tenants?.length) {
      console.log('❌ Aucun tenant avec twilio_number', TWILIO_NUM);
      const { data: all } = await db.from('tenants').select('business_name, twilio_number, provisioning_status').limit(5);
      console.log('Tenants existants:', all);
    } else {
      tenants.forEach((t) => {
        console.log('✅ Tenant:', t.business_name);
        console.log('   twilio_number:', t.twilio_number);
        console.log('   public phone:', t.existing_business_number || t.phone_forward);
        console.log('   status:', t.provisioning_status, '| sub:', t.subscription_status);
        console.log('   missed_call_sms:', (t.missed_call_sms || '').slice(0, 60) + '…');
      });
    }
  }

  // Trial account check
  try {
    const acct = await client.api.accounts(env.TWILIO_ACCOUNT_SID).fetch();
    console.log('\n--- Compte Twilio ---');
    console.log('Type:', acct.type);
    if (acct.type === 'Trial') {
      console.log('⚠️  COMPTE TRIAL: SMS sortants seulement vers numéros vérifiés');
      console.log('   → console.twilio.com → Phone Numbers → Verified Caller IDs');
    }
  } catch (e) {
    console.log('Compte Twilio:', e.message);
  }

  console.log('\n=== Fin diagnostic ===\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
