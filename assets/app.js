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

async function api(fn, opts, accessToken) {
  opts = opts || {};
  const token = accessToken || (await getSession())?.access_token;
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch('/.netlify/functions/' + fn, Object.assign({}, opts, { headers }));
  let data = {};
  try { data = await res.json(); } catch (_) { /* réponse non-JSON */ }
  if (!res.ok) {
    if (res.status === 502 || res.status === 503) {
      throw new Error('Serveur occupé — attendez 30 secondes et réessayez.');
    }
    throw new Error((data && data.error) || ('Erreur serveur (' + res.status + ')'));
  }
  return data;
}

async function ensureTenant(plan, accessToken) {
  const p = plan || sessionStorage.getItem('novia_plan') || 'pro';
  const data = await api('api-tenant?plan=' + encodeURIComponent(p), { method: 'GET' }, accessToken);
  if (!data.tenant) throw new Error((data && data.error) || 'Impossible de créer votre commerce — réessayez.');
  return data;
}

function authRedirectUrl() {
  return `${window.location.origin}/auth/callback.html`;
}

/** Supabase renvoie un faux succès (identities vide) si le courriel existe déjà. */
function isDuplicateSignUpAttempt(data) {
  return !!(
    data?.user &&
    !data.session &&
    Array.isArray(data.user.identities) &&
    data.user.identities.length === 0
  );
}

function formatSignUpError(err) {
  const msg = (err?.message || String(err || '')).toLowerCase();
  if (msg.includes('rate limit') || err?.status === 429) {
    return 'Limite d\'envoi de courriels atteinte. Attendez 10–15 minutes, puis réessayez.';
  }
  if (msg.includes('error sending confirmation') || msg.includes('550')) {
    return 'Courriel non envoyé : en mode test Resend, seul noviaai.contact@gmail.com peut recevoir les confirmations. Utilisez cette adresse pour tester, ou vérifiez le domaine noviaai.ca sur resend.com.';
  }
  return err?.message || 'Erreur inscription';
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

window.NoviaApp = { loadConfig, getSupabase, getSession, requireAuth, api, ensureTenant, signUp, signIn, signOut, isDuplicateSignUpAttempt, formatSignUpError };
