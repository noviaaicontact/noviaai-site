/**
 * Alertes admin quand un client tombe en erreur opérationnelle.
 * Rate-limité pour ne pas spammer Resend si Twilio réessaie.
 */
const { checkRateLimit } = require('./rate-limit');
const { sendAdminClientErrorAlert } = require('./email');

/**
 * @param {object} opts
 * @param {string} opts.area         ex. sms | textback | paiement | checkout | quota | provision
 * @param {string|Error} opts.error
 * @param {object} [opts.tenant]
 * @param {object} [opts.extra]      détails libres (numéros, status…)
 * @param {number} [opts.maxPerHour] défaut 3
 */
async function notifyAdminClientError(opts = {}) {
  const area = String(opts.area || 'systeme').slice(0, 40);
  const tenant = opts.tenant || null;
  const tenantKey = tenant?.id || 'global';
  const errMsg = opts.error instanceof Error
    ? (opts.error.message || String(opts.error))
    : String(opts.error || 'Erreur inconnue');

  const maxPerHour = opts.maxPerHour != null ? opts.maxPerHour : 3;
  const rl = await checkRateLimit(`admin-err:${area}:${tenantKey}`, {
    maxAttempts: maxPerHour,
    windowMinutes: 60,
  });
  if (!rl.ok) {
    console.warn('[admin-alert] rate-limited', area, tenantKey);
    return { skipped: true, reason: 'rate_limited' };
  }

  try {
    if (typeof sendAdminClientErrorAlert !== 'function') {
      console.warn('[admin-alert] helper courriel absent — alerte non envoyée', area);
      return { ok: false, error: 'helper_missing' };
    }
    await sendAdminClientErrorAlert({
      area,
      error: errMsg.slice(0, 800),
      tenant,
      extra: opts.extra || {},
    });
    return { ok: true };
  } catch (e) {
    console.error('[admin-alert] envoi échoué', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { notifyAdminClientError };
