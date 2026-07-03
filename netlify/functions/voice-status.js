// Après tentative de joindre le proprio : SMS de rattrapage si pas de réponse.
const { parseBody, xmlResponse, validateTwilioRequest, twilioUnauthorized } = require('../../lib/twilio-util');
const { sendTextback } = require('../../lib/sms-send');

const NON_REPONDU = ['no-answer', 'busy', 'failed', 'canceled'];

exports.handler = async (event) => {
  if (!validateTwilioRequest(event)) return twilioUnauthorized();

  const p = parseBody(event);
  const status = p.get('DialCallStatus');
  const to = p.get('To'); // numéro Twilio du commerce
  const from = p.get('From'); // appelant

  if (NON_REPONDU.includes(status)) {
    try { await sendTextback(to, from); } catch (e) { console.error('textback error', e); }
  }

  return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
};
