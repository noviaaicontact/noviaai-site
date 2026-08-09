// Formulaire de qualification /potentiel — enregistre le prospect et alerte l'équipe.
const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getAdmin, isDbConfigured } = require('../../lib/db');
const { checkRateLimit, clientIp } = require('../../lib/rate-limit');
const { sendMarketingLeadAlert } = require('../../lib/email');
const E = require('../../assets/revenue-estimate');

const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term', 'fbclid', 'referrer', 'landing_page'];

function text(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v);
}

function normalizePhone(v) {
  const digits = String(v || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function cleanUtm(utm) {
  const src = utm && typeof utm === 'object' ? utm : {};
  const out = {};
  for (const key of UTM_KEYS) {
    const v = text(src[key], 300);
    if (v) out[key] = v;
  }
  return out;
}

/** @returns {{errors: string[], lead: object|null}} */
function validate(body) {
  const errors = [];

  const firstName = text(body.firstName, 60);
  const lastName = text(body.lastName, 60);
  const businessName = text(body.businessName, 120);
  const email = text(body.email, 160).toLowerCase();
  const phone = normalizePhone(body.phone);

  if (!firstName) errors.push('prénom');
  if (!lastName) errors.push('nom');
  if (!businessName) errors.push('entreprise');
  if (!isEmail(email)) errors.push('courriel');
  if (!phone) errors.push('téléphone');

  const sector = text(body.sector, 40);
  const callsPerMonth = text(body.callsPerMonth, 20);
  const missedCalls = text(body.missedCalls, 20);
  const clientValue = text(body.clientValue, 20);
  const intent = text(body.intent, 40);

  if (!E.SECTORS.includes(sector)) errors.push('secteur');
  if (!E.CALLS_PER_MONTH.includes(callsPerMonth)) errors.push('appels par mois');
  if (!E.MISSED_CALLS[missedCalls]) errors.push('appels manqués');
  if (!E.CLIENT_VALUE[clientValue]) errors.push('valeur client');
  if (!E.INTENTS.includes(intent)) errors.push('intérêt');
  if (body.consent !== true) errors.push('consentement');

  if (errors.length) return { errors, lead: null };

  const estimate = E.estimate(missedCalls, clientValue);

  return {
    errors: [],
    lead: {
      first_name: firstName,
      last_name: lastName,
      business_name: businessName,
      phone,
      email,
      sector,
      calls_per_month: callsPerMonth,
      missed_calls_per_month: missedCalls,
      avg_client_value: clientValue,
      intent,
      estimated_recovery_monthly: estimate.monthly,
      utm: cleanUtm(body.utm),
      consent_at: new Date().toISOString(),
    },
    estimate,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const body = parseJson(event);

  // Honeypot : un robot remplit tous les champs, on répond 200 pour ne rien lui apprendre.
  if (text(body.siteWeb, 200)) return json(200, { ok: true });

  const { errors, lead, estimate } = validate(body);
  if (errors.length) {
    return json(400, { error: `Champs à corriger : ${errors.join(', ')}.` });
  }

  const ip = clientIp(event);
  const rl = await checkRateLimit(`qualif-lead:${ip}`, { maxAttempts: 8, windowMinutes: 60 });
  if (!rl.ok) return json(429, { error: 'Trop d\'envois. Réessayez dans une heure.' });

  if (!isDbConfigured()) {
    console.error('qualification-lead: Supabase non configuré', lead.email);
    return json(500, { error: 'Service indisponible. Réessayez plus tard.' });
  }

  const { error } = await getAdmin().from('marketing_leads').insert(lead);
  if (error) {
    console.error('qualification-lead insert', error.message);
    return json(500, { error: 'Enregistrement impossible. Réessayez.' });
  }

  // L'alerte courriel ne doit jamais faire échouer l'envoi côté prospect.
  try {
    await sendMarketingLeadAlert(lead, estimate);
  } catch (e) {
    console.error('qualification-lead email', e.message);
  }

  return json(200, { ok: true, estimatedMonthly: estimate.monthly });
};
