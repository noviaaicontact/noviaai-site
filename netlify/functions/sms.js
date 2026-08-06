const { parseBody, twimlMessage, xmlResponse, convoKey, validateTwilioRequest, twilioUnauthorized } = require('../../lib/twilio-util');
const { resolveClient, logMessage } = require('../../lib/tenant');
const { logEvent } = require('../../lib/events');
const { touchThread } = require('../../lib/inbox');
const { loadHistory, saveHistory } = require('../../lib/store');
const { generateReply } = require('../../lib/ai');
const { processInboundActions } = require('../../lib/agent-tools');
const { maybeAutoReviewRequest, clearReviewPending } = require('../../lib/review-request');
const { hasNegativeInboundText } = require('../../lib/review-eligibility');
const {
  isOptOutMessage,
  isOptInMessage,
  isOptedOut,
  recordOptOut,
  clearOptOut,
  appendPromoFooter,
  OPT_OUT_ACK,
  OPT_IN_ACK,
} = require('../../lib/sms-compliance');

const DEFAULT_ACK = 'Merci pour votre message! Nous vous répondrons très bientôt.';
const OPTED_OUT_MSG = 'Vous êtes désinscrit(e) des textos. Répondez OUI pour vous réabonner, ou appelez-nous directement.';
const AI_TIMEOUT_MSG = 'Un instant, on vous revient tout de suite.';
const SUSPENDED_SMS = 'Cette ligne est temporairement inactive. Veuillez appeler le commerce directement ou réessayez plus tard.';
/** Budget max pour l'IA — Twilio abandonne le webhook ~15s; on garde une marge. */
const AI_BUDGET_MS = 9000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

exports.handler = async (event) => {
  try {
    const p = parseBody(event);
    if (!validateTwilioRequest(event)) {
      console.warn('sms: unauthorized twilio request', {
        to: p.get('To'),
        from: p.get('From'),
      });
      return twilioUnauthorized();
    }

    const from = p.get('From');
    const to = p.get('To');
    const body = (p.get('Body') || '').trim();
    if (!from || !to) return xmlResponse(twimlMessage(DEFAULT_ACK));

    const client = await resolveClient(to);

    const tenantId = client && client.tenant && client.tenant.id;
    const dossier = client && client.dossier;
    const key = convoKey(to, from);

    if (tenantId && body && isOptOutMessage(body)) {
      await recordOptOut(tenantId, from);
      await logMessage(tenantId, from, 'inbound', body);
      await logEvent(tenantId, from, 'sms_opt_out', { body: body.slice(0, 80) });
      return xmlResponse(twimlMessage(OPT_OUT_ACK));
    }

    // Réabonnement seulement si le numéro était vraiment opted-out.
    // Sinon « Oui » / confirmations RDV passent à l'agent IA.
    if (tenantId && body && isOptInMessage(body) && (await isOptedOut(tenantId, from))) {
      await clearOptOut(tenantId, from);
      await logMessage(tenantId, from, 'inbound', body);
      await logEvent(tenantId, from, 'sms_opt_in', { body: body.slice(0, 80) });
      return xmlResponse(twimlMessage(OPT_IN_ACK));
    }

    if (tenantId && body && (await isOptedOut(tenantId, from))) {
      await logMessage(tenantId, from, 'inbound', body);
      await logEvent(tenantId, from, 'sms_inbound', { body: body.slice(0, 160), opted_out: true });
      return xmlResponse(twimlMessage(OPTED_OUT_MSG));
    }

    // Aligné avec la voix : pas d'agent IA ni de coûts si l'abo est mort.
    // LCAP (ARRET/OUI) reste géré ci-dessus.
    if (client && client.suspended) {
      if (tenantId && body) {
        await logMessage(tenantId, from, 'inbound', body);
        await logEvent(tenantId, from, 'sms_inbound', { body: body.slice(0, 160), suspended: true });
      }
      return xmlResponse(twimlMessage(SUSPENDED_SMS));
    }

    if (tenantId && client.tenant) {
      const { checkSmsQuota } = require('../../lib/usage-limits');
      const quota = await checkSmsQuota(client.tenant);
      if (!quota.ok) {
        await logMessage(tenantId, from, 'inbound', body);
        return xmlResponse(twimlMessage('Limite mensuelle de textos atteinte. Appelez-nous ou réessayez le mois prochain.'));
      }
    }

    if (tenantId && body) {
      await logMessage(tenantId, from, 'inbound', body);
      await logEvent(tenantId, from, 'sms_inbound', { body: body.slice(0, 160) });
      await touchThread(tenantId, from, body, 'open');
      if (hasNegativeInboundText(body)) {
        await clearReviewPending(tenantId, from);
      }
    }

    let reply = null;
    let timedOut = false;
    let historyForReview = [];
    let conversationHistory = [];
    let priorAssistantCount = 0;
    if (body && dossier) {
      const history = await loadHistory(key, tenantId, from);
      historyForReview = history;
      conversationHistory = history;
      priorAssistantCount = history.filter((m) => m.role === 'assistant').length;
      history.push({ role: 'user', content: body });
      try {
        reply = await withTimeout(
          generateReply(dossier, history.slice(0, -1), body, tenantId),
          AI_BUDGET_MS,
        );
        if (!reply) timedOut = true;
      } catch (e) {
        console.error('generateReply', e.message);
        reply = null;
      }
      if (reply) {
        history.push({ role: 'assistant', content: reply });
        await saveHistory(key, history, tenantId, from);
      }
    }

    if (!reply) {
      if (timedOut && priorAssistantCount > 0) {
        // En cours de fil : ne pas renvoyer le message d'accueil hors contexte
        reply = AI_TIMEOUT_MSG;
      } else {
        reply = (client && client.tenant && client.tenant.welcome_sms)
          || (dossier && dossier.scripts && dossier.scripts.accueil)
          || DEFAULT_ACK;
      }
    }

    // Footer ARRET sur la 1re réponse auto du fil (LCAP)
    if (priorAssistantCount === 0 && client && client.tenant) {
      reply = appendPromoFooter(reply, client.tenant.business_name);
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
          history: conversationHistory,
        }).catch((e) => console.error('agent-tools', e.message));
        maybeAutoReviewRequest({
          tenant: client.tenant,
          callerPhone: from,
          userMessage: body,
          aiReply: reply,
          history: historyForReview,
        }).catch((e) => console.error('auto-review', e.message));
      }
    }

    return xmlResponse(twimlMessage(reply));
  } catch (e) {
    console.error('sms error', e);
    return xmlResponse(twimlMessage(DEFAULT_ACK));
  }
};
