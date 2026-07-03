const { getAdmin, isDbConfigured } = require('./db');

async function getUserFromRequest(event) {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !isDbConfigured()) return null;
  const admin = getAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

module.exports = { getUserFromRequest };
