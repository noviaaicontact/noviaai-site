const { getAdmin, isDbConfigured } = require('./db');
const {
  PLANS,
  DEFAULT_PLAN,
  normalizePlan,
  recommendPlanKey,
  planLabel,
} = require('./plans');

/**
 * Une « conversation » = un interlocuteur distinct (caller_phone) ayant échangé
 * avec NoviaAI pendant la période de facturation courante.
 */

function monthlyLimit(plan) {
  const p = normalizePlan(plan);
  return (PLANS[p] && PLANS[p].monthlyConversations) || PLANS[DEFAULT_PLAN].monthlyConversations;
}

/** Début de la période d'usage (essai = depuis création ; sinon cycle mensuel). */
function usagePeriodStart(tenant) {
  const now = new Date();
  const created = tenant?.created_at ? new Date(tenant.created_at) : now;

  if (tenant?.subscription_status === 'trialing') {
    return created;
  }

  // Anniversaire mensuel aligné sur le jour de création du compte (jour 1–28).
  const day = Math.min(Math.max(created.getUTCDate(), 1), 28);
  let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 0, 0, 0, 0));
  if (start > now) {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, day, 0, 0, 0, 0));
  }
  if (start < created) return created;
  return start;
}

function usagePeriodStartIso(tenant) {
  return usagePeriodStart(tenant).toISOString();
}

async function getConversationCount(tenantId, sinceIso) {
  if (!isDbConfigured() || !tenantId) return 0;
  const db = getAdmin();

  // RPC exacte (COUNT DISTINCT) — fallback pagination si la fonction n'existe pas encore.
  const { data: rpcCount, error: rpcErr } = await db.rpc('count_conversations_since', {
    p_tenant_id: tenantId,
    p_since: sinceIso,
  });
  if (!rpcErr && typeof rpcCount === 'number') return rpcCount;
  if (rpcErr) console.warn('usage conversations rpc', rpcErr.message);

  const unique = new Set();
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await db
      .from('sms_messages')
      .select('caller_phone')
      .eq('tenant_id', tenantId)
      .gte('created_at', sinceIso)
      .range(from, from + page - 1);
    if (error) {
      console.warn('usage conversations', error.message);
      break;
    }
    if (!data?.length) break;
    for (const row of data) {
      if (row.caller_phone) unique.add(row.caller_phone);
    }
    if (data.length < page) break;
    from += page;
  }
  return unique.size;
}

async function checkConversationQuota(tenant) {
  if (!tenant?.id) {
    return {
      ok: true,
      count: 0,
      limit: PLANS[DEFAULT_PLAN].monthlyConversations,
      period_start: null,
    };
  }
  const periodStart = usagePeriodStartIso(tenant);
  const count = await getConversationCount(tenant.id, periodStart);
  const recommendation = buildTrialRecommendation(tenant, count);
  const isTrial = tenant.subscription_status === 'trialing';
  // Pendant l'essai : on mesure sans bloquer. Limite affichée = forfait recommandé.
  const limit = isTrial
    ? PLANS[recommendation.plan].monthlyConversations
    : monthlyLimit(tenant.plan);
  return {
    ok: isTrial ? true : count < limit,
    count,
    limit,
    period_start: periodStart,
    recommendation,
  };
}

/** Compat : les appels existants passent par le quota conversations. */
async function checkSmsQuota(tenant) {
  return checkConversationQuota(tenant);
}

async function getOutboundSmsCount(tenantId) {
  // Conservé pour compat admin éventuelle — compte les conversations du mois calendaire UTC.
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return getConversationCount(tenantId, d.toISOString());
}

/**
 * Projection mensuelle + forfait recommandé (surtout utile en essai).
 */
function buildTrialRecommendation(tenant, conversationCount) {
  const created = tenant?.created_at ? new Date(tenant.created_at) : new Date();
  const trialEnd = tenant?.trial_ends_at ? new Date(tenant.trial_ends_at) : null;
  const now = new Date();
  const elapsedMs = Math.max(now - created, 0);
  const daysElapsed = Math.max(elapsedMs / 86400000, 1);
  const projected = Math.round((conversationCount / daysElapsed) * 30);
  const key = recommendPlanKey(projected);
  const plan = PLANS[key];
  const daysLeft = trialEnd
    ? Math.max(0, Math.ceil((trialEnd - now) / 86400000))
    : null;

  return {
    plan: key,
    plan_name: plan.name,
    price: plan.price,
    projected_monthly: projected,
    conversations_used: conversationCount,
    days_elapsed: Math.round(daysElapsed * 10) / 10,
    days_left: daysLeft,
    message:
      `Durant votre période d'essai, vous avez utilisé environ ${projected} conversations par mois. `
      + `Le forfait ${plan.name} est donc recommandé pour votre entreprise.`,
  };
}

async function getUsageSnapshot(tenant) {
  const quota = await checkConversationQuota(tenant);
  const recommendation = quota.recommendation || buildTrialRecommendation(tenant, quota.count);
  return {
    ...quota,
    recommendation,
    plan: normalizePlan(tenant?.plan),
    plan_name: planLabel(tenant?.plan),
  };
}

module.exports = {
  checkSmsQuota,
  checkConversationQuota,
  getConversationCount,
  getOutboundSmsCount,
  monthlyLimit,
  usagePeriodStart,
  usagePeriodStartIso,
  buildTrialRecommendation,
  getUsageSnapshot,
  FAIR_USE_SMS: PLANS.pro.monthlyConversations,
};
