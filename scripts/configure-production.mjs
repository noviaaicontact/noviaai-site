/**
 * Configure NoviaAI en production sur https://noviaai.ca
 * Usage: node scripts/configure-production.mjs
 *        node scripts/configure-production.mjs https://autre-domaine.ca
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const TWILIO_SID = 'PN265f2f951c2493da0c6c452cbe6a2b08';
const base = (process.argv[2] || 'https://noviaai.ca').replace(/\/$/, '');

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

function setEnvBaseUrl(url) {
  let content = readFileSync(envPath, 'utf8');
  const line = `PUBLIC_BASE_URL=${url}`;
  content = /^PUBLIC_BASE_URL=/m.test(content)
    ? content.replace(/^PUBLIC_BASE_URL=.*$/m, line)
    : `${content}\n${line}\n`;
  writeFileSync(envPath, content, 'utf8');
}

async function main() {
  console.log('\n🌐 Configuration production NoviaAI\n');
  console.log('URL cible:', base);

  setEnvBaseUrl(base);
  console.log('✅ PUBLIC_BASE_URL mis à jour dans .env');
  console.log('\n⚠️  Copiez aussi PUBLIC_BASE_URL=' + base + ' dans Netlify → Environment variables\n');

  const env = loadEnv();
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    console.log('⏭️  Twilio absent — webhooks ignorés');
  } else {
    const twilio = (await import('twilio')).default;
    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    const updated = await client.incomingPhoneNumbers(TWILIO_SID).update({
      smsUrl: `${base}/.netlify/functions/sms`,
      smsMethod: 'POST',
      voiceUrl: `${base}/.netlify/functions/voice`,
      voiceMethod: 'POST',
    });
    console.log('✅ Twilio Voice:', updated.voiceUrl);
    console.log('✅ Twilio SMS  :', updated.smsUrl);

    try {
      const body = new URLSearchParams({ From: '+15819095332', To: '+18722535474', CallSid: 'CA_prod_test' });
      const res = await fetch(`${base}/.netlify/functions/voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      console.log(res.ok ? '✅ Test voice public OK' : `❌ Test voice public HTTP ${res.status} — le site est-il déployé?`);
    } catch (e) {
      console.log('❌ Test voice public échoué:', e.message);
    }
  }

  console.log('\n── Supabase (Authentication → URL Configuration) ──');
  console.log('Site URL:     ', base);
  console.log('Redirect URLs:');
  [
    base,
    `${base}/auth/callback.html`,
    `${base}/dashboard.html`,
    `${base}/login.html`,
    `${base}/onboarding.html`,
    'http://localhost:8888/auth/callback.html',
  ].forEach((u) => console.log('  -', u));

  console.log('\n── Stripe webhook (après deploy) ──');
  console.log('  npm run stripe:webhook:create -- --url', base);

  console.log('\n── Pages publiques ──');
  console.log('  Accueil:   ', base + '/');
  console.log('  Dashboard: ', base + '/dashboard.html');
  console.log('  Inscription:', base + '/signup.html');
  console.log('');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
