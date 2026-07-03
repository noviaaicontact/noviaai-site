// Ligne NoviaAI (Option A) : client appelle → sonne le cellulaire du proprio → SMS si pas de réponse.
const { parseBody, escapeXml, xmlResponse, validateTwilioRequest, twilioUnauthorized } = require('../../lib/twilio-util');
const { resolveClient } = require('../../lib/tenant');
const { sendTextback } = require('../../lib/sms-send');
const { toE164 } = require('../../lib/phone-util');

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

  const base = process.env.PUBLIC_BASE_URL || '';
  const action = base + '/.netlify/functions/voice-status';

  let inner;
  if (forwardTo) {
    inner = `<Dial timeout="20" answerOnBridge="true" action="${escapeXml(action)}" method="POST"><Number>${escapeXml(forwardTo)}</Number></Dial>`;
  } else {
    try { await sendTextback(to, from); } catch (e) { console.error('textback (no-forward)', e); }
    inner = '<Hangup/>';
  }

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`);
};
