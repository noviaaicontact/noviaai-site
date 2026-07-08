/**
 * Démarre netlify dev + tunnel cloudflare + webhooks Twilio pour tests SMS/appels.
 * Usage: npm run test:twilio
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const PORT = 8888;
const EXISTING_PHONE = '+18722535474';
const EXISTING_SID = 'PN265f2f951c2493da0c6c452cbe6a2b08';

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
  const line = `PUBLIC_BASE_URL=${url.replace(/\/$/, '')}`;
  content = /^PUBLIC_BASE_URL=/m.test(content)
    ? content.replace(/^PUBLIC_BASE_URL=.*$/m, line)
    : `${content}\n${line}\n`;
  writeFileSync(envPath, content, 'utf8');
}

function waitForHttp(url, maxMs = 90000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve(true);
        else if (Date.now() - start > maxMs) reject(new Error('Timeout serveur'));
        else setTimeout(tick, 2000);
      });
      req.on('error', () => {
        if (Date.now() - start > maxMs) reject(new Error('Timeout serveur'));
        else setTimeout(tick, 2000);
      });
      req.setTimeout(4000, () => req.destroy());
    };
    tick();
  });
}

function spawnDetached(cmd, args, opts = {}) {
  const isWin = process.platform === 'win32';
  return spawn(cmd, args, {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,
    env: { ...process.env, CHOKIDAR_USEPOLLING: '1', ...opts.env },
    ...opts,
  });
}

async function isServerUp() {
  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/index.html`, 3000);
    return true;
  } catch {
    return false;
  }
}

async function startCloudflareTunnel() {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const child = spawn('npx', ['--yes', 'cloudflared', 'tunnel', '--url', `http://127.0.0.1:${PORT}`], {
      cwd: root,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin,
      env: { ...process.env, CHOKIDAR_USEPOLLING: '1' },
    });
    let out = '';
    const deadline = setTimeout(() => reject(new Error('Tunnel cloudflare: timeout (120s) — relancez npm run test:twilio')), 120000);
    const onData = (chunk) => {
      out += chunk.toString();
      const m = out.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m) {
        clearTimeout(deadline);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
        child.unref();
        resolve({ url: m[0], pid: child.pid });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', reject);
  });
}

async function configureWebhooks(env, base) {
  const twilio = (await import('twilio')).default;
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  return client.incomingPhoneNumbers(EXISTING_SID).update({
    smsUrl: `${base}/.netlify/functions/sms`,
    smsMethod: 'POST',
    voiceUrl: `${base}/.netlify/functions/voice`,
    voiceMethod: 'POST',
    friendlyName: 'NoviaAI Rattrapeur',
  });
}

async function linkTenant(env) {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await db
    .from('tenants')
    .update({
      twilio_number: EXISTING_PHONE,
      twilio_sid: EXISTING_SID,
      provisioning_status: 'active',
      provisioning_error: null,
      activated_at: new Date().toISOString(),
    })
    .eq('business_name', 'noviaai')
    .select('business_name, twilio_number, existing_business_number')
    .single();
  if (error) throw error;
  return data;
}

async function testPublicVoice(base) {
  const body = new URLSearchParams({
    From: '+15819095332',
    To: EXISTING_PHONE,
    CallSid: 'CA_test_public',
  });
  const res = await fetch(`${base}/.netlify/functions/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const xml = await res.text();
  return { ok: res.ok && xml.includes('Hangup'), status: res.status, xml: xml.slice(0, 120) };
}

async function main() {
  console.log('\n🚀 NoviaAI — activation tunnel + webhooks Twilio\n');

  const env = loadEnv();
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio manquant dans .env');
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase manquant dans .env');
  }

  console.log('1/6 — Tenant Supabase…');
  const tenant = await linkTenant(env);
  console.log('   ✅', tenant.business_name, '| public:', tenant.existing_business_number || '—');

  let netlifyPid = null;
  if (await isServerUp()) {
    console.log('2/6 — Serveur local déjà actif sur :8888');
  } else {
    console.log('2/6 — Démarrage netlify dev (port', PORT, ')…');
    const netlify = spawnDetached('npx', ['netlify', 'dev', '--port', String(PORT)]);
    netlify.unref();
    netlifyPid = netlify.pid;
    await waitForHttp(`http://127.0.0.1:${PORT}/index.html`);
    console.log('   ✅ Serveur local actif');
  }

  console.log('3/6 — Tunnel Cloudflare (public)…');
  const tunnel = await startCloudflareTunnel();
  const base = tunnel.url.replace(/\/$/, '');
  setEnvBaseUrl(base);
  console.log('   ✅', base);

  console.log('4/6 — Webhooks Twilio mis à jour…');
  const updated = await configureWebhooks({ ...env, PUBLIC_BASE_URL: base }, base);
  console.log('   ✅ Voice:', updated.voiceUrl);
  console.log('   ✅ SMS  :', updated.smsUrl);

  console.log('5/6 — Test webhook public…');
  const pub = await testPublicVoice(base);
  console.log(pub.ok ? '   ✅ Twilio peut joindre votre serveur' : `   ❌ Échec test public (${pub.status}): ${pub.xml}`);

  console.log('6/6 — Test voice local…');
  const local = await testPublicVoice(`http://127.0.0.1:${PORT}`);
  console.log(local.ok ? '   ✅ voice.js OK' : '   ❌ voice.js local échoué');

  const logPath = join(root, '.test-twilio-pids.txt');
  writeFileSync(
    logPath,
    `netlify_pid=${netlifyPid || 'existing'}\ntunnel_pid=${tunnel.pid}\nurl=${base}\n`,
    'utf8',
  );

  console.log('\n════════════════════════════════════════');
  console.log('  PRÊT — testez maintenant');
  console.log('════════════════════════════════════════');
  console.log('Numéro NoviaAI :', EXISTING_PHONE);
  console.log('Tunnel actif   :', base);
  console.log('Dashboard      : http://localhost:8888/dashboard.html');
  console.log('\n📞 TEST (Option A — recommandé):');
  console.log('   1) Appelez', EXISTING_PHONE, 'depuis UN AUTRE téléphone');
  console.log('   2) Laissez sonner votre cell — ne répondez pas');
  console.log('   3) Le client reçoit le SMS de rattrapage');
  console.log('\n📞 Option avancée — renvoi depuis votre 581:');
  console.log('   1) #21#  puis  2) *61*18722535474#');
  console.log('\n⚠️  Compte TRIAL Twilio: le numéro qui APPELLE doit être');
  console.log('   vérifié sur console.twilio.com → Verified Caller IDs');
  console.log('\n⚠️  Gardez cette fenêtre ouverte — le tunnel meurt si vous');
  console.log('   fermez le terminal cloudflare. Relancez: npm run test:twilio');
  console.log('\nPour arrêter: Ctrl+C puis npm run test:twilio:stop\n');
  console.log('⏳ Serveur actif — ne fermez pas cette fenêtre.\n');

  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', `http://127.0.0.1:${PORT}/dashboard.html?demo=1`], { detached: true, stdio: 'ignore' }).unref();
  }

  await new Promise(() => {});
}

main().catch((e) => {
  console.error('\n❌', e.message);
  process.exit(1);
});
