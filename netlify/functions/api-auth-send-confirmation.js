const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getAdmin } = require('../../lib/db');
const { sendSignupConfirmationEmail } = require('../../lib/confirmation-email');

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

  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'signup',
      email: normalized,
      options: { redirectTo: REDIRECT() },
    });
    if (error) throw error;

    const link = data?.properties?.action_link;
    if (!link) throw new Error('Lien de confirmation indisponible');

    await sendSignupConfirmationEmail(normalized, link);
    return json(200, { ok: true });
  } catch (e) {
    console.error('api-auth-send-confirmation', e.message || e);
    return json(500, { error: e.message || 'Envoi impossible' });
  }
};
