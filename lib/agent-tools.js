// Détection leads / RDV / transfert humain + résumé structuré client.

const { getAdmin, isDbConfigured } = require('./db');
const { isTestCaller } = require('./phone-util');
const { logEvent } = require('./events');
const { touchThread } = require('./inbox');
const {
  formatQualificationSummaryText,
  formatQualificationHtml,
  formatOwnerSummaryText,
  formatOwnerSummaryHtml,
  normalizeQualificationFields,
  refreshQualificationSummary,
  detectQualificationWorkflow,
  isQualificationComplete,
  WORKFLOW_APPOINTMENT,
} = require('./qualification');
const {
  sendLeadAlert,
  sendAppointmentRequest,
  sendHumanTransferAlert,
} = require('./email');
const { sendOwnerLeadSms } = require('./owner-alert-sms');
const { resolveBookingAction, shouldNotifyOwnerForService } = require('./service-workflows');

const RDV_RE = /rendez-vous|rendez vous|rdv|réserver|reserver|reservation|réservation|booking|prendre (un )?rendez|disponibilit/i;
const DAY_RE = /lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|après-midi|apres-midi|matin|soir/i;
const TIME_RE = /\d{1,2}\s*h\b|\d{1,2}:\d{2}|\d{1,2}\s*heures?/i;
const INTENT_RE = /coupe|balayage|coloration|service|visite|consultation|devis|prix|tarif|place|créneau|creneau|fuite|plomb|chauff|électri|urgent|panne/i;
const HUMAN_RE = /parler à|parler avec|un humain|une personne|employé|employe|propriétaire|proprietaire|gérant|gerant|manager|patron/i;
const CALLBACK_RE = /rappelez|rappeler|rappel|callback|me rappel/i;
const QUOTE_RE = /soumission|estimation|estimé|estime\b|devis|combien|coût|cout\b|coûte|coute\b|budget|financement|prix|tarif/i;
const BUY_RE = /acheter|achat|commander|en stock|inventaire|disponible|installer|installation|livraison|remplacer|réparer|reparer|soumettre/i;
// Vocabulaire de bris commun à tous les métiers — INTENT_RE ne couvre que
// salons et plombiers, donc rate le vocabulaire des autres commerces.
const PROBLEM_RE = /ne fonctionne (plus|pas)|fonctionne pas|ne marche|marche (plus|pas)|brisé|brise\b|problème|probleme|défectueux|defectueux|bruit|fuite|fuit\b|ne démarre|démarre pas|demarre pas|panne|réparation|reparation|endommagé|endommage|bloqué|bloque\b/i;

function classifyIntent(message, aiReply, workflow) {
  const clientText = String(message || '').toLowerCase();
  const text = `${message || ''} ${aiReply || ''}`.toLowerCase();
  const preferAppointment = workflow === WORKFLOW_APPOINTMENT;

  // Jugé sur le message du client seul : l'agent écrit souvent « je peux vous
  // rappeler », ce qui transformait n'importe quel texto en transfert humain.
  if (HUMAN_RE.test(clientText) || CALLBACK_RE.test(clientText)) {
    return { type: 'human_transfer', summary: message };
  }

  // Demande de prix, d'achat ou signalement d'un bris : intention commerciale
  // suffisante en soi, même sans mention de date ou de rendez-vous.
  if (QUOTE_RE.test(clientText) || BUY_RE.test(clientText) || PROBLEM_RE.test(clientText)) {
    return { type: preferAppointment ? 'appointment' : 'lead', summary: message };
  }

  const rdvScore = [RDV_RE, DAY_RE, TIME_RE, INTENT_RE].filter((re) => re.test(text)).length;
  if (preferAppointment && (rdvScore >= 1 || RDV_RE.test(text))) {
    return { type: 'appointment', summary: message };
  }
  if (rdvScore >= 2 || (RDV_RE.test(text) && (DAY_RE.test(text) || TIME_RE.test(text)))) {
    return { type: 'appointment', summary: message };
  }
  // Intent métier clair seulement — plus de filet « message > 15 car. »
  // qui spamait les alertes courriel pour chaque texto banal.
  if (INTENT_RE.test(text) && (RDV_RE.test(text) || DAY_RE.test(text) || TIME_RE.test(text))) {
    return { type: preferAppointment ? 'appointment' : 'lead', summary: message };
  }
  return null;
}

async function insertLead(tenantId, callerPhone, summary, source, qualificationData) {
  if (!isDbConfigured() || !tenantId) return null;
  if (isTestCaller(callerPhone)) return null;
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

async function processInboundActions({ tenant, callerPhone, userMessage, aiReply, history, calendarBooking }) {
  if (!tenant || !tenant.id || !callerPhone) return null;
  if (isTestCaller(callerPhone)) return { skipped: 'test' };

  const workflow = detectQualificationWorkflow(tenant);
  const fields = normalizeQualificationFields(tenant.qualification_fields, workflow);
  let qualificationData = {};
  try {
    qualificationData = await refreshQualificationSummary({
      tenantId: tenant.id,
      callerPhone,
      history: history || [],
      fields,
      callerPhoneE164: callerPhone,
      workflow,
      tenant,
    });
  } catch (e) {
    console.error('qualification refresh', e.message);
  }

  let booked = calendarBooking;
  if (booked === undefined) {
    try {
      const { maybeCreateCalendarEvent, hasConnectedCalendar } = require('./calendar');
      const { resolveBookingAction } = require('./service-workflows');
      const calendarConnected = await hasConnectedCalendar(tenant.id);
      const bookingAction = resolveBookingAction({
        services: tenant.services,
        userMessage,
        qualificationData,
        calendarConnected,
        reservationLinks: tenant.reservation_links,
        reservationUrl: tenant.reservation_url,
        tenant,
      });
      if (!bookingAction.create) {
        booked = { skipped: bookingAction.action, action: bookingAction };
      } else if (calendarConnected) {
        booked = await maybeCreateCalendarEvent({
          tenant,
          callerPhone,
          userMessage,
          aiReply,
          qualificationData,
          history,
          bookingAction,
        });
      } else {
        booked = null;
      }
    } catch (calErr) {
      console.warn('calendar booking skip', calErr.message);
      booked = { skipped: 'error', error: calErr.message };
    }
  }

  if (booked && booked.ok) {
    await logEvent(tenant.id, callerPhone, 'calendar_event_created', {
      provider: booked.provider,
      event_id: booked.eventId,
      start: booked.slot && booked.slot.start,
    });
  } else if (booked && booked.skipped && booked.skipped !== 'already' && booked.skipped !== 'timeout') {
    console.warn('calendar booking not created', booked.skipped, booked.error || '');
  }

  const structuredSummary = formatOwnerSummaryText(workflow, qualificationData, fields, callerPhone)
    || formatQualificationSummaryText(qualificationData, fields, workflow);
  const intent = classifyIntent(userMessage, aiReply, workflow);
  const complete = isQualificationComplete(workflow, qualificationData, fields);

  if (!intent && !complete && !structuredSummary) return { qualificationData, workflow };

  const summaryText = structuredSummary || intent?.summary || userMessage;
  const qualHtml = formatOwnerSummaryHtml(workflow, qualificationData, fields, callerPhone)
    || formatQualificationHtml(qualificationData, fields, workflow);

  // Notifier seulement un dossier qui peut rapporter (pas l'analyse d'eau gratuite, etc.).
  const bookingForNotify = resolveBookingAction({
    services: tenant.services,
    userMessage,
    qualificationData,
    calendarConnected: false,
    reservationLinks: tenant.reservation_links,
    reservationUrl: tenant.reservation_url,
    tenant,
  });
  const revenueLead = shouldNotifyOwnerForService(bookingForNotify.service);
  const shouldNotify = !!(intent || complete) && revenueLead;

  if (shouldNotify) {
    const source = intent?.type || (workflow === WORKFLOW_APPOINTMENT ? 'appointment' : 'lead');
    const lead = await insertLead(tenant.id, callerPhone, summaryText, source, qualificationData);
    await touchThread(tenant.id, callerPhone, summaryText, 'lead');

    try {
      await sendOwnerLeadSms(tenant, callerPhone, summaryText, source, qualificationData);
      if (source === 'appointment') {
        await sendAppointmentRequest(tenant, callerPhone, summaryText, qualificationData, qualHtml, {
          calendarConfirmed: !!(booked && booked.ok),
        });
        await logEvent(tenant.id, callerPhone, 'lead_created', { kind: 'appointment', workflow, summary: summaryText, qualification_data: qualificationData });
      } else if (source === 'human_transfer') {
        await sendHumanTransferAlert(tenant, callerPhone, 'Demande client', summaryText, qualificationData, qualHtml);
        await logEvent(tenant.id, callerPhone, 'human_transfer', { workflow, summary: summaryText, qualification_data: qualificationData });
      } else {
        await sendLeadAlert(tenant, callerPhone, summaryText, qualificationData, qualHtml);
        await logEvent(tenant.id, callerPhone, 'lead_created', { kind: 'lead', workflow, summary: summaryText, qualification_data: qualificationData });
      }
    } catch (e) {
      console.error('processInboundActions email', e.message);
    }

    return { intent: source, leadId: lead?.id, qualificationData, workflow, complete };
  }

  return { qualificationData, workflow };
}

module.exports = { classifyIntent, processInboundActions, insertLead };
