const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getTenantByWidgetId, webCallerId } = require('../../lib/widget');
const { rowToDossier } = require('../../lib/dossier-builder');
const { convoKey } = require('../../lib/twilio-util');
const { loadHistory, saveHistory } = require('../../lib/store');
const { generateReply, withAiBudget, buildTimeoutFallback } = require('../../lib/ai');
const { logMessage } = require('../../lib/tenant');
const { logEvent } = require('../../lib/events');
const { touchThread } = require('../../lib/inbox');
const { processInboundActions } = require('../../lib/agent-tools');
const { checkRateLimit, clientIp } = require('../../lib/rate-limit');
const { loadThreadQualification } = require('../../lib/qualification');
const { resolveBookingAction } = require('../../lib/service-workflows');

const AI_BUDGET_MS = 9000;
const CALENDAR_BUDGET_MS = 4000;

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

  const rl = await checkRateLimit(`widget:${widgetId}:${sessionId}`, { maxAttempts: 40, windowMinutes: 60 });
  if (!rl.ok) return json(429, { error: 'Trop de messages — réessayez plus tard.' });

  const ipRl = await checkRateLimit(`widget-ip:${clientIp(event)}`, { maxAttempts: 120, windowMinutes: 60 });
  if (!ipRl.ok) return json(429, { error: 'Limite atteinte — réessayez plus tard.' });

  const dossier = rowToDossier(tenant);
  const callerPhone = webCallerId(sessionId);
  if (!callerPhone) return json(400, { error: 'Session invalide' });

  const key = convoKey(tenant.twilio_number, callerPhone);

  try {
    await logMessage(tenant.id, callerPhone, 'inbound', message);
    await logEvent(tenant.id, callerPhone, 'sms_inbound', { body: message.slice(0, 160), channel: 'web' });
    await touchThread(tenant.id, callerPhone, message, 'open');

    const history = await loadHistory(key, tenant.id, callerPhone);
    const priorAssistantCount = history.filter((m) => m.role === 'assistant').length;
    history.push({ role: 'user', content: message });
    const qualificationData = await loadThreadQualification(tenant.id, callerPhone).catch(() => ({}));
    const { hasConnectedCalendar } = require('../../lib/calendar');
    const calendarConnected = await hasConnectedCalendar(tenant.id);
    const bookingAction = resolveBookingAction({
      services: tenant.services,
      userMessage: message,
      qualificationData,
      calendarConnected,
      reservationLinks: tenant.reservation_links,
      reservationUrl: tenant.reservation_url,
      tenant,
    });
    let timedOut = false;
    let reply = null;
    try {
      reply = await withAiBudget(
        generateReply(dossier, history.slice(0, -1), message, tenant.id, {
          bookingAction,
          qualificationData,
        }),
        AI_BUDGET_MS,
      );
      if (!reply) timedOut = true;
    } catch (e) {
      console.error('widget generateReply', e.message);
      timedOut = true;
    }
    if (!reply) {
      reply = buildTimeoutFallback({
        tenant,
        dossier,
        userMessage: message,
        priorAssistantCount,
      });
    }

    let calendarBooking = null;
    try {
      const {
        maybeCreateCalendarEventWithBudget,
        applyCalendarConfirmationToReply,
      } = require('../../lib/calendar');
      if (timedOut) {
        calendarBooking = { skipped: 'timeout', action: bookingAction };
      } else if (bookingAction && !bookingAction.create) {
        calendarBooking = { skipped: bookingAction.action, action: bookingAction };
      } else if (calendarConnected) {
        calendarBooking = await maybeCreateCalendarEventWithBudget({
          tenant,
          callerPhone,
          userMessage: message,
          aiReply: reply,
          history,
          qualificationData,
          bookingAction,
        }, CALENDAR_BUDGET_MS);
      }
      const adj = applyCalendarConfirmationToReply({
        reply,
        tenant,
        booking: calendarBooking,
        userMessage: message,
        aiReply: reply,
        bookingAction,
        durationMin: bookingAction && bookingAction.durationMin,
      });
      reply = adj.reply;
    } catch (calErr) {
      console.warn('widget calendar', calErr.message);
      calendarBooking = { skipped: 'error', error: calErr.message };
    }

    history.push({ role: 'assistant', content: reply });
    await saveHistory(key, history, tenant.id, callerPhone);
    await logMessage(tenant.id, callerPhone, 'outbound', reply);
    await logEvent(tenant.id, callerPhone, 'sms_outbound', {
      body: reply.slice(0, 160),
      channel: 'web',
      ai: true,
      timed_out: timedOut,
    });
    await touchThread(tenant.id, callerPhone, reply, 'open');

    processInboundActions({
      tenant,
      callerPhone,
      userMessage: message,
      aiReply: reply,
      history,
      calendarBooking,
    }).catch((e) => console.error('widget agent-tools', e.message));

    return json(200, { reply });
  } catch (e) {
    console.error('api-widget-chat', e);
    return json(500, { error: 'Réponse impossible pour le moment' });
  }
};
