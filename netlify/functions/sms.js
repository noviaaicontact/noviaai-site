const { parseBody, twimlMessage, xmlResponse, convoKey, validateTwilioRequest, twilioUnauthorized } = require('../../lib/twilio-util');
const { resolveClient, logMessage } = require('../../lib/tenant');
const { logEvent } = require('../../lib/events');
const { touchThread } = require('../../lib/inbox');
const { loadHistory, saveHistory } = require('../../lib/store');
const { generateReply } = require('../../lib/ai');
const { processInboundActions } = require('../../lib/agent-tools');

const DEFAULT_ACK = 'Merci pour votre message! Nous vous répondrons très bientôt.';
const SUSPENDED_MSG = 'Ce service NoviaAI est temporairement suspendu. Veuillez rappeler plus tard.';

exports.handler = async (event) => {
  try {
    if (!validateTwilioRequest(event)) return twilioUnauthorized();

    const p = parseBody(event);
    const from = p.get('From');
    const to = p.get('To');
    const body = (p.get('Body') || '').trim();
    if (!from || !to) return xmlResponse(twimlMessage(DEFAULT_ACK));

    const client = await resolveClient(to);
    if (client.suspended) return xmlResponse(twimlMessage(SUSPENDED_MSG));

    const tenantId = client && client.tenant && client.tenant.id;
    const dossier = client && client.dossier;
    const key = convoKey(to, from);

    if (tenantId && body) {
      await logMessage(tenantId, from, 'inbound', body);
      await logEvent(tenantId, from, 'sms_inbound', { body: body.slice(0, 160) });
      await touchThread(tenantId, from, body, 'open');
    }

    let reply = null;
    if (body && dossier) {
      const history = await loadHistory(key, tenantId, from);
      history.push({ role: 'user', content: body });
      reply = await generateReply(dossier, history.slice(0, -1), body, tenantId);
      if (reply) {
        history.push({ role: 'assistant', content: reply });
        await saveHistory(key, history, tenantId, from);
      }
    }

    if (!reply) {
      reply = (client && client.tenant && client.tenant.welcome_sms)
        || (dossier && dossier.scripts && dossier.scripts.accueil)
        || DEFAULT_ACK;
    }

    if (tenantId) {
      await logMessage(tenantId, from, 'outbound', reply);
      await logEvent(tenantId, from, 'sms_outbound', {
        body: reply.slice(0, 160),
        auto: true,
        ai: !!process.env.OPENAI_API_KEY,
      });
      if (body && client.tenant) {
        processInboundActions({
          tenant: client.tenant,
          callerPhone: from,
          userMessage: body,
          aiReply: reply,
        }).catch((e) => console.error('agent-tools', e.message));
      }
    }

    return xmlResponse(twimlMessage(reply));
  } catch (e) {
    console.error('sms error', e);
    return xmlResponse(twimlMessage(DEFAULT_ACK));
  }
};
