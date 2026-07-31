/**
 * Sync SMS + Voice webhooks for every Twilio number linked to a tenant.
 * Usage:
 *   node scripts/sync-all-twilio-webhooks.mjs
 *   node scripts/sync-all-twilio-webhooks.mjs https://noviaai.ca
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.argv[2] || 'https://noviaai.ca').replace(/\/$/, '');
const SMS_URL = `${base}/.netlify/functions/sms`;
const VOICE_URL = `${base}/.netlify/functions/voice`;

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
  if (existsSync(credPath) && (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN)) {
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
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing (.env or compte twilio.txt)');
  }

  const twilio = (await import('twilio')).default;
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

  const acct = await client.api.accounts(env.TWILIO_ACCOUNT_SID).fetch();
  console.log('\n=== Twilio account ===');
  console.log('Type:', acct.type);
  if (acct.type === 'Trial') {
    console.log('⚠️  Trial: outbound SMS only to Verified Caller IDs');
    console.log('   https://console.twilio.com/us1/develop/phone-numbers/manage/verified');
  }

  const sids = new Set();
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: tenants } = await db
      .from('tenants')
      .select('business_name, twilio_number, twilio_sid')
      .not('twilio_sid', 'is', null);
    (tenants || []).forEach((t) => {
      if (t.twilio_sid) sids.add(t.twilio_sid);
      console.log(`Tenant: ${t.business_name} → ${t.twilio_number} (${t.twilio_sid})`);
    });
  }

  const all = await client.incomingPhoneNumbers.list({ limit: 50 });
  all.forEach((n) => sids.add(n.sid));

  console.log('\n=== Webhook sync →', base, '===\n');
  for (const sid of sids) {
    const before = await client.incomingPhoneNumbers(sid).fetch();
    const needsUpdate = before.smsUrl !== SMS_URL || before.voiceUrl !== VOICE_URL;
    if (!needsUpdate) {
      console.log(`✅ ${before.phoneNumber} — already OK`);
      continue;
    }
    const updated = await client.incomingPhoneNumbers(sid).update({
      smsUrl: SMS_URL,
      smsMethod: 'POST',
      voiceUrl: VOICE_URL,
      voiceMethod: 'POST',
    });
    console.log(`🔧 ${updated.phoneNumber}`);
    console.log('   SMS  :', updated.smsUrl);
    console.log('   Voice:', updated.voiceUrl);
  }

  console.log('\n✅ Done. Set PUBLIC_BASE_URL=' + base + ' on Netlify if not already.\n');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
