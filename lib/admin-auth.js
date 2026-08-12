const { parseJson } = require('./http');
const { getUserFromRequest } = require('./auth');

const WEAK_ADMIN_SECRETS = new Set(['changez-moi', 'changeme', 'admin', 'secret', '']);

function getAdminSecretFromEvent(event) {
  const hdr = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '';
  if (hdr) return hdr;
  const body = parseJson(event);
  return body.admin_secret || body.adminSecret || '';
}

/** Comptes fondateurs toujours autorisés (en plus de ADMIN_EMAIL / ADMIN_EMAILS). */
const BUILTIN_ADMIN_EMAILS = [
  'noviaai.contact@gmail.com',
  'aetienne511@gmail.com',
  'etienne_alexandre1646@outlook.com',
];

function getAdminEmailList() {
  const raw = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '';
  const fromEnv = raw.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...fromEnv, ...BUILTIN_ADMIN_EMAILS])];
}

function isAdminEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  return getAdminEmailList().includes(normalized);
}

function isSecretAdminConfigured() {
  const secret = process.env.ADMIN_SECRET || '';
  return !!secret && !WEAK_ADMIN_SECRETS.has(secret);
}

function isAdminConfigured() {
  return isSecretAdminConfigured() || getAdminEmailList().length > 0;
}

function checkAdminSecret(event) {
  if (!isSecretAdminConfigured()) return false;
  return getAdminSecretFromEvent(event) === process.env.ADMIN_SECRET;
}

async function checkAdminAccess(event) {
  if (checkAdminSecret(event)) return { ok: true, via: 'secret' };
  const user = await getUserFromRequest(event);
  if (user && isAdminEmail(user.email)) {
    return { ok: true, via: 'user', user };
  }
  return { ok: false };
}

/** @deprecated use checkAdminAccess */
function checkAdmin(event) {
  return checkAdminSecret(event);
}

module.exports = {
  checkAdmin,
  checkAdminSecret,
  checkAdminAccess,
  isAdminConfigured,
  isAdminEmail,
  getAdminEmailList,
  getAdminSecretFromEvent,
  WEAK_ADMIN_SECRETS,
};
