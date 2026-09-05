const { toE164, digitsOnly } = require('./phone-util');
const { isOpenNow, hoursLookConfigured } = require('./calendar/slots');

function last10Digits(raw) {
  const d = digitsOnly(raw);
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  if (d.length >= 10) return d.slice(-10);
  return '';
}

function sameNaPhone(a, b) {
  const x = last10Digits(a);
  const y = last10Digits(b);
  return x.length === 10 && x === y;
}

/**
 * Hors heures + renvoi vers la ligne publique du magasin → ne pas composer
 * (leur répondeur « décroche » et on rate le texto). Un cell proprio différent sonne encore.
 */
function shouldSkipStoreForward({ hours, forwardTo, storePhone, at } = {}) {
  if (!forwardTo || !storePhone) return false;
  if (!sameNaPhone(forwardTo, storePhone)) return false;
  if (!hoursLookConfigured(hours)) return false;
  return !isOpenNow(hours, at);
}

/** Numéros fiables depuis le callback Twilio `<Dial action="...">`. */
function resolveDialCallbackNumbers(params, query) {
  const q = query || {};
  const twilioNumber = toE164(
    q.tn || q.twilio || params.get('Called') || params.get('To'),
  );
  const callerNumber = toE164(params.get('From') || params.get('Caller'));
  return { twilioNumber, callerNumber };
}

/** En dessous : répondeur / bip. Au-dessus : quelqu'un a décroché. */
const HUMAN_ANSWER_MIN_SEC = 18;

/**
 * Déclencher le SMS de rattrapage ?
 * - no-answer / busy / failed / canceled : classique
 * - completed sans pont : pas de vraie conversation
 * - completed très court : répondeur qui « décroche » sans humain
 * Un humain qui répond 20–90 s ne doit PAS recevoir le texto (seuil 90 s trop large).
 */
function shouldSendTextback(dialStatus, dialDuration, dialBridged) {
  if (['no-answer', 'busy', 'failed', 'canceled'].includes(dialStatus)) return true;
  if (dialStatus !== 'completed') return false;
  if (dialBridged === 'false' || dialBridged === false) return true;
  const seconds = Number(dialDuration) || 0;
  return seconds > 0 && seconds < HUMAN_ANSWER_MIN_SEC;
}

module.exports = {
  resolveDialCallbackNumbers,
  shouldSendTextback,
  sameNaPhone,
  shouldSkipStoreForward,
  HUMAN_ANSWER_MIN_SEC,
};
