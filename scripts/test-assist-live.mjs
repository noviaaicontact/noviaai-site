#!/usr/bin/env node
// Co-pilotage : deux sessions ouvertes sur le même commerce (le client sur son
// compte, un admin en mode assistance) doivent voir les changements de l'autre
// sans rechargement manuel.
//
//   npm run test:assist:live

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8897;
const TENANT_ID = 'tenant-salon';
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

// Commerce partagé par les deux sessions — tient lieu de base de données.
const tenant = {
  id: TENANT_ID,
  user_id: 'user-client',
  email: 'salon@exemple.ca',
  business_name: 'Salon Élara',
  agent_name: 'Léa',
  plan: 'pro',
  subscription_status: 'active',
  stripe_subscription_id: 'sub_test',
  stripe_customer_id: 'cus_test',
  provisioning_status: 'active',
  twilio_number: '+15815550100',
  phone_forward: '+15815550199',
  onboarding_done: true,
  widget_enabled: true,
  hours: {},
  services: [],
  faq: [],
  policies: [],
  agent_favorites: [],
  qualification_fields: [],
  updated_at: new Date().toISOString(),
};

const seen = { client: [], admin: [] };

const SUPABASE_STUB = `
window.supabase = {
  createClient: function () {
    return {
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'jeton-test', user: { email: 'test@exemple.ca' } } } }),
        signOut: async () => ({}),
      },
    };
  },
};`;

async function wireBackend(page, who) {
  await page.route('**/cdn.jsdelivr.net/**', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: SUPABASE_STUB,
  }));

  await page.route('**/.netlify/functions/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const fn = url.pathname.split('/').pop();
    const assistHeader = (await request.allHeaders())['x-assist-tenant-id'] || '';
    seen[who].push({ fn, assist: assistHeader });

    const send = (obj) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(obj),
    });

    if (fn === 'api-config') {
      return send({ supabaseUrl: 'https://stub.test', supabaseAnonKey: 'anon-test' });
    }
    if (fn === 'api-tenant') {
      if (request.method() === 'PATCH' || request.method() === 'POST') {
        const body = JSON.parse(request.postData() || '{}');
        if (body.business_name) tenant.business_name = body.business_name;
        if (body.agent_name) tenant.agent_name = body.agent_name;
        tenant.updated_at = new Date().toISOString();
      }
      return send({ tenant, dossier: {}, assisting: !!assistHeader });
    }
    if (fn === 'api-stats') {
      return send({
        messages_30d: 0, missed_calls_30d: 0, leads_total: 0, leads: [],
        sms_usage: { count: 0, limit: 3000, ok: true },
      });
    }
    if (fn === 'api-messages') return send({ messages: [], missed_calls: [] });
    if (fn === 'api-conversations') return send({ conversations: [] });
    return send({ ok: true });
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '  ok  ' : ' ÉCHEC'}  ${name}${ok || !detail ? '' : `\n         → ${detail}`}`);
}

/** Attend qu'un nom de commerce apparaisse à l'écran (sync en direct). */
async function attendreNom(page, attendu, timeout = 20000) {
  try {
    await page.waitForFunction(
      (n) => document.getElementById('bizName')?.textContent.trim() === n,
      attendu,
      { timeout },
    );
    return true;
  } catch (_) {
    return false;
  }
}

let browser;
let code = 0;
try {
  browser = await chromium.launch({ headless: true });

  const ctxClient = await browser.newContext();
  const ctxAdmin = await browser.newContext();
  const pageClient = await ctxClient.newPage();
  const pageAdmin = await ctxAdmin.newPage();

  await wireBackend(pageClient, 'client');
  await wireBackend(pageAdmin, 'admin');

  // --- Session client : compte normal ---------------------------------
  await pageClient.goto(`http://localhost:${PORT}/dashboard.html`);
  check('Client — tableau de bord chargé', await attendreNom(pageClient, 'Salon Élara', 10000));
  check(
    'Client — aucune requête ne porte l\'en-tête d\'assistance',
    seen.client.length > 0 && seen.client.every((r) => !r.assist),
    `${seen.client.filter((r) => r.assist).length} requête(s) avec en-tête`,
  );
  check(
    'Client — aucun bandeau d\'assistance',
    (await pageClient.locator('#assistBanner').count()) === 0,
  );

  // --- Session admin : mode assistance --------------------------------
  await pageAdmin.goto(
    `http://localhost:${PORT}/dashboard.html?assist=${TENANT_ID}&assist_nom=${encodeURIComponent('Salon Élara')}`,
  );
  check('Admin — tableau de bord du client chargé', await attendreNom(pageAdmin, 'Salon Élara', 10000));

  const banner = pageAdmin.locator('#assistBanner');
  check('Admin — bandeau d\'assistance affiché', (await banner.count()) === 1);
  const bannerText = (await banner.count()) ? await banner.innerText() : '';
  check(
    'Admin — bandeau nomme le commerce assisté',
    bannerText.includes('Salon Élara') && bannerText.includes('assistance'),
    bannerText,
  );
  check(
    'Admin — paramètre ?assist retiré de l\'URL',
    !pageAdmin.url().includes('assist='),
    pageAdmin.url(),
  );
  // api-config est public et lu avant toute session : il n'a rien à cibler.
  const cibles = seen.admin.filter((r) => r.fn !== 'api-config');
  const sansEntete = cibles.filter((r) => r.assist !== TENANT_ID);
  check(
    'Admin — toutes les requêtes de données portent l\'en-tête d\'assistance',
    cibles.length > 0 && sansEntete.length === 0,
    `sans en-tête: ${sansEntete.map((r) => r.fn).join(', ') || 'aucune'}`,
  );

  // --- L'admin modifie : le client doit le voir seul -------------------
  await pageAdmin.evaluate(() => NoviaApp.api('api-tenant', {
    method: 'PATCH',
    body: JSON.stringify({ settings: true, business_name: 'Salon Élara Boutique' }),
  }));
  check(
    'Le client voit en direct la modification faite par l\'assistance',
    await attendreNom(pageClient, 'Salon Élara Boutique'),
    `affiché: ${await pageClient.locator('#bizName').innerText()}`,
  );

  // --- Le client modifie : l'admin doit le voir seul -------------------
  await pageClient.evaluate(() => NoviaApp.api('api-tenant', {
    method: 'PATCH',
    body: JSON.stringify({ settings: true, business_name: 'Salon Élara Lévis' }),
  }));
  check(
    'L\'assistance voit en direct la modification faite par le client',
    await attendreNom(pageAdmin, 'Salon Élara Lévis'),
    `affiché: ${await pageAdmin.locator('#bizName').innerText()}`,
  );

  // --- Sortie d'assistance --------------------------------------------
  await pageAdmin.locator('#assistExit').click();
  await pageAdmin.waitForURL('**/admin.html', { timeout: 10000 }).catch(() => {});
  check('Sortie d\'assistance : retour au panneau admin', pageAdmin.url().includes('/admin.html'));
  const resteAssist = await pageAdmin.evaluate(() => sessionStorage.getItem('novia_assist'));
  check('Sortie d\'assistance : état effacé', resteAssist === null, String(resteAssist));
} catch (e) {
  console.error('\nErreur pendant le test :', e.message);
  code = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);
if (failed.length || code) {
  if (failed.length) console.error(`\nÉchecs : ${failed.map((f) => f.name).join(', ')}`);
  process.exit(1);
}
console.log('Co-pilotage en direct : conforme.');
