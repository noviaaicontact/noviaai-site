const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getAdmin } = require('../../lib/db');
const { sendSignupConfirmationEmail } = require('../../lib/confirmation-email');

const REDIRECT = () => `${process.env.PUBLIC_BASE_URL || 'https://noviaai.ca'}/auth/callback.html`;

function resendSandboxHint(email) {
  const allowed = (process.env.ADMIN_EMAIL || 'noviaai.contact@gmail.com').toLowerCase();
  if (email.toLowerCase() === allowed) return null;
  return `En mode test, seul ${allowed} peut recevoir les courriels. Utilisez cette adresse ou vérifiez le domaine noviaai.ca sur resend.com.`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const admin = getAdmin();
  if (!admin) return json(503, { error: 'Service indisponible' });

  const { email, password } = parseJson(event);
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return json(400, { error: 'Courriel invalide' });
  if (!password || String(password).length < 8) {
    return json(400, { error: 'Mot de passe : 8 caractères minimum' });
  }

  const sandboxHint = resendSandboxHint(normalized);
  if (sandboxHint) return json(400, { error: sandboxHint });

  try {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: normalized,
      password: String(password),
      email_confirm: false,
    });
    if (createErr) {
      const msg = (createErr.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
        return json(409, { error: 'EXISTING_ACCOUNT', message: 'Ce courriel est déjà utilisé.' });
      }
      throw createErr;
    }

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'signup',
      email: normalized,
      options: { redirectTo: REDIRECT() },
    });
    if (linkErr) throw linkErr;

    const confirmationUrl = linkData?.properties?.action_link;
    if (!confirmationUrl) throw new Error('Lien de confirmation indisponible');

    await sendSignupConfirmationEmail(normalized, confirmationUrl);

    return json(200, {
      ok: true,
      user: created?.user ? { id: created.user.id, email: created.user.email } : null,
    });
  } catch (e) {
    console.error('api-auth-signup', e.message || e);
    const text = String(e.message || e);
    if (text.includes('550') || text.toLowerCase().includes('testing emails')) {
      return json(400, { error: resendSandboxHint(normalized) || 'Courriel non autorisé en mode test Resend.' });
    }
    return json(500, { error: text || 'Inscription impossible' });
  }
};
