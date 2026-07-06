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
  const data = await res.json();
  if (!res.ok && data && data.error) throw new Error(data.error);
  return data;
}

async function ensureTenant(plan) {
  const p = plan || sessionStorage.getItem('novia_plan') || 'pro';
  const data = await api('api-tenant?plan=' + encodeURIComponent(p), { method: 'GET' });
  if (!data.tenant) throw new Error('Impossible de créer votre commerce — réessayez.');
  return data;
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

window.NoviaApp = { loadConfig, getSupabase, getSession, requireAuth, api, ensureTenant, signUp, signIn, signOut };
