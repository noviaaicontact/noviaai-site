// Prospects NoviaAI (pubs / formulaire /decouvrir) — validation, UTM, statuts.
const { toE164 } = require('./phone-util');
const E = require('../assets/revenue-estimate');

const INBOUND_CHANNELS = [
  'phone', 'sms', 'messenger', 'instagram',
  'website_form', 'booking', 'several', 'other',
];

const INBOUND_LABELS = {
  phone: 'Téléphone',
  sms: 'SMS',
  messenger: 'Messenger',
  instagram: 'Instagram',
  website_form: 'Formulaire sur le site',
  booking: 'Système de réservation',
  several: 'Plusieurs de ces options',
  other: 'Autre',
};

const STATUSES = ['new', 'contacted', 'demo_booked', 'demo_done', 'customer', 'not_interested'];

const STATUS_LABELS = {
  new: 'Nouveau',
  contacted: 'Contacté',
  demo_booked: 'Démo planifiée',
  demo_done: 'Démo effectuée',
  customer: 'Client',
  not_interested: 'Pas intéressé',
};

const SOURCE_CHANNELS = ['facebook', 'instagram', 'tiktok', 'meta_ads', 'direct'];

const SOURCE_LABELS = {
  facebook: 'Facebook organique',
  instagram: 'Instagram organique',
  tiktok: 'TikTok organique',
  meta_ads: 'Meta Ads',
  direct: 'Direct',
};

const UTM_KEYS = [
  'source', 'medium', 'campaign', 'content', 'term',
  'fbclid', 'ttclid', 'igshid', 'referrer', 'landing_page',
];

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', '10minutemail.com',
  'trashmail.com', 'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com',
  'fakeinbox.com', 'throwaway.email', 'temp-mail.org',
]);

function text(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v);
}

function looksFakeEmail(email) {
  const domain = String(email.split('@')[1] || '').toLowerCase();
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  if (/^(test|asdf|qwerty|abc|aaa|xxx|noemail)@(test|asdf|mail|email|example)\./i.test(email)) return true;
  return false;
}

function looksFakeName(name) {
  if (!/[a-zàâäéèêëïîôùûüç]/i.test(name)) return true;
  if (/(.)\1{5,}/.test(name)) return true;
  if (/https?:|www\./i.test(name)) return true;
  return false;
}

function isPaidMedium(medium) {
  const m = String(medium || '').toLowerCase().trim();
  return /^(cpc|ppc|cpm|cpa|paid|paid_social|paidsocial|paid-social|ads)$/.test(m)
    || /\b(cpc|ppc|paid|paidsocial)\b/.test(m);
}

function cleanUtm(utm) {
  const src = utm && typeof utm === 'object' ? utm : {};
  const out = {};
  for (const key of UTM_KEYS) {
    const v = text(src[key], 400);
    if (v) out[key] = v;
  }
  return out;
}

/**
 * Normalise la source pour le tableau admin.
 * Les pubs Meta doivent envoyer utm_medium=cpc (ou paid) — fbclid seul ≠ pub payée.
 */
function resolveSourceChannel(utm) {
  const u = utm && typeof utm === 'object' ? utm : {};
  const src = String(u.source || '').toLowerCase().trim();
  const medium = String(u.medium || '').toLowerCase().trim();
  const campaign = String(u.campaign || '').toLowerCase();
  const referrer = String(u.referrer || '').toLowerCase();
  const paid = isPaidMedium(medium)
    || src === 'meta' && /ads|cpc|paid/.test(medium + ' ' + campaign);

  const fromTiktok = !!(u.ttclid) || src === 'tiktok' || src === 'tt'
    || /tiktok\.com/.test(referrer);
  const fromIg = !!(u.igshid) || src === 'instagram' || src === 'ig'
    || /instagram\.com/.test(referrer);
  const fromFb = !!(u.fbclid) || src === 'facebook' || src === 'fb' || src === 'meta'
    || /facebook\.com|fb\.com|m\.facebook/.test(referrer);

  if (fromTiktok) return 'tiktok';
  if (paid && (fromFb || fromIg || src === 'facebook' || src === 'instagram' || src === 'meta' || src === 'fb' || src === 'ig')) {
    return 'meta_ads';
  }
  if (fromIg) return 'instagram';
  if (fromFb) return 'facebook';
  return 'direct';
}

function validateCapture(body) {
  const errors = [];
  const firstName = text(body.firstName, 60);
  const businessName = text(body.businessName, 120);
  const email = text(body.email, 160).toLowerCase();
  const phone = toE164(body.phone);
  const inbound = text(body.inboundChannel, 40);
  const missedCalls = text(body.missedCalls, 20);
  const clientValue = text(body.clientValue, 20);
  const utm = cleanUtm(body.utm);

  if (!firstName || firstName.length < 2 || looksFakeName(firstName)) errors.push('prénom');
  if (!businessName || businessName.length < 2 || /https?:|www\./i.test(businessName)) {
    errors.push('entreprise');
  }
  if (!isEmail(email) || looksFakeEmail(email)) errors.push('courriel');
  if (!phone) errors.push('téléphone');
  if (!INBOUND_CHANNELS.includes(inbound)) errors.push('réception des demandes');
  if (!E.MISSED_CALLS[missedCalls]) errors.push('appels manqués');
  if (!E.CLIENT_VALUE[clientValue]) errors.push('valeur d’un job');

  if (errors.length) return { errors, lead: null };

  const estimate = E.estimate(missedCalls, clientValue);

  return {
    errors: [],
    estimate,
    lead: {
      first_name: firstName,
      last_name: null,
      business_name: businessName,
      phone,
      email,
      inbound_channel: inbound,
      missed_calls_per_month: missedCalls,
      avg_client_value: clientValue,
      estimated_recovery_monthly: estimate.monthly,
      source_channel: resolveSourceChannel(utm),
      form_variant: 'capture',
      utm,
      consent_at: new Date().toISOString(),
      status: 'new',
    },
  };
}

module.exports = {
  INBOUND_CHANNELS,
  INBOUND_LABELS,
  STATUSES,
  STATUS_LABELS,
  SOURCE_CHANNELS,
  SOURCE_LABELS,
  UTM_KEYS,
  text,
  isEmail,
  cleanUtm,
  resolveSourceChannel,
  validateCapture,
};
