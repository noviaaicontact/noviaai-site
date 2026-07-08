/**
 * Configure Resend pour NoviaAI (local .env + Netlify).
 *
 * Usage:
 *   node scripts/setup-resend.mjs --key re_VOTRE_CLE
 *   node scripts/setup-resend.mjs --key re_... --from "NoviaAI <onboarding@resend.dev>"
 *
 * Sans --key : affiche les étapes pour créer le compte sur resend.com
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const siteDir = join(root, '..', 'noviaai-site');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

function setEnvKey(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (re.test(text)) return text.replace(re, line);
  return `${text.trimEnd()}\n${line}\n`;
}

function loadEnvText() {
  if (!existsSync(envPath)) {
    console.error('❌ .env manquant — copiez .env.example vers .env');
    process.exit(1);
  }
  return readFileSync(envPath, 'utf8');
}

function parseEnv(text) {
  const env = {};
  text.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i === -1) return;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  });
  return env;
}

const apiKey = arg('--key');
const from = arg('--from') || 'NoviaAI <onboarding@resend.dev>';

if (!apiKey) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Resend — création de compte (2 minutes)                     ║
╚══════════════════════════════════════════════════════════════╝

1. Ouvrez https://resend.com/signup
2. Créez le compte avec votre courriel (ex. aetienne511@gmail.com)
3. Dashboard → API Keys → Create API Key
   - Name: NoviaAI production
   - Permission: Sending access
4. Copiez la clé (commence par re_)

5. Relancez :
   node scripts/setup-resend.mjs --key re_VOTRE_CLE

Option test (sans domaine) :
   --from "NoviaAI <onboarding@resend.dev>"

Option prod (après vérification domaine noviaai.ca) :
   --from "NoviaAI <notifications@noviaai.ca>"

═══════════════════════════════════════════════════════════════
Supabase Auth (confirmation inscription) — à faire après :

  Supabase → Authentication → SMTP Settings → Enable custom SMTP
  Host: smtp.resend.com | Port: 465 | User: resend
  Password: (même clé re_...)
  Sender: NoviaAI <onboarding@resend.dev>
═══════════════════════════════════════════════════════════════
`);
  process.exit(0);
}

if (!/^re_/.test(apiKey)) {
  console.error('❌ Clé invalide — doit commencer par re_');
  process.exit(1);
}

let envText = loadEnvText();
envText = setEnvKey(envText, 'RESEND_API_KEY', apiKey);
envText = setEnvKey(envText, 'EMAIL_FROM', from);
writeFileSync(envPath, envText, 'utf8');
console.log('✅ .env mis à jour (RESEND_API_KEY + EMAIL_FROM)');

const env = parseEnv(envText);
const testTo = env.ADMIN_EMAIL || 'aetienne511@gmail.com';

console.log('\n📤 Test envoi Resend…');
const testRes = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from,
    to: [testTo],
    subject: 'Test NoviaAI — Resend configuré',
    html: '<p>Si vous recevez ce message, Resend fonctionne pour NoviaAI.</p>',
  }),
});
if (!testRes.ok) {
  const err = await testRes.text();
  console.error('⚠️  Test envoi échoué:', err);
  console.error('   Vérifiez la clé et que EMAIL_FROM est autorisé sur Resend.');
} else {
  const data = await testRes.json();
  console.log('✅ Courriel test envoyé — id:', data.id);
}

console.log('\n📤 Sync vers Netlify…');
execFileSync('node', ['scripts/sync-resend-netlify.mjs'], { stdio: 'inherit', cwd: root, shell: true });

console.log(`
✅ Resend configuré pour NoviaAI (app + Netlify)

Courriels automatiques actifs après redéploiement Netlify :
  • Bienvenue (ligne activée)
  • Alerte appel manqué
  • Alerte nouveau lead

Dernière étape (confirmation inscription) :
  Supabase → Authentication → SMTP Settings (voir instructions ci-dessus)
`);
