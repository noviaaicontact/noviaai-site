/**
 * Relance SMS unique si le client ne répond pas au texto d’appel manqué.
 * Délai 3 h, heures calmes 9 h–19 h America/Toronto, max 1 par fil.
 */
const { getAdmin, isDbConfigured } = require('./db');
const { sendSMS } = require('./sms-send');
const { logMessage, isActive } = require('./tenant');
const { logEvent } = require('./events');
const { isOptedOut, appendPromoFooter } = require('./sms-compliance');
const { checkSmsQuota } = require('./usage-limits');
const { touchThread } = require('./inbox');
const { toE164 } = require('./phone-util');
const { convoKey } = require('./twilio-util');
const { loadHistory, saveHistory } = require('./store');

const DELAY_MS = 3 * 60 * 60 * 1000;
const TZ = 'America/Toronto';
const QUIET_START = 9;
const QUIET_END = 19;

function isSmsConversation(callerPhone) {
  return callerPhone && !String(callerPhone).startsWith('web:');
}

function torontoHour(date) {
  return Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(date)
  );
}

function computeFollowupAt(fromDate = new Date()) {
  let t = new Date(fromDate.getTime() + DELAY_MS);
  for (let i = 0; i < 48; i += 1) {
    const hour = torontoHour(t);
    if (hour >= QUIET_START && hour < QUIET_END) return t.toISOString();
    t = new Date(t.getTime() + 30 * 60 * 1000);
  }
  return t.toISOString();
}

function buildFollowupMessage(tenant) {
  const name = tenant.agent_name || 'Léa';
  const biz = tenant.business_name || 'notre commerce';
  const body = `Ici ${name}, de ${biz}. Je voulais m'assurer que vous avez bien reçu mon texto. Comment puis-je vous aider ?`;
  return appendPromoFooter(body, biz);
}

async function scheduleMissedCallFollowup(tenant, to) {
  if (!isDbConfigured() || !tenant?.id || !to) return;
  if (!isSmsConversation(to)) return;
  const phone = toE164(to) || String(to).replace(/\s/g, '');
  const db = getAdmin();
  const { data } = await db
    .from('sms_threads')
    .select('followup_sent_at')
    .eq('tenant_id', tenant.id)
    .eq('caller_phone', phone)
    .maybeSingle();
  if (data?.followup_sent_at) return;
  await db.from('sms_threads').upsert({
    tenant_id: tenant.id,
    caller_phone: phone,
    followup_pending_at: computeFollowupAt(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,caller_phone' });
}

async function clearFollowupPending(tenantId, phone) {
  if (!isDbConfigured() || !tenantId || !phone) return;
  const caller = toE164(phone) || String(phone).replace(/\s/g, '');
  await getAdmin()
    .from('sms_threads')
    .update({ followup_pending_at: null, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('caller_phone', caller);
}

async function lastMessageDirection(tenantId, phone) {
  const { data } = await getAdmin()
    .from('sms_messages')
    .select('direction')
    .eq('tenant_id', tenantId)
    .eq('caller_phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.direction || null;
}

async function processDueFollowups() {
  if (!isDbConfigured()) return { processed: 0, sent: 0, skipped: 0 };
  const db = getAdmin();
  const now = new Date().toISOString();
  const { data: due, error } = await db
    .from('sms_threads')
    .select('tenant_id, caller_phone')
    .not('followup_pending_at', 'is', null)
    .is('followup_sent_at', null)
    .lte('followup_pending_at', now)
    .limit(40);

  if (error) {
    console.warn('processDueFollowups', error.message);
    return { processed: 0, sent: 0, skipped: 0, error: error.message };
  }

  let sent = 0;
  let skipped = 0;
  for (const row of due || []) {
    try {
      if (!isSmsConversation(row.caller_phone)) {
        await clearFollowupPending(row.tenant_id, row.caller_phone);
        skipped += 1;
        continue;
      }
      const lastDir = await lastMessageDirection(row.tenant_id, row.caller_phone);
      if (lastDir === 'inbound') {
        await clearFollowupPending(row.tenant_id, row.caller_phone);
        skipped += 1;
        continue;
      }

      const { data: tenant } = await db.from('tenants').select('*').eq('id', row.tenant_id).maybeSingle();
      if (!tenant || !isActive(tenant) || !tenant.twilio_number || tenant.provisioning_status !== 'active') {
        await clearFollowupPending(row.tenant_id, row.caller_phone);
        skipped += 1;
        continue;
      }
      if (await isOptedOut(tenant.id, row.caller_phone)) {
        await clearFollowupPending(row.tenant_id, row.caller_phone);
        skipped += 1;
        continue;
      }

      const quota = await checkSmsQuota(tenant);
      if (!quota.ok) {
        skipped += 1;
        continue;
      }

      const body = buildFollowupMessage(tenant);
      const to = toE164(row.caller_phone) || row.caller_phone;
      const from = toE164(tenant.twilio_number) || tenant.twilio_number;
      await sendSMS({ to, from, body });
      await logMessage(tenant.id, to, 'outbound', body);
      await logEvent(tenant.id, to, 'sms_followup', { body: body.slice(0, 160) });
      await touchThread(tenant.id, to, body, 'open');

      const key = convoKey(from, to);
      const history = await loadHistory(key, tenant.id, to);
      history.push({ role: 'assistant', content: body });
      await saveHistory(key, history, tenant.id, to);

      await db.from('sms_threads').update({
        followup_pending_at: null,
        followup_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('tenant_id', tenant.id).eq('caller_phone', row.caller_phone);
      sent += 1;
    } catch (e) {
      console.warn('processDueFollowups send', row.caller_phone, e.message);
      skipped += 1;
    }
  }

  return { processed: (due || []).length, sent, skipped };
}

module.exports = {
  scheduleMissedCallFollowup,
  clearFollowupPending,
  processDueFollowups,
  computeFollowupAt,
  buildFollowupMessage,
};
