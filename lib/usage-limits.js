const { getAdmin, isDbConfigured } = require('./db');
const { PLANS, DEFAULT_PLAN, normalizePlan } = require('./plans');

const FAIR_USE_SMS = 3000;

function monthlyLimit(plan) {
  const p = normalizePlan(plan);
  return (PLANS[p] && PLANS[p].monthlySms) || FAIR_USE_SMS;
}

function monthStartIso() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function getOutboundSmsCount(tenantId) {
  if (!isDbConfigured() || !tenantId) return 0;
  const db = getAdmin();
  const { count, error } = await db
    .from('sms_messages')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('direction', 'outbound')
    .gte('created_at', monthStartIso());
  if (error) {
    console.warn('usage count', error.message);
    return 0;
  }
  return count || 0;
}

async function checkSmsQuota(tenant) {
  if (!tenant?.id) return { ok: true, count: 0, limit: FAIR_USE_SMS };
  const limit = monthlyLimit(tenant.plan);
  const count = await getOutboundSmsCount(tenant.id);
  return { ok: count < limit, count, limit };
}

module.exports = { checkSmsQuota, getOutboundSmsCount, monthlyLimit, FAIR_USE_SMS };
