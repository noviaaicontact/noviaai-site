/**
 * Copie le SaaS complet vers noviaai-site/ (repo GitHub actuel de noviaai.ca)
 * Usage: node scripts/sync-to-noviaai-site.mjs
 *
 * Remplace l'ancien index.html + ajoute dashboard, login, functions Netlify, etc.
 */
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, '..', 'noviaai-site');

const COPY_DIRS = ['netlify', 'lib', 'dossiers'];
const COPY_FILES = ['package.json', 'package-lock.json'];

function log(msg) {
  console.log(msg);
}

if (!existsSync(dest)) {
  console.error('❌ Dossier noviaai-site/ introuvable à côté de rattrapeur-sms/');
  process.exit(1);
}

log('\n📦 Sync SaaS → noviaai-site/ (pour GitHub + noviaai.ca)\n');

// Sauvegarde ancien index
const oldIndex = join(dest, 'index.html');
if (existsSync(oldIndex)) {
  const backup = join(dest, 'index-ANCIEN-SAUVEGARDE.html');
  if (!existsSync(backup)) {
    cpSync(oldIndex, backup);
    log('✅ Ancien index.html → index-ANCIEN-SAUVEGARDE.html');
  }
}

// Pages + assets à la racine (publish = ".")
const publicDir = join(root, 'public');
function copyPublicRecursive(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dst, name);
    if (statSync(s).isDirectory()) {
      copyPublicRecursive(s, d);
    } else {
      cpSync(s, d);
    }
  }
}
copyPublicRecursive(publicDir, dest);
log('✅ public/* → racine noviaai-site/ (index.html, dashboard, assets…)');

// Backend Netlify
for (const dir of COPY_DIRS) {
  const src = join(root, dir);
  const d = join(dest, dir);
  if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  cpSync(src, d, { recursive: true });
  log(`✅ ${dir}/ copié`);
}

for (const f of COPY_FILES) {
  const src = join(root, f);
  if (existsSync(src)) {
    cpSync(src, join(dest, f));
    log(`✅ ${f} copié`);
  }
}

// netlify.toml — publish à la racine (comme l'ancien site)
const toml = `[build]
  command = "npm install"
  publish = "."
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "22"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"

[[headers]]
  for = "/.netlify/functions/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"

[functions]
  node_bundler = "esbuild"
  included_files = ["dossiers/**/*.json"]
`;
writeFileSync(join(dest, 'netlify.toml'), toml, 'utf8');
log('✅ netlify.toml mis à jour (publish = ".")');

// .gitignore minimal
const gitignore = `.env
.netlify/
node_modules/
`;
writeFileSync(join(dest, '.gitignore'), gitignore, 'utf8');

log('\n════════════════════════════════════════');
log('  TERMINÉ — prochaines étapes:');
log('════════════════════════════════════════');
log('1. cd noviaai-site');
log('2. git add -A && git commit -m "SaaS NoviaAI remplace ancien site"');
log('3. git push');
log('4. Netlify redeploy auto → noviaai.ca');
log('5. Variables env Netlify + PUBLIC_BASE_URL=https://noviaai.ca');
log('6. npm run configure:prod (depuis rattrapeur-sms)');
log('');
