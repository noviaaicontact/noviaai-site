// Envoi de SMS sortants (utilisé par le rattrapeur d'appels manqués).
const { getClientByNumber } = require('./clients');
const { saveHistory } = require('./store');
const { logMessage, logMissedCall } = require('./tenant');
const { convoKey } = require('./twilio-util');
const { logEvent } = require('./events');
const { touchThread } = require('./inbox');

function textbackMessage(dossier) {
  const s = (dossier && dossier.scripts) || {};
  const agent = (dossier && dossier.identite_agent && dossier.identite_agent.nom_agent) || 'notre équipe';
  return s.texto_rappel || s.accueil ||
    `Bonjour! Désolé, on a manqué votre appel. Répondez à ce texto — ${agent} vous répondra tout de suite pour votre demande. 😊`;
}

async function sendTextback(businessNumber, callerNumber) {
  const client = await getClientByNumber(businessNumber);
  const tenantId = client && client.tenant && client.tenant.id;
  if (!client || !client.tenant) {
    console.error('textback: tenant introuvable pour', businessNumber);
    return;
  }
  const msg = textbackMessage(client.dossier);
  let textbackOk = false;
  let smsError = null;
  try {
    await sendSMS({ to: callerNumber, from: businessNumber, body: msg });
    textbackOk = true;
  } catch (e) {
    smsError = e;
    console.error('textback SMS failed', {
      to: callerNumber,
      from: businessNumber,
      error: e.message,
      code: e.code,
    });
  }

  if (tenantId) {
    await logMissedCall(tenantId, callerNumber, textbackOk);
    if (textbackOk) {
      const key = convoKey(businessNumber, callerNumber);
      await saveHistory(key, [{ role: 'assistant', content: msg }], tenantId, callerNumber);
      await logMessage(tenantId, callerNumber, 'outbound', msg);
      await logEvent(tenantId, callerNumber, 'missed_call', { textback: true });
      await logEvent(tenantId, callerNumber, 'sms_outbound', { body: msg.slice(0, 160), trigger: 'missed_call' });
      await touchThread(tenantId, callerNumber, msg, 'open');
      const { sendMissedCallAlert } = require('./email');
      await sendMissedCallAlert(client.tenant, callerNumber).catch(() => {});
    } else if (smsError) {
      await logEvent(tenantId, callerNumber, 'missed_call', {
        textback: false,
        error: smsError.message,
        code: smsError.code || null,
      });
    }
  }

  if (smsError) throw smsError;
}

async function sendSMS({ to, from, body }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio non configuré (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
  const twilio = require('twilio');
  const c = twilio(sid, token);
  return c.messages.create({ to, from, body });
}

module.exports = { sendTextback, sendSMS, textbackMessage };
