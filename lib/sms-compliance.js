const { getAdmin, isDbConfigured } = require('./db');
const { toE164 } = require('./phone-util');

const OPT_OUT_RE = /^(stop|arret|arrêt|unsubscribe|cancel|annuler|opt.?out|desinscrire|désinscrire)(\s|$|[!.])/i;
const OPT_IN_RE = /^(oui|yes|start|abonner|reabonner|réabonner)(\s|$|[!.])/i;

const OPT_OUT_ACK = 'Vous êtes désinscrit(e) des textos NoviaAI. Répondez OUI pour vous réabonner. Pour nous joindre, appelez notre commerce directement.';
const OPT_IN_ACK = 'Vous êtes réabonné(e) aux textos. Répondez ARRET pour vous désinscrire.';

function isOptOutMessage(body) {
  const t = String(body || '').trim();
  return t.length > 0 && OPT_OUT_RE.test(t);
}

function isOptInMessage(body) {
  const t = String(body || '').trim();
  return t.length > 0 && OPT_IN_RE.test(t);
}

function normalizePhone(phone) {
  return toE164(phone) || String(phone || '').trim();
}

async function isOptedOut(tenantId, phone) {
  if (!isDbConfigured() || !tenantId || !phone) return false;
  const db = getAdmin();
  const caller = normalizePhone(phone);
  const { data } = await db
    .from('sms_opt_outs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('caller_phone', caller)
    .maybeSingle();
  return !!data;
}

async function recordOptOut(tenantId, phone) {
  if (!isDbConfigured() || !tenantId || !phone) return;
  const db = getAdmin();
  const caller = normalizePhone(phone);
  await db.from('sms_opt_outs').upsert({
    tenant_id: tenantId,
    caller_phone: caller,
    opted_out_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,caller_phone' });
}

async function clearOptOut(tenantId, phone) {
  if (!isDbConfigured() || !tenantId || !phone) return;
  const db = getAdmin();
  const caller = normalizePhone(phone);
  await db.from('sms_opt_outs').delete().eq('tenant_id', tenantId).eq('caller_phone', caller);
}

function complianceFooter(businessName) {
  const name = (businessName || 'notre commerce').trim();
  return `Répondez ARRET pour ne plus recevoir de textos. ${name}`;
}

function appendPromoFooter(body, businessName) {
  const footer = complianceFooter(businessName);
  const text = String(body || '').trim();
  if (!text || text.includes('ARRET') || text.includes('ARRÊT')) return text;
  const combined = `${text}\n\n${footer}`;
  if (combined.length <= 320) return combined;
  const maxBody = 320 - footer.length - 5;
  return `${text.slice(0, Math.max(0, maxBody))}…\n${footer}`;
}

module.exports = {
  isOptOutMessage,
  isOptInMessage,
  isOptedOut,
  recordOptOut,
  clearOptOut,
  complianceFooter,
  appendPromoFooter,
  OPT_OUT_ACK,
  OPT_IN_ACK,
};
