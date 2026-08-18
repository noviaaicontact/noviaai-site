/** Texto au cell du commerce — seulement un vrai dossier, pas chaque appel manqué. */

const { toE164, formatDisplay, isTestCaller } = require('./phone-util');
const { logEvent } = require('./events');

function ownerNotifyPhone(tenant) {
  if (!tenant || tenant.notify_email === false) return null;
  return toE164(tenant.phone_forward) || toE164(tenant.public_phone);
}

function firstLine(text) {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean) || '';
}

function buildOwnerLeadSms({ callerPhone, summary, qualificationData, source }) {
  const q = qualificationData && typeof qualificationData === 'object' ? qualificationData : {};
  const need = String(q.probleme || q.service_souhaite || q.demande || '').trim()
    || firstLine(summary);
  const where = String(q.adresse || '').trim();
  const phone = formatDisplay(toE164(callerPhone) || callerPhone) || String(callerPhone || '');
  const prefix = source === 'human_transfer'
    ? 'Rappel'
    : source === 'appointment'
      ? 'Lead RDV'
      : source === 'voicemail'
        ? 'Messagerie'
        : 'Lead';
  let body = `NoviaAI ${prefix}: ${phone}`;
  if (need) body += ` — ${need}`;
  if (where && body.length < 130) body += ` (${where})`;
  if (!/rappeler|rappel/i.test(body)) body += '. À rappeler';
  return body.replace(/\s+/g, ' ').trim().slice(0, 280);
}

async function sendOwnerLeadSms(tenant, callerPhone, summary, source, qualificationData) {
  if (!tenant || !tenant.twilio_number) return { skipped: 'no_line' };
  if (isTestCaller(callerPhone)) return { skipped: 'test' };
  const to = ownerNotifyPhone(tenant);
  const from = toE164(tenant.twilio_number);
  if (!to || !from) return { skipped: 'no_phone' };
  if (to === toE164(callerPhone)) return { skipped: 'same_as_client' };

  const body = buildOwnerLeadSms({
    callerPhone,
    summary,
    qualificationData,
    source,
  });
  try {
    const { sendSMS } = require('./sms-send');
    await sendSMS({ to, from, body });
    await logEvent(tenant.id, callerPhone, 'owner_sms', {
      to,
      source: source || 'lead',
      body: body.slice(0, 160),
    });
    return { ok: true, to };
  } catch (e) {
    console.warn('owner lead SMS', e.message, e.code || '');
    return { skipped: 'send_failed', error: e.message };
  }
}

module.exports = {
  ownerNotifyPhone,
  buildOwnerLeadSms,
  sendOwnerLeadSms,
};
