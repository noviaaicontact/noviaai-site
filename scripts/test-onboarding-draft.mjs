#!/usr/bin/env node
// Vérifie qu'une inscription interrompue ne perd pas les réponses déjà saisies.
// Le tenant n'est écrit en base qu'à la soumission finale, donc la reprise
// du formulaire repose entièrement sur le brouillon local.
//
//   npm run test:onboarding

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8899;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('introuvable');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(PORT, resolve));

let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch (_) {
  browser = await chromium.launch({ headless: true });
}
const page = await browser.newPage();

// La page exige une session Supabase : on remplace app.js par un stub.
await page.route('**/assets/app.js', (route) => route.fulfill({
  contentType: 'text/javascript',
  body: 'window.NoviaApp={requireAuth:async()=>({}),api:async()=>({ok:true})};',
}));
await page.route('**/meta-pixel.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
await page.route('**cdn.jsdelivr.net**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));

const erreursJs = [];
page.on('pageerror', (e) => erreursJs.push(e.message));

const url = `http://localhost:${PORT}/onboarding.html`;
await page.goto(url);

await page.fill('#business_name', 'Garage Tremblay');
await page.fill('#business_phone', '581-555-0199');
await page.click('#next1');
await page.click('.ob-type-card:has-text("Service terrain") input');
await page.fill('#business_type', 'Garage mécanique');
await page.click('#next2');
await page.fill('#services_text', "Changement d'huile — 60$");

// Le prospect quitte la page en plein milieu, puis revient.
await page.goto('about:blank');
await page.goto(url);

const repris = {
  etape: await page.locator('.wizard-step.active').getAttribute('data-step'),
  nom: await page.inputValue('#business_name'),
  tel: await page.inputValue('#business_phone'),
  type: await page.inputValue('#business_type'),
  services: await page.inputValue('#services_text'),
  bandeau: await page.locator('#draftNotice').isVisible(),
  terrain: await page.isChecked('.ob-type-card:has-text("Service terrain") input'),
  bouton: await page.textContent('#submitBtn'),
};

await page.click('#draftReset');
await page.waitForLoadState('load');
const remisAZero = {
  nom: await page.inputValue('#business_name'),
  bandeau: await page.locator('#draftNotice').isVisible(),
};

await browser.close();
server.close();

const CAS = [
  ['nom du commerce conservé', repris.nom === 'Garage Tremblay'],
  ['téléphone conservé', repris.tel === '581-555-0199'],
  ['type d\'entreprise conservé', repris.type === 'Garage mécanique'],
  ['choix « service terrain » conservé', repris.terrain === true],
  ['champs de l\'étape 3 conservés', repris.services === "Changement d'huile — 60$"],
  ['retour à l\'étape en cours', repris.etape === '3'],
  ['bandeau de reprise affiché', repris.bandeau === true],
  ['bouton final parle d\'essai gratuit', /essai gratuit/i.test(repris.bouton)],
  ['« recommencer à zéro » vide le formulaire', remisAZero.nom === ''],
  ['bandeau caché après remise à zéro', remisAZero.bandeau === false],
  ['aucune erreur JavaScript', erreursJs.length === 0],
];

let echecs = 0;
for (const [nom, ok] of CAS) {
  console.log(`  ${ok ? 'ok   ' : 'ECHEC'} ${nom}`);
  if (!ok) echecs += 1;
}
if (erreursJs.length) console.error('Erreurs JS :', erreursJs);

if (echecs) {
  console.error(`\n${echecs} cas en échec sur ${CAS.length}.`);
  process.exit(1);
}
console.log(`\n${CAS.length} cas vérifiés, tout passe.`);
