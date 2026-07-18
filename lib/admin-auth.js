const { parseJson } = require('./http');

const WEAK_ADMIN_SECRETS = new Set(['changez-moi', 'changeme', 'admin', 'secret', '']);

function getAdminSecretFromEvent(event) {
  const hdr = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '';
  if (hdr) return hdr;
  const body = parseJson(event);
  return body.admin_secret || body.adminSecret || '';
}

function isAdminConfigured() {
  const secret = process.env.ADMIN_SECRET || '';
  return !!secret && !WEAK_ADMIN_SECRETS.has(secret);
}

function checkAdmin(event) {
  if (!isAdminConfigured()) return false;
  return getAdminSecretFromEvent(event) === process.env.ADMIN_SECRET;
}

module.exports = {
  checkAdmin,
  isAdminConfigured,
  getAdminSecretFromEvent,
  WEAK_ADMIN_SECRETS,
};
