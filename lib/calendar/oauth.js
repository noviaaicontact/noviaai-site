const { signState, verifyState, randomVerifier, challengeS256 } = require('./crypto');

const PROVIDERS = ['google', 'microsoft'];
const TZ = 'America/Toronto';

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || 'https://noviaai.ca').replace(/\/$/, '');
}

function redirectUri() {
  return process.env.GOOGLE_CALENDAR_REDIRECT_URI
    || process.env.MICROSOFT_CALENDAR_REDIRECT_URI
    || `${publicBase()}/.netlify/functions/api-calendar-oauth-callback`;
}

function googleConfigured() {
  return !!(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET);
}

function microsoftConfigured() {
  return !!(process.env.MICROSOFT_CALENDAR_CLIENT_ID && process.env.MICROSOFT_CALENDAR_CLIENT_SECRET);
}

function providerConfigured(provider) {
  if (provider === 'google') return googleConfigured();
  if (provider === 'microsoft') return microsoftConfigured();
  return false;
}

function assertProvider(provider) {
  if (!PROVIDERS.includes(provider)) throw new Error('Fournisseur inconnu');
  if (!providerConfigured(provider)) {
    throw new Error(provider === 'google'
      ? 'Google Calendar n\'est pas configuré sur le serveur (GOOGLE_CALENDAR_CLIENT_ID).'
      : 'Microsoft Calendar n\'est pas configuré sur le serveur (MICROSOFT_CALENDAR_CLIENT_ID).');
  }
}

function buildAuthUrl(tenantId, provider) {
  assertProvider(provider);
  const verifier = randomVerifier();
  const state = signState({
    t: tenantId,
    p: provider,
    e: Date.now() + 12 * 60 * 1000,
    v: verifier,
  });
  const challenge = challengeS256(verifier);
  const redir = redirectUri();

  if (provider === 'google') {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', process.env.GOOGLE_CALENDAR_CLIENT_ID);
    u.searchParams.set('redirect_uri', redir);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    u.searchParams.set('include_granted_scopes', 'true');
    u.searchParams.set('scope', [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.freebusy',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '));
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }

  const u = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  u.searchParams.set('client_id', process.env.MICROSOFT_CALENDAR_CLIENT_ID);
  u.searchParams.set('redirect_uri', redir);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('scope', 'offline_access User.Read Calendars.ReadWrite');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || `HTTP ${res.status}` };
  }
}

async function exchangeCode(provider, code, verifier) {
  assertProvider(provider);
  const redir = redirectUri();

  if (provider === 'google') {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID,
        client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
        redirect_uri: redir,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    const data = await readJson(res);
    if (!res.ok || !data.access_token) {
      throw new Error(data.error_description || data.error || 'Échange du code Google échoué');
    }
    return data;
  }

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.MICROSOFT_CALENDAR_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CALENDAR_CLIENT_SECRET,
      redirect_uri: redir,
      grant_type: 'authorization_code',
      code_verifier: verifier,
      scope: 'offline_access User.Read Calendars.ReadWrite',
    }),
  });
  const data = await readJson(res);
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Échange du code Microsoft échoué');
  }
  return data;
}

async function refreshAccessToken(provider, refreshToken) {
  assertProvider(provider);
  if (!refreshToken) throw new Error('Jeton de rafraîchissement manquant — reconnectez le calendrier.');

  if (provider === 'google') {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID,
        client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    });
    const data = await readJson(res);
    if (!res.ok || !data.access_token) {
      const err = new Error(data.error_description || data.error || 'Autorisation Google expirée');
      err.code = 'expired';
      throw err;
    }
    return data;
  }

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.MICROSOFT_CALENDAR_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CALENDAR_CLIENT_SECRET,
      grant_type: 'refresh_token',
      scope: 'offline_access User.Read Calendars.ReadWrite',
    }),
  });
  const data = await readJson(res);
  if (!res.ok || !data.access_token) {
    const err = new Error(data.error_description || data.error || 'Autorisation Microsoft expirée');
    err.code = 'expired';
    throw err;
  }
  return data;
}

async function fetchAccountEmail(provider, accessToken) {
  if (provider === 'google') {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await readJson(res);
    return data.email || null;
  }
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await readJson(res);
  return data.mail || data.userPrincipalName || null;
}

async function revokeToken(provider, token) {
  if (!token) return;
  try {
    if (provider === 'google') {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    }
  } catch (_) { /* ignore */ }
}

function settingsRedirect(query) {
  const q = new URLSearchParams(query).toString();
  return `${publicBase()}/parametres.html${q ? `?${q}` : ''}`;
}

module.exports = {
  PROVIDERS,
  TZ,
  publicBase,
  redirectUri,
  googleConfigured,
  microsoftConfigured,
  providerConfigured,
  assertProvider,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  fetchAccountEmail,
  revokeToken,
  settingsRedirect,
  verifyState,
};
