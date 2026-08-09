#!/usr/bin/env node
// Vérifie le mode assistance : qui peut ouvrir le compte d'un client, et ce qui
// reste interdit. Le point critique est le cas 3 — un client ne doit jamais
// pouvoir lire le compte d'un autre en fabriquant l'en-tête lui-même.
//
//   npm run test:assist

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.env.ADMIN_EMAIL = 'admin@noviaai.ca';
process.env.ADMIN_SECRET = 'secret-de-test-solide';

const CLIENT = { id: 'user-client', email: 'salon@exemple.ca' };
const ADMIN = { id: 'user-admin', email: 'admin@noviaai.ca' };

const TENANT_CLIENT = { id: 'tenant-salon', user_id: CLIENT.id, business_name: 'Salon Élara' };
const TENANT_ADMIN = { id: 'tenant-admin', user_id: ADMIN.id, business_name: 'Commerce interne' };
const TENANT_AUTRE = { id: 'tenant-autre', user_id: 'user-autre', business_name: 'Garage Réal' };

const TENANTS = [TENANT_CLIENT, TENANT_ADMIN, TENANT_AUTRE];

let currentUser = null;
let created = 0;

function stub(relPath, exports) {
  const resolved = require.resolve(path.join(ROOT, relPath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub('lib/auth.js', {
  getUserFromRequest: async () => currentUser,
});

stub('lib/tenant.js', {
  getTenantByUserId: async (userId) => TENANTS.find((t) => t.user_id === userId) || null,
  getTenantById: async (id) => TENANTS.find((t) => t.id === id) || null,
  createTenantForUser: async (user) => {
    created += 1;
    const row = { id: 'tenant-neuf', user_id: user.id, business_name: 'Mon commerce' };
    TENANTS.push(row);
    return row;
  },
});

const { resolveTenantContext } = require(path.join(ROOT, 'lib/tenant-context.js'));

function req(headers = {}, method = 'GET') {
  return { headers, httpMethod: method, body: '{}', path: '/.netlify/functions/api-tenant' };
}

function bodyOf(response) {
  return JSON.parse(response.body);
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: !!condition, detail });
  const mark = condition ? '  ok  ' : ' ÉCHEC';
  console.log(`${mark}  ${name}${condition || !detail ? '' : `\n         → ${detail}`}`);
}

// 1 — sans session
currentUser = null;
let ctx = await resolveTenantContext(req());
check('Sans session : refus 401', !ctx.ok && ctx.response.statusCode === 401);

// 2 — client sans en-tête : son propre commerce
currentUser = CLIENT;
ctx = await resolveTenantContext(req());
check(
  'Client sans en-tête : obtient son commerce',
  ctx.ok && ctx.tenant.id === TENANT_CLIENT.id && ctx.assisting === false,
  ctx.ok ? `reçu ${ctx.tenant.id}` : 'refusé',
);

// 3 — SÉCURITÉ : un client qui forge l'en-tête ne doit rien obtenir
currentUser = CLIENT;
ctx = await resolveTenantContext(req({ 'x-assist-tenant-id': TENANT_AUTRE.id }));
check(
  'SÉCURITÉ — client forgeant l\'en-tête : refus 403',
  !ctx.ok && ctx.response.statusCode === 403 && !ctx.tenant,
  ctx.ok ? `FUITE : a reçu ${ctx.tenant.id}` : `statut ${ctx.response?.statusCode}`,
);

// 4 — admin avec en-tête : commerce ciblé
currentUser = ADMIN;
ctx = await resolveTenantContext(req({ 'x-assist-tenant-id': TENANT_CLIENT.id }));
check(
  'Admin en assistance : obtient le commerce ciblé',
  ctx.ok && ctx.tenant.id === TENANT_CLIENT.id && ctx.assisting === true,
  ctx.ok ? `reçu ${ctx.tenant.id}, assisting=${ctx.assisting}` : 'refusé',
);

// 5 — admin sans en-tête : son propre commerce, pas d'assistance
currentUser = ADMIN;
ctx = await resolveTenantContext(req());
check(
  'Admin sans en-tête : reste sur son compte',
  ctx.ok && ctx.tenant.id === TENANT_ADMIN.id && ctx.assisting === false,
);

// 6 — actions réservées au client (Stripe, suppression)
currentUser = ADMIN;
ctx = await resolveTenantContext(req({ 'x-assist-tenant-id': TENANT_CLIENT.id }), { blockAssist: true });
check(
  'Action sensible en assistance : refus 403',
  !ctx.ok && ctx.response.statusCode === 403,
);

// 7 — commerce inexistant
currentUser = ADMIN;
ctx = await resolveTenantContext(req({ 'x-assist-tenant-id': 'tenant-fantome' }));
check('Commerce inconnu : refus 404', !ctx.ok && ctx.response.statusCode === 404);

// 8 — en-tête en casse mixte (Netlify normalise, mais pas les tests locaux)
currentUser = ADMIN;
ctx = await resolveTenantContext(req({ 'X-Assist-Tenant-Id': TENANT_CLIENT.id }));
check(
  'En-tête en casse mixte reconnu',
  ctx.ok && ctx.tenant.id === TENANT_CLIENT.id && ctx.assisting === true,
);

// 9 — jamais de création de commerce pour le compte assisté
currentUser = ADMIN;
created = 0;
ctx = await resolveTenantContext(req({ 'x-assist-tenant-id': 'tenant-fantome' }), { createIfMissing: true });
check(
  'Assistance ne crée jamais de commerce',
  !ctx.ok && created === 0,
  `créations=${created}`,
);

// 10 — secret admin : accès machine sans compte admin
currentUser = { id: 'user-machine', email: 'script@exemple.ca' };
ctx = await resolveTenantContext(req({
  'x-assist-tenant-id': TENANT_CLIENT.id,
  'x-admin-secret': process.env.ADMIN_SECRET,
}));
check(
  'Secret admin valide : assistance autorisée',
  ctx.ok && ctx.tenant.id === TENANT_CLIENT.id,
);

// 11 — mauvais secret
currentUser = { id: 'user-machine', email: 'script@exemple.ca' };
ctx = await resolveTenantContext(req({
  'x-assist-tenant-id': TENANT_CLIENT.id,
  'x-admin-secret': 'mauvais-secret',
}));
check('Secret admin invalide : refus 403', !ctx.ok && ctx.response.statusCode === 403);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);
if (failed.length) {
  console.error(`\n${failed.length} échec(s) : ${failed.map((f) => f.name).join(', ')}`);
  process.exit(1);
}
console.log('Mode assistance : comportement conforme.');
