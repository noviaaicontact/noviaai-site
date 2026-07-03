let _config = null;
let _supabase = null;

async function loadConfig() {
  if (_config) return _config;
  const res = await fetch('/.netlify/functions/api-config');
  _config = await res.json();
  return _config;
}

async function getSupabase() {
  if (_supabase) return _supabase;
  const cfg = await loadConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return null;
  _supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  return _supabase;
}

async function getSession() {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

async function requireAuth(redirectTo) {
  const session = await getSession();
  if (!session) {
    location.href = redirectTo || '/login.html';
    return null;
  }
  return session;
}

async function api(fn, opts) {
  opts = opts || {};
  const session = await getSession();
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (session) headers.Authorization = 'Bearer ' + session.access_token;
  const res = await fetch('/.netlify/functions/' + fn, Object.assign({}, opts, { headers }));
  return res.json();
}

function authRedirectUrl() {
  return `${window.location.origin}/auth/callback.html`;
}

async function signUp(email, password) {
  const sb = await getSupabase();
  if (!sb) throw new Error('Supabase non configuré — voir README');
  return sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: authRedirectUrl() },
  });
}

async function signIn(email, password) {
  const sb = await getSupabase();
  if (!sb) throw new Error('Supabase non configuré');
  return sb.auth.signInWithPassword({ email, password });
}

async function signOut() {
  const sb = await getSupabase();
  if (sb) await sb.auth.signOut();
  location.href = '/login.html';
}

window.NoviaApp = { loadConfig, getSupabase, getSession, requireAuth, api, signUp, signIn, signOut };
