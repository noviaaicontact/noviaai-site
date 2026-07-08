const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getAdmin } = require('../../lib/db');
const { sendSignupConfirmationEmail } = require('../../lib/confirmation-email');
const { checkRateLimit, clientIp } = require('../../lib/rate-limit');

const REDIRECT = () => `${process.env.PUBLIC_BASE_URL || 'https://noviaai.ca'}/auth/callback.html`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const admin = getAdmin();
  if (!admin) return json(503, { error: 'Base de données non configurée' });

  const { email } = parseJson(event);
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    return json(400, { error: 'Courriel invalide' });
  }

  const ip = clientIp(event);
  const rl = await checkRateLimit(`confirm:${normalized}:${ip}`, { maxAttempts: 3, windowMinutes: 60 });
  if (!rl.ok) {
    return json(429, { error: 'Trop de tentatives — réessayez dans une heure.' });
  }

  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'signup',
      email: normalized,
      options: { redirectTo: REDIRECT() },
    });
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('not found') || msg.includes('user not')) {
        return json(200, { ok: true });
      }
      throw error;
    }

    const link = data?.properties?.action_link;
    if (!link) return json(200, { ok: true });

    await sendSignupConfirmationEmail(normalized, link);
    return json(200, { ok: true });
  } catch (e) {
    console.error('api-auth-send-confirmation', e.message || e);
    return json(500, { error: e.message || 'Envoi impossible' });
  }
};
