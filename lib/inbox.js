const { getAdmin, isDbConfigured } = require('./db');
const { formatQualificationSummaryText, normalizeQualificationFields } = require('./qualification');
const { toE164, isTestCaller } = require('./phone-util');

function normalizePhone(p) {
  return toE164(p) || String(p || '').replace(/\s/g, '');
}

async function getConversations(tenantId, limit = 40) {
  if (!isDbConfigured() || !tenantId) return [];
  const db = getAdmin();

  const [threads, msgs, missed, leads] = await Promise.all([
    db.from('sms_threads').select('*').eq('tenant_id', tenantId).order('updated_at', { ascending: false }).limit(limit),
    db.from('sms_messages').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(500),
    db.from('missed_calls').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(100),
    db.from('leads').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(100),
  ]);

  const map = new Map();

  function ensure(phone) {
    const key = normalizePhone(phone);
    if (!key) return null;
    if (!map.has(key)) {
      map.set(key, {
        caller_phone: phone,
        status: 'open',
        last_at: null,
        last_preview: '',
        message_count: 0,
        missed_calls: 0,
        has_lead: false,
        lead_summary: null,
        messages: [],
      });
    }
    return map.get(key);
  }

  (threads.data || []).forEach((t) => {
    const c = ensure(t.caller_phone);
    if (!c) return;
    c.status = t.status || c.status;
    if (t.updated_at && (!c.last_at || t.updated_at > c.last_at)) {
      c.last_at = t.updated_at;
    }
    if (t.last_preview) c.last_preview = t.last_preview;
    if (t.qualification_data && Object.keys(t.qualification_data).length) {
      c.qualification_data = t.qualification_data;
      const qPreview = formatQualificationSummaryText(t.qualification_data, normalizeQualificationFields([]));
      if (qPreview) c.last_preview = qPreview.slice(0, 120);
    }
    const hist = t.history || [];
    if (hist.length && !c.last_preview) {
      const last = hist[hist.length - 1];
      c.last_preview = (last.content || '').slice(0, 120);
    }
  });

  (msgs.data || []).forEach((m) => {
    const c = ensure(m.caller_phone);
    if (!c) return;
    c.message_count += 1;
    if (!c.last_at || m.created_at > c.last_at) {
      c.last_at = m.created_at;
      c.last_preview = m.body.slice(0, 120);
    }
  });

  (missed.data || []).forEach((m) => {
    const c = ensure(m.caller_phone);
    if (!c) return;
    c.missed_calls += 1;
    if (!c.last_at || m.created_at > c.last_at) c.last_at = m.created_at;
  });

  (leads.data || []).forEach((l) => {
    const c = ensure(l.caller_phone);
    if (!c) return;
    c.has_lead = true;
    c.status = l.status === 'escalated' ? 'lead' : 'lead';
    c.lead_summary = l.summary;
  });

  return [...map.values()]
    .filter((c) => !isTestCaller(c.caller_phone))
    .sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0))
    .slice(0, limit);
}

async function getThreadMessages(tenantId, callerPhone, limit = 100) {
  if (!isDbConfigured() || !tenantId) return { messages: [], thread: null };
  const db = getAdmin();
  const phone = normalizePhone(callerPhone);

  const [msgs, thread, events] = await Promise.all([
    db.from('sms_messages')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('caller_phone', phone)
      .order('created_at', { ascending: true })
      .limit(limit),
    db.from('sms_threads')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('caller_phone', phone)
      .maybeSingle(),
    db.from('conversation_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('caller_phone', phone)
      .order('created_at', { ascending: true })
      .limit(50)
      .then((r) => r)
      .catch(() => ({ data: [] })),
  ]);

  return {
    messages: msgs.data || [],
    thread: thread.data || null,
    events: events.data || [],
  };
}

async function touchThread(tenantId, callerPhone, preview, status) {
  if (!isDbConfigured() || !tenantId) return;
  if (isTestCaller(callerPhone)) return;
  const db = getAdmin();
  const phone = normalizePhone(callerPhone);
  if (!phone) return;
  const patch = {
    tenant_id: tenantId,
    caller_phone: phone,
    updated_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
    last_preview: (preview || '').slice(0, 200),
  };
  if (status) patch.status = status;
  await db.from('sms_threads').upsert(patch, { onConflict: 'tenant_id,caller_phone' });
}

module.exports = { getConversations, getThreadMessages, touchThread };
