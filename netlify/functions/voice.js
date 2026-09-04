const { parseBody, escapeXml, xmlResponse, validateTwilioRequest, twilioUnauthorized } = require('../../lib/twilio-util');
const { resolveClient } = require('../../lib/tenant');
const { sendTextback } = require('../../lib/sms-send');
const { toE164 } = require('../../lib/phone-util');
const { buildVoicemailTwiml } = require('../../lib/voicemail');
const { shouldSkipStoreForward } = require('../../lib/voice-callback');

const SUSPENDED_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Say language="fr-CA">Ce service est temporairement suspendu. Merci de votre compréhension.</Say><Hangup/></Response>';

exports.handler = async (event) => {
  if (!validateTwilioRequest(event)) return twilioUnauthorized();

  const p = parseBody(event);
  const to = p.get('To');
  const from = p.get('From');
  const client = await resolveClient(to);

  if (client.suspended) return xmlResponse(SUSPENDED_TWIML);
  if (!client.dossier && !client.tenant) {
    return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  }

  const co = (client.dossier && client.dossier.coordonnees) || {};
  const forwardRaw = co.telephone_reel && !/COMPLÉTER/i.test(co.telephone_reel) ? co.telephone_reel : null;
  const forwardTo = forwardRaw ? toE164(forwardRaw) : null;
  const hours = (client.tenant && client.tenant.hours)
    || (client.dossier && client.dossier.heures_ouverture);
  const storePhone = (client.tenant && (client.tenant.existing_business_number || client.tenant.public_phone))
    || co.telephone;
  const skipClosedStore = shouldSkipStoreForward({ hours, forwardTo, storePhone });
  if (skipClosedStore) {
    console.log('voice: skip store forward (closed + same public line)', {
      to,
      storePhone,
    });
  }

  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const action = `${base}/.netlify/functions/voice-status?tn=${encodeURIComponent(to || '')}`;

  let inner;
  if (forwardTo && !skipClosedStore) {
    inner = `<Dial timeout="25" answerOnBridge="true" action="${escapeXml(action)}" method="POST"><Number>${escapeXml(forwardTo)}</Number></Dial>`;
  } else {
    try { await sendTextback(to, from); } catch (e) { console.error('textback (no-forward)', e); }
    const recordAction = `${base}/.netlify/functions/voice-recording?tn=${encodeURIComponent(to || '')}`;
    const bizName = client?.tenant?.business_name || 'Notre entreprise';
    return xmlResponse(buildVoicemailTwiml({ businessName: bizName, recordActionUrl: recordAction }));
  }

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`);
};
