const { createClient } = require('@supabase/supabase-js');

let _admin = null;
let _ws = null;
try {
  _ws = require('ws');
} catch (_) {
  /* Node 22+ has native WebSocket; ws optional */
}

function isDbConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getAdmin() {
  if (!isDbConfigured()) return null;
  if (!_admin) {
    const opts = {
      auth: { persistSession: false, autoRefreshToken: false },
    };
    if (_ws) opts.realtime = { transport: _ws };
    _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);
  }
  return _admin;
}

module.exports = { getAdmin, isDbConfigured };
