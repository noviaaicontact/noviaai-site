/**
 * Lie le numéro Twilio trial existant au tenant et configure les webhooks.
 * Usage: node scripts/link-existing-twilio.mjs
 *        node scripts/link-existing-twilio.mjs --email vous@commerce.com
 *        node scripts/link-existing-twilio.mjs --webhooks-only
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

const EXISTING_PHONE = '+18722535474';
const EXISTING_SID = 'PN265f2f951c2493da0c6c452cbe6a2b08';

function loadEnv() {
  const env = {};
  if (!existsSync(envPath)) throw new Error('.env introuvable');
  readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i === -1) return;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  });
  return env;
}

function setEnvBaseUrl(url) {
  let content = readFileSync(envPath, 'utf8');
  const line = `PUBLIC_BASE_URL=${url.replace(/\/$/, '')}`;
  if (/^PUBLIC_BASE_URL=/m.test(content)) {
    content = content.replace(/^PUBLIC_BASE_URL=.*$/m, line);
  } else {
    content += `\n${line}\n`;
  }
  writeFileSync(envPath, content, 'utf8');
  console.log('✅ PUBLIC_BASE_URL mis à jour:', url.replace(/\/$/, ''));
}

async function linkTenant(env) {
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const emailArg = process.argv.find((a) => a.startsWith('--email='))?.slice(8)
    || (process.argv.includes('--email') ? process.argv[process.argv.indexOf('--email') + 1] : null);

  let query = db.from('tenants').update({
    twilio_number: EXISTING_PHONE,
    twilio_sid: EXISTING_SID,
    provisioning_status: 'active',
    provisioning_error: null,
    activated_at: new Date().toISOString(),
  });

  if (emailArg) {
    query = query.eq('email', emailArg);
  } else {
    const { data: pending } = await db
      .from('tenants')
      .select('id, email')
      .in('provisioning_status', ['pending', 'provisioning', 'failed'])
      .eq('onboarding_done', true)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (pending?.length) {
      console.log('Cible: tenant récent en attente →', pending[0].email);
      query = query.eq('id', pending[0].id);
    } else {
      query = query.eq('business_name', 'noviaai');
    }
  }

  const { data, error } = await query
    .select('email, business_name, twilio_number, provisioning_status, phone_forward')
    .single();
  if (error) throw error;
  console.log('✅ Tenant lié:', data);
  return data;
}

async function configureWebhooks(env) {
  const base = (env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!base || base.includes('localhost')) {
    throw new Error('PUBLIC_BASE_URL doit être une URL publique (pas localhost). Lancez: npx netlify dev --live');
  }
  const twilio = (await import('twilio')).default;
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const updated = await client.incomingPhoneNumbers(EXISTING_SID).update({
    smsUrl: `${base}/.netlify/functions/sms`,
    smsMethod: 'POST',
    voiceUrl: `${base}/.netlify/functions/voice`,
    voiceMethod: 'POST',
    friendlyName: 'NoviaAI Rattrapeur',
  });
  console.log('✅ Webhooks Twilio configurés:');
  console.log('   SMS  :', updated.smsUrl);
  console.log('   Voice:', updated.voiceUrl);
}

const webhooksOnly = process.argv.includes('--webhooks-only');
const env = loadEnv();

try {
  if (!webhooksOnly) await linkTenant(env);
  if (process.argv.includes('--webhooks-only') || env.PUBLIC_BASE_URL?.startsWith('https://')) {
    await configureWebhooks(env);
  } else {
    console.log('\n⏭️  Webhooks ignorés (PUBLIC_BASE_URL pas encore public).');
    console.log('   Prochaine étape: npx netlify dev --live --port 8888');
    console.log('   Puis relancez: node scripts/link-existing-twilio.mjs --webhooks-only');
  }
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
