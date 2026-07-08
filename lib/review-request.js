const { sendSMS } = require('./sms-send');
const { logMessage } = require('./tenant');
const { logEvent } = require('./events');
const { touchThread, getThreadMessages } = require('./inbox');
const { getAdmin, isDbConfigured } = require('./db');
const { toE164 } = require('./phone-util');
const {
  evaluateReviewEligibility,
  hasNegativeInboundText,
} = require('./review-eligibility');

const DEFAULT_DELAY_MINUTES = 5;

function buildReviewMessage(tenant) {
  const url = (tenant.google_review_url || '').trim();
  if (!url) return null;
  const template = (tenant.review_request_sms || '').trim()
    || 'Merci d\'avoir choisi {{commerce}}! Un petit avis Google nous aide énormément: {{lien}}';
  return template
    .replace(/\{\{commerce\}\}/g, tenant.business_name || 'notre commerce')
    .replace(/\{\{lien\}\}/g, url);
}

function isSmsConversation(callerPhone) {
  return callerPhone && !String(callerPhone).startsWith('web:');
}

function getReviewDelayMinutes(tenant) {
  const n = parseInt(tenant?.review_request_delay_minutes, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 120) return n;
  return DEFAULT_DELAY_MINUTES;
}

async function getThreadRow(tenantId, callerPhone) {
  if (!isDbConfigured()) return null;
  const db = getAdmin();
  const { data } = await db
    .from('sms_threads')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('caller_phone', callerPhone)
    .maybeSingle();
  return data;
}

async function threadReviewAlreadySent(tenantId, callerPhone) {
  const row = await getThreadRow(tenantId, callerPhone);
  return !!(row && row.review_request_sent_at);
}

async function clearReviewPending(tenantId, callerPhone) {
  if (!isDbConfigured()) return;
  const db = getAdmin();
  await db.from('sms_threads').update({
    review_pending_at: null,
    updated_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId).eq('caller_phone', callerPhone);
}

async function scheduleReviewPending(tenantId, callerPhone, delayMinutes) {
  if (!isDbConfigured()) return null;
  const db = getAdmin();
  const sendAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
  await db.from('sms_threads').upsert({
    tenant_id: tenantId,
    caller_phone: callerPhone,
    review_pending_at: sendAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,caller_phone' });
  return sendAt;
}

async function markReviewSent(tenantId, callerPhone) {
  if (!isDbConfigured()) return;
  const db = getAdmin();
  await db.from('sms_threads').upsert({
    tenant_id: tenantId,
    caller_phone: callerPhone,
    review_request_sent_at: new Date().toISOString(),
    review_pending_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,caller_phone' });
  const { data: t } = await db.from('tenants').select('review_requests_sent').eq('id', tenantId).single();
  await db.from('tenants').update({
    review_requests_sent: (t?.review_requests_sent || 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq('id', tenantId);
}

async function sendReviewRequest(tenant, callerPhone, { manual = false } = {}) {
  const msg = buildReviewMessage(tenant);
  if (!msg) throw new Error('Lien avis Google non configuré');
  if (!tenant.twilio_number || tenant.provisioning_status !== 'active') {
    throw new Error('Ligne NoviaAI non active');
  }
  if (!isSmsConversation(callerPhone)) {
    throw new Error('Demande d\'avis disponible pour les conversations SMS seulement');
  }
  if (await threadReviewAlreadySent(tenant.id, callerPhone)) {
    throw new Error('Demande d\'avis déjà envoyée pour cette conversation');
  }

  const to = toE164(callerPhone);
  const from = toE164(tenant.twilio_number);
  await sendSMS({ to, from, body: msg });
  await logMessage(tenant.id, callerPhone, 'outbound', msg);
  await logEvent(tenant.id, callerPhone, 'sms_outbound', {
    body: msg.slice(0, 160),
    review_request: true,
    manual: !!manual,
  });
  await touchThread(tenant.id, callerPhone, msg, 'open');
  await markReviewSent(tenant.id, callerPhone);
  return { ok: true, message: msg };
}

async function loadEligibilityContext(tenantId, callerPhone) {
  const { messages, thread, events } = await getThreadMessages(tenantId, callerPhone, 40);
  const inbound = (messages || []).filter((m) => m.direction === 'inbound');
  const hasLead = (events || []).some((e) => e.event_type === 'lead_created')
    || thread?.status === 'lead';
  const history = (messages || []).map((m) => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.body,
  }));
  return { messages, thread, events, inbound, hasLead, history };
}

async function maybeAutoReviewRequest({
  tenant,
  callerPhone,
  userMessage,
  aiReply,
  history,
}) {
  if (!tenant?.auto_review_request || !tenant.google_review_url) return null;
  if (!isSmsConversation(callerPhone)) return null;
  if (await threadReviewAlreadySent(tenant.id, callerPhone)) return null;

  if (hasNegativeInboundText(userMessage)) {
    await clearReviewPending(tenant.id, callerPhone);
    return null;
  }

  const ctx = await loadEligibilityContext(tenant.id, callerPhone);
  const evalHistory = history?.length ? history : ctx.history;

  const eligibility = await evaluateReviewEligibility({
    userMessage,
    aiReply,
    history: evalHistory,
    inboundMessages: ctx.inbound,
    events: ctx.events,
    thread: ctx.thread,
    hasLead: ctx.hasLead,
  });

  if (!eligibility.eligible) {
    await clearReviewPending(tenant.id, callerPhone);
    return null;
  }

  const delay = getReviewDelayMinutes(tenant);
  const sendAt = await scheduleReviewPending(tenant.id, callerPhone, delay);
  await logEvent(tenant.id, callerPhone, 'sms_outbound', {
    review_request_scheduled: true,
    send_at: sendAt,
    trigger: eligibility.trigger,
    reason: eligibility.reason,
  });
  return { scheduled: true, send_at: sendAt, trigger: eligibility.trigger };
}

async function processDueReviewRequests() {
  if (!isDbConfigured()) return { processed: 0, sent: 0, skipped: 0 };

  const db = getAdmin();
  const now = new Date().toISOString();
  const { data: due, error } = await db
    .from('sms_threads')
    .select('tenant_id, caller_phone, review_pending_at')
    .not('review_pending_at', 'is', null)
    .is('review_request_sent_at', null)
    .lte('review_pending_at', now)
    .limit(40);

  if (error) {
    console.error('processDueReviewRequests', error.message);
    return { processed: 0, sent: 0, skipped: 0, error: error.message };
  }

  let sent = 0;
  let skipped = 0;

  for (const row of due || []) {
    const { data: tenant } = await db.from('tenants').select('*').eq('id', row.tenant_id).maybeSingle();
    if (!tenant || !tenant.auto_review_request || !tenant.google_review_url) {
      await clearReviewPending(row.tenant_id, row.caller_phone);
      skipped += 1;
      continue;
    }

    const ctx = await loadEligibilityContext(row.tenant_id, row.caller_phone);
    const lastInbound = ctx.inbound[ctx.inbound.length - 1];
    const lastOutbound = (ctx.messages || []).filter((m) => m.direction === 'outbound').pop();

    const eligibility = await evaluateReviewEligibility({
      userMessage: lastInbound?.body || '',
      aiReply: lastOutbound?.body || '',
      history: ctx.history.slice(0, -1),
      inboundMessages: ctx.inbound,
      events: ctx.events,
      thread: ctx.thread,
      hasLead: ctx.hasLead,
    });

    if (!eligibility.eligible) {
      await clearReviewPending(row.tenant_id, row.caller_phone);
      skipped += 1;
      continue;
    }

    try {
      await sendReviewRequest(tenant, row.caller_phone, { manual: false });
      sent += 1;
    } catch (e) {
      console.warn('processDueReviewRequests send', row.caller_phone, e.message);
      await clearReviewPending(row.tenant_id, row.caller_phone);
      skipped += 1;
    }
  }

  return { processed: (due || []).length, sent, skipped };
}

module.exports = {
  buildReviewMessage,
  sendReviewRequest,
  maybeAutoReviewRequest,
  processDueReviewRequests,
  clearReviewPending,
  getReviewDelayMinutes,
  isSmsConversation,
};
