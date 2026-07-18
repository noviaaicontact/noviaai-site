const { parseJson } = require('./http');
const { getUserFromRequest } = require('./auth');

const WEAK_ADMIN_SECRETS = new Set(['changez-moi', 'changeme', 'admin', 'secret', '']);

function getAdminSecretFromEvent(event) {
  const hdr = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '';
  if (hdr) return hdr;
  const body = parseJson(event);
  return body.admin_secret || body.adminSecret || '';
}

function getAdminEmailList() {
  const raw = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '';
  return raw.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
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
