const { toE164 } = require('./phone-util');

/** Numéros fiables depuis le callback Twilio `<Dial action="...">`. */
function resolveDialCallbackNumbers(params, query) {
  const q = query || {};
  const twilioNumber = toE164(
    q.tn || q.twilio || params.get('Called') || params.get('To'),
  );
  const callerNumber = toE164(params.get('From') || params.get('Caller'));
  return { twilioNumber, callerNumber };
}

/**
 * Déclencher le SMS de rattrapage ?
 * - no-answer / busy / failed / canceled : classique
 * - completed court : répondeur / boîte vocale qui « décroche » sans vraie conversation
 */
function shouldSendTextback(dialStatus, dialDuration, dialBridged) {
  if (['no-answer', 'busy', 'failed', 'canceled'].includes(dialStatus)) return true;
  if (dialStatus !== 'completed') return false;
  const seconds = Number(dialDuration) || 0;
  if (seconds > 0 && seconds < 18) return true;
  if (dialBridged === 'false' || dialBridged === false) return true;
  return false;
}

module.exports = { resolveDialCallbackNumbers, shouldSendTextback };
