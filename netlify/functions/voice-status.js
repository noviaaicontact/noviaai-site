// Après tentative de joindre le proprio : SMS de rattrapage si pas de réponse.
const { parseBody, xmlResponse, validateTwilioRequest, twilioUnauthorized } = require('../../lib/twilio-util');
const { sendTextback } = require('../../lib/sms-send');
const { resolveDialCallbackNumbers, shouldSendTextback } = require('../../lib/voice-callback');

exports.handler = async (event) => {
  if (!validateTwilioRequest(event)) return twilioUnauthorized();

  const p = parseBody(event);
  const query = event.queryStringParameters || {};
  const status = p.get('DialCallStatus');
  const duration = p.get('DialCallDuration');
  const bridged = p.get('DialBridged');
  const { twilioNumber, callerNumber } = resolveDialCallbackNumbers(p, query);

  console.log('voice-status', {
    status,
    duration,
    bridged,
    twilioNumber,
    callerNumber,
    rawTo: p.get('To'),
    rawFrom: p.get('From'),
    called: p.get('Called'),
  });

  if (!twilioNumber || !callerNumber) {
    console.error('voice-status: numéros manquants');
    return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  }

  if (shouldSendTextback(status, duration, bridged)) {
    try {
      await sendTextback(twilioNumber, callerNumber);
    } catch (e) {
      console.error('textback error', {
        twilioNumber,
        callerNumber,
        status,
        code: e.code,
        message: e.message,
      });
    }
  } else {
    console.log('voice-status: pas de SMS', { status, duration, bridged });
  }

  return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
};
