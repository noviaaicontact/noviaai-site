const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getTenantByWidgetId, webCallerId } = require('../../lib/widget');
const { rowToDossier } = require('../../lib/dossier-builder');
const { convoKey } = require('../../lib/twilio-util');
const { loadHistory, saveHistory } = require('../../lib/store');
const { generateReply } = require('../../lib/ai');
const { logMessage } = require('../../lib/tenant');
const { logEvent } = require('../../lib/events');
const { touchThread } = require('../../lib/inbox');
const { processInboundActions } = require('../../lib/agent-tools');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const body = parseJson(event);
  const widgetId = (body.widgetId || body.widget_id || '').trim();
  const sessionId = (body.sessionId || body.session_id || '').trim();
  const message = (body.message || '').trim();

  if (!widgetId || !sessionId) return json(400, { error: 'widgetId et sessionId requis' });
  if (!message || message.length > 800) return json(400, { error: 'Message invalide' });

  const tenant = await getTenantByWidgetId(widgetId);
  if (!tenant) return json(404, { error: 'Widget introuvable ou inactif' });

  const dossier = rowToDossier(tenant);
  const callerPhone = webCallerId(sessionId);
  if (!callerPhone) return json(400, { error: 'Session invalide' });

  const key = convoKey(tenant.twilio_number, callerPhone);

  try {
    await logMessage(tenant.id, callerPhone, 'inbound', message);
    await logEvent(tenant.id, callerPhone, 'sms_inbound', { body: message.slice(0, 160), channel: 'web' });
    await touchThread(tenant.id, callerPhone, message, 'open');

    const history = await loadHistory(key, tenant.id, callerPhone);
    history.push({ role: 'user', content: message });
    let reply = await generateReply(dossier, history.slice(0, -1), message, tenant.id);

    if (!reply) {
      reply = tenant.welcome_sms
        || (dossier.scripts && dossier.scripts.accueil)
        || 'Merci pour votre message! Nous vous répondrons très bientôt.';
    }

    history.push({ role: 'assistant', content: reply });
    await saveHistory(key, history, tenant.id, callerPhone);
    await logMessage(tenant.id, callerPhone, 'outbound', reply);
    await logEvent(tenant.id, callerPhone, 'sms_outbound', {
      body: reply.slice(0, 160),
      channel: 'web',
      ai: true,
    });
    await touchThread(tenant.id, callerPhone, reply, 'open');

    processInboundActions({
      tenant,
      callerPhone,
      userMessage: message,
      aiReply: reply,
    }).catch((e) => console.error('widget agent-tools', e.message));

    return json(200, { reply });
  } catch (e) {
    console.error('api-widget-chat', e);
    return json(500, { error: 'Réponse impossible pour le moment' });
  }
};
