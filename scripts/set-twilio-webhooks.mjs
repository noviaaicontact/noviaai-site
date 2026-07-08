/** Met à jour PUBLIC_BASE_URL + webhooks Twilio sans redémarrer le serveur. */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const TWILIO_SID = 'PN265f2f951c2493da0c6c452cbe6a2b08';
const base = process.argv[2]?.replace(/\/$/, '');

if (!base) {
  console.error('Usage: node scripts/set-twilio-webhooks.mjs https://xxx.trycloudflare.com');
  process.exit(1);
}

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

let content = readFileSync(envPath, 'utf8');
content = /^PUBLIC_BASE_URL=/m.test(content)
  ? content.replace(/^PUBLIC_BASE_URL=.*$/m, `PUBLIC_BASE_URL=${base}`)
  : `${content}\nPUBLIC_BASE_URL=${base}\n`;
writeFileSync(envPath, content, 'utf8');

const env = loadEnv();
const twilio = (await import('twilio')).default;
const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
const updated = await client.incomingPhoneNumbers(TWILIO_SID).update({
  smsUrl: `${base}/.netlify/functions/sms`,
  smsMethod: 'POST',
  voiceUrl: `${base}/.netlify/functions/voice`,
  voiceMethod: 'POST',
});

console.log('✅ PUBLIC_BASE_URL =', base);
console.log('✅ Voice:', updated.voiceUrl);
console.log('✅ SMS  :', updated.smsUrl);

const body = new URLSearchParams({ From: '+15819095332', To: '+18722535474' });
const res = await fetch(`${base}/.netlify/functions/voice`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body,
});
console.log(res.ok ? '✅ Test public voice OK' : `❌ Test public voice ${res.status}`);
