const { getAdmin, isDbConfigured } = require('./db');
const { rowToDossier } = require('./dossier-builder');
const { toE164 } = require('./phone-util');
const salonDemo = require('../dossiers/salon-demo.json');

const FALLBACK = { key: 'salon-demo', dossier: salonDemo, tenant: null, suspended: false };

const USER_PATCHABLE_FIELDS = new Set([
  'business_name', 'business_type', 'agent_name', 'agent_tone',
  'phone_forward', 'existing_business_number', 'line_mode', 'area_code',
  'contact_email', 'welcome_sms', 'missed_call_sms', 'reservation_url',
  'address_line', 'city', 'province', 'postal_code', 'parking_info',
  'website_url', 'avg_client_value', 'hours', 'services', 'faq', 'policies',
  'onboarding_done', 'plan', 'notify_email', 'dossier',
]);

function pickPatch(patch, allowed) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  Object.keys(patch).forEach((k) => {
    if (allowed.has(k) && patch[k] !== undefined) out[k] = patch[k];
  });
  return out;
}

async function getTenantRowByTwilioNumber(num) {
  if (!num || !isDbConfigured()) return null;
  const normalized = toE164(num);
  const db = getAdmin();
  const { data, error } = await db
    .from('tenants')
    .select('*')
    .eq('twilio_number', normalized || num)
    .maybeSingle();
  if (data) return data;
  if (normalized && normalized !== num) {
    const { data: alt } = await db.from('tenants').select('*').eq('twilio_number', num).maybeSingle();
    return alt || null;
  }
  if (error) console.error('getTenantRowByTwilioNumber', error.message);
  return null;
}

async function getTenantByTwilioNumber(num) {
  const data = await getTenantRowByTwilioNumber(num);
  if (!data || !isActive(data)) return null;
  return { key: data.id, tenant: data, dossier: rowToDossier(data), suspended: false };
}

async function getTenantByUserId(userId) {
  if (!isDbConfigured()) return null;
  const db = getAdmin();
  const { data } = await db.from('tenants').select('*').eq('user_id', userId).maybeSingle();
  return data;
}

async function createTenantForUser(user, opts = {}) {
  const db = getAdmin();
  const existing = await getTenantByUserId(user.id);
  if (existing) return existing;
  const plan = ['starter', 'pro', 'business'].includes(opts.plan) ? opts.plan : 'starter';
  const { data, error } = await db.from('tenants').insert({
    user_id: user.id,
    email: user.email,
    business_name: 'Mon commerce',
    contact_email: user.email,
    subscription_status: 'trialing',
    plan,
  }).select('*').single();
  if (error) {
    if (error.code === '23505') return getTenantByUserId(user.id);
    throw error;
  }
  return data;
}

async function updateTenant(userId, patch) {
  const db = getAdmin();
  const safe = pickPatch(patch, USER_PATCHABLE_FIELDS);
  if (!Object.keys(safe).length) throw new Error('Aucun champ modifiable');
  const { data: current } = await db.from('tenants').select('*').eq('user_id', userId).maybeSingle();
  const merged = { ...(current || {}), ...safe };
  merged.dossier = rowToDossier(merged);
  merged.updated_at = new Date().toISOString();
  const { data, error } = await db.from('tenants').update(merged).eq('user_id', userId).select('*').single();
  if (error) throw error;
  return data;
}

async function logMessage(tenantId, callerPhone, direction, body) {
  if (!isDbConfigured() || !tenantId) return;
  const db = getAdmin();
  await db.from('sms_messages').insert({
    tenant_id: tenantId,
    caller_phone: callerPhone,
    direction,
    body,
  });
}

async function logMissedCall(tenantId, callerPhone, textbackSent) {
  if (!isDbConfigured() || !tenantId) return;
  const db = getAdmin();
  await db.from('missed_calls').insert({
    tenant_id: tenantId,
    caller_phone: callerPhone,
    textback_sent: !!textbackSent,
  });
}

async function loadThreadHistory(tenantId, callerPhone) {
  if (!isDbConfigured() || !tenantId) return null;
  const db = getAdmin();
  const { data } = await db.from('sms_threads')
    .select('history')
    .eq('tenant_id', tenantId)
    .eq('caller_phone', callerPhone)
    .maybeSingle();
  return (data && data.history) || [];
}

async function saveThreadHistory(tenantId, callerPhone, history) {
  if (!isDbConfigured() || !tenantId) return;
  const db = getAdmin();
  const trimmed = history.slice(-12);
  await db.from('sms_threads').upsert({
    tenant_id: tenantId,
    caller_phone: callerPhone,
    history: trimmed,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,caller_phone' });
}

function isActive(tenant) {
  if (!tenant) return false;
  const ok = ['trialing', 'active'];
  if (!ok.includes(tenant.subscription_status)) return false;
  if (tenant.subscription_status === 'trialing' && tenant.trial_ends_at) {
    return new Date(tenant.trial_ends_at) > new Date();
  }
  return true;
}

async function resolveClient(twilioNumber) {
  const raw = await getTenantRowByTwilioNumber(twilioNumber);
  if (raw) {
    if (!isActive(raw)) {
      return { key: raw.id, tenant: raw, dossier: null, suspended: true };
    }
    return { key: raw.id, tenant: raw, dossier: rowToDossier(raw), suspended: false };
  }
  if (!isDbConfigured()) return FALLBACK;
  return { key: 'unassigned', tenant: null, dossier: null, suspended: false };
}

module.exports = {
  resolveClient,
  getTenantRowByTwilioNumber,
  getTenantByTwilioNumber,
  getTenantByUserId,
  createTenantForUser,
  updateTenant,
  logMessage,
  logMissedCall,
  loadThreadHistory,
  saveThreadHistory,
  isActive,
  FALLBACK,
  USER_PATCHABLE_FIELDS,
};
