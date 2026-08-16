// Callback Twilio après enregistrement d'un message vocal.
const { parseBody, xmlResponse, validateTwilioRequest, twilioUnauthorized } = require('../../lib/twilio-util');
const { resolveClient } = require('../../lib/tenant');
const { resolveDialCallbackNumbers } = require('../../lib/voice-callback');
const { processVoicemailRecording } = require('../../lib/voicemail');

exports.handler = async (event) => {
  if (!validateTwilioRequest(event)) return twilioUnauthorized();

  const p = parseBody(event);
  const query = event.queryStringParameters || {};
  const recordingUrl = p.get('RecordingUrl');
  const recordingSid = p.get('RecordingSid');
  const duration = parseInt(p.get('RecordingDuration'), 10) || 0;
  const { twilioNumber, callerNumber } = resolveDialCallbackNumbers(p, query);

  if (!recordingUrl || duration < 1 || !twilioNumber || !callerNumber) {
    return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  }

  resolveClient(twilioNumber).then((client) => {
    if (!client?.tenant) return;
    return processVoicemailRecording({
      tenant: client.tenant,
      callerPhone: callerNumber,
      twilioNumber,
      recordingUrl,
      recordingSid,
      durationSec: duration,
    }).then(() => client).catch(async (e) => {
      console.error('voice-recording', e.message);
      const { notifyAdminClientError } = require('../../lib/admin-alert');
      await notifyAdminClientError({
        area: 'messagerie',
        error: e,
        tenant: client.tenant,
        extra: { callerNumber, twilioNumber, recordingSid },
      });
    });
  }).catch((e) => console.error('voice-recording resolve', e.message));

  return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
};
