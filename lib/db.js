const { createClient } = require('@supabase/supabase-js');

let _admin = null;

function isDbConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getAdmin() {
  if (!isDbConfigured()) return null;
  if (!_admin) {
    _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

module.exports = { getAdmin, isDbConfigured };
