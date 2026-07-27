// Champs de qualification client + extraction résumé structuré depuis la conversation.

const { getAdmin, isDbConfigured } = require('./db');

const DEFAULT_QUALIFICATION_FIELDS = [
  { key: 'nom', label: 'Nom du client', enabled: true, required: true },
  { key: 'telephone', label: 'Téléphone', enabled: true, required: false },
  { key: 'demande', label: 'Demande / sujet', enabled: true, required: true },
  { key: 'urgence', label: 'Urgence', enabled: true, required: false },
  { key: 'adresse', label: 'Adresse', enabled: true, required: false },
  { key: 'disponibilites', label: 'Disponibilités', enabled: true, required: false },
];

const FIELD_KEYS = new Set(DEFAULT_QUALIFICATION_FIELDS.map((f) => f.key));

function normalizeQualificationFields(raw) {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_QUALIFICATION_FIELDS.map((f) => ({ ...f }));
  const byKey = new Map(DEFAULT_QUALIFICATION_FIELDS.map((f) => [f.key, { ...f }]));
  raw.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const key = String(item.key || '').trim();
    if (!FIELD_KEYS.has(key)) return;
    byKey.set(key, {
      key,
      label: String(item.label || byKey.get(key).label).trim().slice(0, 80) || byKey.get(key).label,
      enabled: item.enabled !== false,
      required: !!item.required,
    });
  });
  return DEFAULT_QUALIFICATION_FIELDS.map((f) => byKey.get(f.key) || { ...f });
}

function enabledFields(fields) {
  return normalizeQualificationFields(fields).filter((f) => f.enabled);
}

function formatQualificationPromptBlock(fields) {
  const list = enabledFields(fields);
  if (!list.length) return '';
  const lines = list.map((f) => {
    const req = f.required ? ' (obligatoire si pertinent)' : ' (si pertinent)';
    return `- ${f.label}${req}`;
  }).join('\n');
  return `
COLLECTE CLIENT — infos à obtenir pendant la conversation
${lines}

Règles collecte:
- Pose UNE question à la fois, de façon naturelle (SMS court).
- Ne redemande JAMAIS une info déjà donnée dans la conversation.
- Le numéro de l'appelant est souvent déjà connu — confirme seulement si utile.
- Quand les infos clés sont là, confirme brièvement au client (ex. « Parfait, je note : fuite sous l'évier, urgence demain AM »).
- Ne confirme JAMAIS un rendez-vous à une heure précise — note la demande seulement.
`;
}

function pickQualificationData(raw, fields) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  enabledFields(fields).forEach((f) => {
    const val = String(raw[f.key] || '').trim();
    if (val) out[f.key] = val.slice(0, 300);
  });
  return out;
}

function formatQualificationSummaryText(data, fields) {
  if (!data || typeof data !== 'object') return '';
  return enabledFields(fields)
    .map((f) => {
      const val = data[f.key];
      return val ? `${f.label}: ${val}` : null;
    })
    .filter(Boolean)
    .join(' · ');
}

function formatQualificationHtml(data, fields) {
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
    .slice(-14)
    .map((m) => `${m.role === 'user' ? 'Client' : 'Agent'}: ${m.content}`)
    .join('\n');
}

async function extractQualificationFromHistory({ history, callerPhone, fields }) {
  const enabled = enabledFields(fields);
  if (!enabled.length || !(history || []).length) return {};

  const key = process.env.OPENAI_API_KEY;
  const transcript = conversationTranscript(history);
  const fieldDesc = enabled.map((f) => `"${f.key}": ${f.label}`).join(', ');

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
Retourne UNIQUEMENT un JSON avec ces clés (chaîne vide si inconnu): ${fieldDesc}.
Numéro de l'appelant (si pertinent pour "telephone"): ${callerPhone || 'inconnu'}.
N'invente rien — seulement ce qui est explicitement dit ou clairement implicite.`,
            },
            { role: 'user', content: transcript },
          ],
          max_tokens: 300,
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
  if (lastUser && enabled.some((f) => f.key === 'demande')) {
    fallback.demande = String(lastUser.content || '').slice(0, 300);
  }
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

async function refreshQualificationSummary({ tenantId, callerPhone, history, fields, callerPhoneE164 }) {
  const data = await extractQualificationFromHistory({
    history,
    callerPhone: callerPhoneE164 || callerPhone,
    fields,
  });
  if (!Object.keys(data).length) return data;
  await saveThreadQualification(tenantId, callerPhone, data);
  return data;
}

module.exports = {
  DEFAULT_QUALIFICATION_FIELDS,
  normalizeQualificationFields,
  enabledFields,
  formatQualificationPromptBlock,
  pickQualificationData,
  formatQualificationSummaryText,
  formatQualificationHtml,
  extractQualificationFromHistory,
  saveThreadQualification,
  refreshQualificationSummary,
};
