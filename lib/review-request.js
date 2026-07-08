const { sendSMS } = require('./sms-send');
const { logMessage } = require('./tenant');
const { logEvent } = require('./events');
const { touchThread } = require('./inbox');
const { getAdmin, isDbConfigured } = require('./db');
const { toE164 } = require('./phone-util');

const THANK_RE = /merci|super|parfait|génial|genial|excellent|à bientôt|a bientot|au plaisir|belle journée|belle journee|content|satisfait/i;

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

async function threadReviewAlreadySent(tenantId, callerPhone) {
  if (!isDbConfigured()) return false;
  const db = getAdmin();
  const { data } = await db
    .from('sms_threads')
    .select('review_request_sent_at')
    .eq('tenant_id', tenantId)
    .eq('caller_phone', callerPhone)
    .maybeSingle();
  return !!(data && data.review_request_sent_at);
}

async function markReviewSent(tenantId, callerPhone) {
  if (!isDbConfigured()) return;
  const db = getAdmin();
  await db.from('sms_threads').upsert({
    tenant_id: tenantId,
    caller_phone: callerPhone,
    review_request_sent_at: new Date().toISOString(),
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

function shouldAutoReviewRequest(tenant, userMessage) {
  if (!tenant.auto_review_request || !tenant.google_review_url) return false;
  return THANK_RE.test(userMessage || '');
}

async function maybeAutoReviewRequest({ tenant, callerPhone, userMessage }) {
  if (!shouldAutoReviewRequest(tenant, userMessage)) return null;
  if (!isSmsConversation(callerPhone)) return null;
  if (await threadReviewAlreadySent(tenant.id, callerPhone)) return null;
  try {
    return await sendReviewRequest(tenant, callerPhone, { manual: false });
  } catch (e) {
    console.warn('auto review', e.message);
    return null;
  }
}

module.exports = {
  buildReviewMessage,
  sendReviewRequest,
  maybeAutoReviewRequest,
  shouldAutoReviewRequest,
  isSmsConversation,
};
