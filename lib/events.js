const { getAdmin, isDbConfigured } = require('./db');

async function logEvent(tenantId, callerPhone, eventType, payload = {}) {
  if (!isDbConfigured() || !tenantId || !callerPhone) return;
  try {
    const db = getAdmin();
    await db.from('conversation_events').insert({
      tenant_id: tenantId,
      caller_phone: callerPhone,
      event_type: eventType,
      payload,
    });
  } catch (e) {
    // Table may not exist yet — non-blocking
    if (!/conversation_events/i.test(e.message || '')) {
      console.warn('logEvent', eventType, e.message);
    }
  }
}

module.exports = { logEvent };
