// Champs de qualification client + extraction résumé structuré depuis la conversation.

const { getAdmin, isDbConfigured } = require('./db');
const {
  detectQualificationWorkflow,
  mergeQualificationFields,
  formatWorkflowPromptBlock,
  formatOwnerSummaryText,
  formatOwnerSummaryHtml,
  recommendNextAction,
  isQualificationComplete,
  WORKFLOW_APPOINTMENT,
  WORKFLOW_FIELD_SERVICE,
} = require('./qualification-workflows');

/** @deprecated — préférer mergeQualificationFields(workflow) */
const DEFAULT_QUALIFICATION_FIELDS = mergeQualificationFields([], WORKFLOW_FIELD_SERVICE);

function normalizeQualificationFields(raw, workflow) {
  const wf = workflow || WORKFLOW_FIELD_SERVICE;
  return mergeQualificationFields(raw, wf);
}

function enabledFields(fields) {
  return (fields || []).filter((f) => f.enabled);
}

function resolveWorkflowFromContext(tenantOrDossier, fields) {
  return detectQualificationWorkflow(tenantOrDossier || {});
}

function formatQualificationPromptBlock(fields, workflowOrTenant) {
  const workflow = typeof workflowOrTenant === 'string'
    ? workflowOrTenant
    : detectQualificationWorkflow(workflowOrTenant || {});
  return formatWorkflowPromptBlock(workflow, enabledFields(fields));
}

function pickQualificationData(raw, fields) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  enabledFields(fields).forEach((f) => {
    const val = String(raw[f.key] || '').trim();
    if (val) out[f.key] = val.slice(0, 300);
  });
  // Alias extraction → champs canoniques
  if (!out.probleme && out.demande) out.probleme = out.demande;
  if (!out.demande && out.probleme) out.demande = out.probleme;
  if (!out.service_souhaite && out.demande) out.service_souhaite = out.demande;
  if (!out.disponibilite_rappel && out.disponibilites) out.disponibilite_rappel = out.disponibilites;
  return out;
}

function formatQualificationSummaryText(data, fields, workflow) {
  if (!data || typeof data !== 'object') return '';
  const wf = workflow || WORKFLOW_FIELD_SERVICE;
  const owner = formatOwnerSummaryText(wf, data, fields, data.telephone);
  if (owner.includes('Nom :') || owner.includes('Téléphone :')) return owner;
  return enabledFields(fields)
    .map((f) => {
      const val = data[f.key];
      return val ? `${f.label}: ${val}` : null;
    })
    .filter(Boolean)
    .join(' · ');
}

function formatQualificationHtml(data, fields, workflow) {
  const wf = workflow || WORKFLOW_FIELD_SERVICE;
  if (data && Object.keys(data).length) {
    return formatOwnerSummaryHtml(wf, data, fields, data.telephone);
  }
  const rows = enabledFields(fields)
    .map((f) => {
      const val = data && data[f.key];
      if (!val) return '';
      return `<tr><td style="padding:6px 12px 6px 0;font-weight:600;vertical-align:top">${f.label}</td><td style="padding:6px 0">${String(val).replace(/</g, '&lt;')}</td></tr>`;
    })
    .filter(Boolean)
    .join('');
  if (!rows) return '';
  return `<table style="border-collapse:collapse;font-size:14px">${rows}</table>`;
}

function conversationTranscript(history) {
  return (history || [])
    .slice(-16)
    .map((m) => `${m.role === 'user' ? 'Client' : 'Agent'}: ${m.content}`)
    .join('\n');
}

async function extractQualificationFromHistory({ history, callerPhone, fields, workflow }) {
  const enabled = enabledFields(fields);
  if (!enabled.length || !(history || []).length) return {};

  const key = process.env.OPENAI_API_KEY;
  const transcript = conversationTranscript(history);
  const fieldDesc = enabled.map((f) => `"${f.key}": ${f.label}`).join(', ');
  const wf = workflow || WORKFLOW_FIELD_SERVICE;
  const wfHint = wf === WORKFLOW_APPOINTMENT
    ? 'Contexte: entreprise avec prise de rendez-vous (salon, clinique, etc.).'
    : 'Contexte: entreprise de service terrain (plombier, électricien, garage). Inclure urgence et adresse si mentionnées.';

  if (key) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `Tu extrais des infos client depuis une conversation SMS en français québécois.
${wfHint}
Retourne UNIQUEMENT un JSON avec ces clés (chaîne vide si inconnu): ${fieldDesc}.
Numéro de l'appelant (si pertinent pour "telephone"): ${callerPhone || 'inconnu'}.
N'invente rien — seulement ce qui est explicitement dit ou clairement implicite.`,
            },
            { role: 'user', content: transcript },
          ],
          max_tokens: 400,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(text);
        const picked = pickQualificationData(parsed, fields);
        if (callerPhone && enabled.some((f) => f.key === 'telephone') && !picked.telephone) {
          picked.telephone = callerPhone;
        }
        picked.prochaine_action = recommendNextAction(wf, picked);
        return picked;
      }
    } catch (e) {
      console.error('extractQualificationFromHistory', e.message);
    }
  }

  const fallback = {};
  if (callerPhone && enabled.some((f) => f.key === 'telephone')) {
    fallback.telephone = callerPhone;
  }
  const lastUser = [...(history || [])].reverse().find((m) => m.role === 'user');
  if (lastUser) {
    const msg = String(lastUser.content || '').slice(0, 300);
    if (enabled.some((f) => f.key === 'demande' || f.key === 'probleme')) {
      fallback.demande = msg;
      fallback.probleme = msg;
    }
  }
  fallback.prochaine_action = recommendNextAction(wf, fallback);
  return fallback;
}

async function saveThreadQualification(tenantId, callerPhone, data, merge = false) {
  if (!isDbConfigured() || !tenantId || !callerPhone) return;
  const db = getAdmin();
  let payload = data || {};
  if (merge) {
    const { data: row } = await db.from('sms_threads')
      .select('qualification_data')
      .eq('tenant_id', tenantId)
      .eq('caller_phone', callerPhone)
      .maybeSingle();
    payload = { ...(row?.qualification_data || {}), ...payload };
  }
  await db.from('sms_threads').upsert({
    tenant_id: tenantId,
    caller_phone: callerPhone,
    qualification_data: payload,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,caller_phone' });
}

async function refreshQualificationSummary({ tenantId, callerPhone, history, fields, callerPhoneE164, workflow, tenant }) {
  const wf = workflow || detectQualificationWorkflow(tenant || {});
  const data = await extractQualificationFromHistory({
    history,
    callerPhone: callerPhoneE164 || callerPhone,
    fields,
    workflow: wf,
  });
  if (!Object.keys(data).length) return data;
  await saveThreadQualification(tenantId, callerPhone, data);
  return data;
}

module.exports = {
  DEFAULT_QUALIFICATION_FIELDS,
  WORKFLOW_APPOINTMENT,
  WORKFLOW_FIELD_SERVICE,
  normalizeQualificationFields,
  enabledFields,
  resolveWorkflowFromContext,
  formatQualificationPromptBlock,
  pickQualificationData,
  formatQualificationSummaryText,
  formatQualificationHtml,
  formatOwnerSummaryText,
  formatOwnerSummaryHtml,
  recommendNextAction,
  isQualificationComplete,
  extractQualificationFromHistory,
  saveThreadQualification,
  refreshQualificationSummary,
  detectQualificationWorkflow,
};
