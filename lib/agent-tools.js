// Détection leads / RDV / transfert humain + résumé structuré client.

const { getAdmin, isDbConfigured } = require('./db');
const { logEvent } = require('./events');
const { touchThread } = require('./inbox');
const {
  formatQualificationSummaryText,
  formatQualificationHtml,
  normalizeQualificationFields,
  refreshQualificationSummary,
} = require('./qualification');
const {
  sendLeadAlert,
  sendAppointmentRequest,
  sendHumanTransferAlert,
} = require('./email');

const RDV_RE = /rendez-vous|rendez vous|rdv|réserver|reserver|reservation|réservation|booking|prendre (un )?rendez|disponibilit/i;
const DAY_RE = /lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|après-midi|apres-midi|matin|soir/i;
const TIME_RE = /\d{1,2}\s*h\b|\d{1,2}:\d{2}|\d{1,2}\s*heures?/i;
const INTENT_RE = /coupe|balayage|coloration|service|visite|consultation|devis|prix|tarif|place|créneau|creneau|fuite|plomb|chauff|électri|urgent|panne/i;
const HUMAN_RE = /parler à|parler avec|un humain|une personne|employé|employe|propriétaire|proprietaire|gérant|gerant|manager|patron/i;
const CALLBACK_RE = /rappelez|rappeler|rappel|callback|me rappel/i;

function classifyIntent(message, aiReply) {
  const text = `${message || ''} ${aiReply || ''}`.toLowerCase();
  if (HUMAN_RE.test(text) || CALLBACK_RE.test(text)) {
    return { type: 'human_transfer', summary: message };
  }
  const rdvScore = [RDV_RE, DAY_RE, TIME_RE, INTENT_RE].filter((re) => re.test(text)).length;
  if (rdvScore >= 2 || (RDV_RE.test(text) && (DAY_RE.test(text) || TIME_RE.test(text)))) {
    return { type: 'appointment', summary: message };
  }
  if (INTENT_RE.test(text) && (message || '').length > 12) {
    return { type: 'lead', summary: message };
  }
  return null;
}

async function insertLead(tenantId, callerPhone, summary, source, qualificationData) {
  if (!isDbConfigured() || !tenantId) return null;
  const db = getAdmin();
  const { data, error } = await db.from('leads').insert({
    tenant_id: tenantId,
    caller_phone: callerPhone,
    summary: (summary || '').slice(0, 500),
    qualification_data: qualificationData && Object.keys(qualificationData).length ? qualificationData : null,
    source: source || 'sms',
    status: 'new',
  }).select('id').single();
  if (error) {
    console.error('insertLead', error.message);
    return null;
  }
  try {
    const { data: t } = await db.from('tenants').select('leads_count').eq('id', tenantId).single();
    await db.from('tenants').update({ leads_count: (t?.leads_count || 0) + 1 }).eq('id', tenantId);
  } catch (_) { /* non-blocking */ }
  return data;
}

async function processInboundActions({ tenant, callerPhone, userMessage, aiReply, history }) {
  if (!tenant || !tenant.id || !callerPhone) return null;

  const fields = normalizeQualificationFields(tenant.qualification_fields);
  let qualificationData = {};
  try {
    qualificationData = await refreshQualificationSummary({
      tenantId: tenant.id,
      callerPhone,
      history: history || [],
      fields,
      callerPhoneE164: callerPhone,
    });
  } catch (e) {
    console.error('qualification refresh', e.message);
  }

  const structuredSummary = formatQualificationSummaryText(qualificationData, fields);
  const intent = classifyIntent(userMessage, aiReply);
  if (!intent && !structuredSummary) return { qualificationData };

  const summaryText = structuredSummary || intent?.summary || userMessage;
  const qualHtml = formatQualificationHtml(qualificationData, fields);

  if (intent) {
    const lead = await insertLead(tenant.id, callerPhone, summaryText, intent.type, qualificationData);
    await touchThread(tenant.id, callerPhone, summaryText, 'lead');

    try {
      if (intent.type === 'appointment') {
        await sendAppointmentRequest(tenant, callerPhone, summaryText, qualificationData, qualHtml);
        await logEvent(tenant.id, callerPhone, 'lead_created', { kind: 'appointment', summary: summaryText, qualification_data: qualificationData });
      } else if (intent.type === 'human_transfer') {
        await sendHumanTransferAlert(tenant, callerPhone, 'Demande client', summaryText, qualificationData, qualHtml);
        await logEvent(tenant.id, callerPhone, 'human_transfer', { summary: summaryText, qualification_data: qualificationData });
      } else {
        await sendLeadAlert(tenant, callerPhone, summaryText, qualificationData, qualHtml);
        await logEvent(tenant.id, callerPhone, 'lead_created', { kind: 'lead', summary: summaryText, qualification_data: qualificationData });
      }
    } catch (e) {
      console.error('processInboundActions email', e.message);
    }

    return { intent: intent.type, leadId: lead?.id, qualificationData };
  }

  return { qualificationData };
}

module.exports = { classifyIntent, processInboundActions, insertLead };
