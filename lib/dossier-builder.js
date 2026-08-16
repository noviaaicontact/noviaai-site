// Construit le dossier JSON (base de connaissances IA) à partir d'une ligne tenant Supabase.

const { withChatbotDefaults, DEFAULT_HOURS: STARTER_HOURS } = require('./chatbot-defaults');
const { resolveCustomerPhone } = require('./phone-util');
const {
  normalizeQualificationFields,
  detectQualificationWorkflow,
} = require('./qualification');
const { defaultFieldsForWorkflow, missedCallSmsForWorkflow } = require('./qualification-workflows');
const { normalizeServices } = require('./service-workflows');

const DEFAULT_HOURS = STARTER_HOURS;

function normalizeCityKey(city) {
  return String(city || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Indicatif par défaut selon la ville (évite 581 Alma pour un commerce à Québec sans choix explicite). */
function guessAreaCodeFromCity(city) {
  const c = normalizeCityKey(city);
  if (!c) return '';
  if (/\b(montreal|laval|longueuil|brossard|terrebonne|repentigny)\b/.test(c)) return '514';
  if (/\b(gatineau|hull|sherbrooke|trois-?rivieres|shawinigan)\b/.test(c)) return '819';
  if (/\b(alma|saguenay|chicoutimi|jonquiere)\b/.test(c)) return '418';
  if (/\b(quebec|levis|rimouski)\b/.test(c)) return '418';
  return '';
}

function guessCityFromAreaCode(areaCode) {
  const a = String(areaCode || '').replace(/\D/g, '').slice(0, 3);
  if (a === '514' || a === '438') return 'Montréal';
  if (a === '450') return 'Longueuil';
  if (a === '819' || a === '873') return 'Gatineau';
  if (a === '418' || a === '581') return 'Québec';
  return '';
}

function normalizeAgentFavorites(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    if (!item || typeof item !== 'object') return null;
    const content = String(item.content || '').trim();
    if (!content) return null;
    return {
      id: String(item.id || `fav-${i}-${Date.now()}`).slice(0, 64),
      label: String(item.label || '').trim().slice(0, 80),
      content: content.slice(0, 500),
    };
  }).filter(Boolean).slice(0, 30);
}

function parseFaq(text) {
  if (!text || typeof text !== 'string') return [];
  const blocks = text.split(/\n(?=Q:|Q :|Question:)/i).filter(Boolean);
  const faq = [];
  blocks.forEach((block) => {
    const m = block.match(/^(?:Q:|Q :|Question:)\s*(.+?)[\n\r]+(?:R:|R :|Réponse:|Reponse:)\s*([\s\S]+)/i);
    if (m) faq.push({ question: m[1].trim(), reponse: m[2].trim() });
  });
  if (!faq.length && text.trim()) {
    text.split('\n').filter(Boolean).forEach((line) => {
      const parts = line.split('|').map((s) => s.trim());
      if (parts.length >= 2) faq.push({ question: parts[0], reponse: parts[1] });
    });
  }
  return faq;
}

function parsePolicies(text) {
  if (!text || typeof text !== 'string') return [];
  return text.split('\n').map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
}

function parseServices(text) {
  if (!text || typeof text !== 'string') return [];
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/\s*[—–\-|]\s*/).map((s) => s.trim());
    return { nom: parts[0], prix: parts[1] || '', description_courte: parts[0] };
  });
}

function servicesToText(services) {
  if (!Array.isArray(services) || !services.length) return '';
  return services.map((s) => (s.prix ? `${s.nom || s.description_courte} — ${s.prix}` : (s.nom || s.description_courte || ''))).filter(Boolean).join('\n');
}

function faqToText(faq) {
  if (!Array.isArray(faq) || !faq.length) return '';
  return faq.map((f) => `Q: ${f.question}\nR: ${f.reponse}`).join('\n\n');
}

function policiesToText(policies) {
  if (!Array.isArray(policies) || !policies.length) return '';
  return policies.join('\n');
}

function normalizeBusinessPhone(body) {
  return (body.phone_forward || body.business_phone || body.existing_business_number || '').trim();
}

function hoursHaveOpenDay(hours) {
  if (!hours || typeof hours !== 'object') return false;
  return Object.values(hours).some((d) => d && (d.ouvert === true || d.ouvert === 'true'));
}

/**
 * Checklist serveur avant d'activer une PME (onboarding_done / provision Twilio).
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateOnboarding(input) {
  const errors = [];
  const src = input && typeof input === 'object' ? input : {};
  const name = String(src.business_name || '').trim();
  if (name.length < 2) errors.push('Indiquez le nom du commerce.');

  const city = String(src.city || '').trim();
  if (city.length < 2) errors.push('Indiquez la ville du commerce.');

  const phone = normalizeBusinessPhone(src);
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 10) errors.push('Indiquez le cellulaire du commerce (10 chiffres).');

  const sms = String(src.missed_call_sms || '').trim();
  if (sms.length < 8) errors.push('Le message SMS d\'appel manqué est obligatoire.');

  const lineMode = src.line_mode === 'hosted' ? 'hosted'
    : src.line_mode === 'forward' ? 'forward'
    : 'new';
  if (lineMode === 'new') {
    const area = String(src.area_code || '').replace(/\D/g, '').slice(0, 3);
    if (area.length !== 3) errors.push('Choisissez un indicatif régional (418, 514, 581…).');
  }

  if (!hoursHaveOpenDay(src.hours)) {
    errors.push('Indiquez au moins une journée d\'ouverture.');
  }

  return { ok: errors.length === 0, errors };
}

/** @returns {{ label: string, url: string }[]} */
function normalizeReservationLinks(rawLinks, fallbackUrl) {
  const links = [];
  if (Array.isArray(rawLinks)) {
    rawLinks.forEach((item) => {
      if (!item) return;
      if (typeof item === 'string') {
        const url = item.trim();
        if (url) links.push({ label: '', url });
        return;
      }
      const url = String(item.url || item.href || '').trim();
      if (!url) return;
      links.push({
        label: String(item.label || item.nom || item.name || '').trim(),
        url,
      });
    });
  }
  if (!links.length) {
    const u = String(fallbackUrl || '').trim();
    if (u) links.push({ label: '', url: u });
  }
  // déduplique par URL
  const seen = new Set();
  return links.filter((l) => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
}

function formatReservationScript(links) {
  if (!links.length) return 'Prendre nom + disponibilités → demander_rendez_vous';
  if (links.length === 1) {
    const l = links[0];
    return l.label
      ? `Lien de réservation ou de soumission (${l.label}) : ${l.url}`
      : `Lien de réservation ou de soumission : ${l.url}`;
  }
  return 'Liens de réservation ou de soumission (envoyer celui qui correspond au service demandé) :\n'
    + links.map((l) => `- ${l.label || 'Lien'} : ${l.url}`).join('\n');
}

function rowToDossier(row) {
  if (!row) return null;

  const businessName = row.business_name || 'Mon commerce';
  const agentName = row.agent_name || 'Léa';
  const publicPhone = resolveCustomerPhone(row);
  const workflow = detectQualificationWorkflow(row);
  const welcome = row.welcome_sms ||
    `Bonjour! Ici ${agentName}, de ${businessName}. Comment puis-je vous aider? 😊`;
  const missed = row.missed_call_sms ||
    missedCallSmsForWorkflow(workflow, businessName, agentName);

  const faq = Array.isArray(row.faq) ? row.faq : [];
  const policies = Array.isArray(row.policies) ? row.policies : parsePolicies(row.policies_text || '');
  const agentFavorites = normalizeAgentFavorites(row.agent_favorites);
  const qualificationFields = normalizeQualificationFields(row.qualification_fields, workflow);
  const reservationLinks = normalizeReservationLinks(row.reservation_links, row.reservation_url);

  return {
    meta: {
      type: 'agent_personnalise',
      version: '2.1',
      langue: 'fr-CA',
      qualification_workflow: workflow,
    },
    entreprise: {
      nom_court: businessName,
      nom_legal: businessName,
      type: row.business_type || 'PME',
      courriel: row.contact_email || row.email,
    },
    coordonnees: {
      adresse_ligne1: row.address_line || '',
      ville: row.city || 'Québec',
      province: row.province || 'Québec',
      code_postal: row.postal_code || '',
      telephone: publicPhone,
      telephone_sms: row.twilio_number || '',
      telephone_reel: row.phone_forward || row.existing_business_number || '',
      site_web: row.website_url || '',
      reservation_url: reservationLinks[0] ? reservationLinks[0].url : '',
      reservation_links: reservationLinks,
      courriel: row.contact_email || row.email,
      stationnement: row.parking_info || '',
    },
    heures_ouverture: {
      horaire: row.hours && Object.keys(row.hours).length ? row.hours : DEFAULT_HOURS,
    },
    services: normalizeServices(row.services, { fillDefaults: false }),
    faq,
    policies,
    agent_favorites: agentFavorites,
    qualification_fields: qualificationFields,
    identite_agent: (() => {
      const { resolveAgentGender } = require('./ai');
      const gender = resolveAgentGender({
        nom_agent: agentName,
        genre: row.agent_gender || row.agent_genre,
      });
      const roleWord = gender === 'f' ? 'Employée virtuelle' : 'Employé virtuel';
      const genderBan = gender === 'f'
        ? 'Parler au masculin — tu es une agente féminine (ex. : « Je suis désolée », pas « désolé »)'
        : 'Parler au féminin — tu es un agent masculin (ex. : « Je suis désolé », pas « désolée »)';
      return {
        nom_agent: agentName,
        genre: gender,
        role: `${roleWord} de ${businessName} — tu représentes l'entreprise à l'accueil`,
        ton: row.agent_tone || 'Français québécois, chaleureux, amical et professionnel',
        instructions: String(row.agent_instructions || '').trim(),
        vouvoiement: row.vouvoiement !== false,
        interdictions: [
          'Inventer une information absente de la base (prix, produit, horaire, promo, politique, numéro, URL)',
          'Ignorer une réponse disponible dans SERVICES, FAQ, HORAIRES, POLITIQUES ou les EXTRAITS PERTINENTS du site indexé',
          'Confirmer un rendez-vous — seulement noter la demande ou envoyer le lien de réservation',
          'Répondre à des questions médicales, légales ou techniques hors FAQ',
          'Prétendre être un robot ou une IA générique — tu es un employé du commerce',
          'Refuser de donner le téléphone du commerce s\'il est listé dans les coordonnées',
          genderBan,
        ],
      };
    })(),
    scripts: {
      accueil: welcome,
      texto_rappel: missed,
      reservation: formatReservationScript(reservationLinks),
      transfert_humain: `Je transmets votre demande à l'équipe de ${businessName}. Quelqu'un vous contactera sous peu.`,
      cloture: `Merci, et au plaisir de vous voir chez ${businessName}! ✨`,
    },
  };
}

function formToTenantPayload(body) {
  const faq = body.faq
    ? (Array.isArray(body.faq) ? body.faq : parseFaq(body.faq))
    : parseFaq(body.faq_text || '');
  const policies = body.policies
    ? (Array.isArray(body.policies) ? body.policies : parsePolicies(body.policies))
    : parsePolicies(body.policies_text || '');

  const phone = normalizeBusinessPhone(body);
  const lineMode = body.line_mode === 'hosted' ? 'hosted'
    : body.line_mode === 'forward' ? 'forward'
    : 'new';
  const reservationLinks = normalizeReservationLinks(body.reservation_links, body.reservation_url);
  const payload = withChatbotDefaults({
    business_name: String(body.business_name || '').trim(),
    business_type: body.business_type || 'PME',
    agent_name: body.agent_name || '',
    agent_tone: body.agent_tone || '',
    agent_instructions: body.agent_instructions || '',
    phone_forward: phone,
    existing_business_number: lineMode === 'hosted' || lineMode === 'forward'
      ? (body.existing_business_number || phone)
      : (body.existing_business_number || ''),
    line_mode: lineMode,
    area_code: (body.area_code || guessAreaCodeFromCity(body.city) || '').replace(/\D/g, '').slice(0, 3),
    reservation_url: reservationLinks[0] ? reservationLinks[0].url : '',
    reservation_links: reservationLinks,
    address_line: body.address_line || '',
    city: String(body.city || '').trim(),
    province: body.province || 'QC',
    postal_code: body.postal_code || '',
    contact_email: body.contact_email || body.email || '',
    parking_info: body.parking_info || '',
    welcome_sms: body.welcome_sms || '',
    missed_call_sms: body.missed_call_sms || '',
    avg_client_value: parseFloat(body.avg_client_value) || 75,
    hours: body.hours || null,
    services: normalizeServices(body.services || [], { fillDefaults: false }),
    faq,
    policies,
    agent_favorites: normalizeAgentFavorites(body.agent_favorites),
    qualification_fields: normalizeQualificationFields(
      body.qualification_fields,
      detectQualificationWorkflow({ business_type: body.business_type, business_name: body.business_name }),
    ),
    onboarding_done: false,
  });

  const check = validateOnboarding({
    business_name: body.business_name,
    city: body.city,
    phone_forward: phone,
    line_mode: lineMode,
    area_code: body.area_code || guessAreaCodeFromCity(body.city),
    missed_call_sms: body.missed_call_sms,
    hours: body.hours,
  });
  payload.onboarding_done = check.ok;
  payload.dossier = rowToDossier(payload);
  return payload;
}

function settingsToTenantPayload(body, existing) {
  const ex = existing || {};
  const merged = { ...ex };

  const scalarFields = [
    'business_name', 'business_type', 'agent_name', 'agent_tone', 'agent_instructions',
    'contact_email', 'welcome_sms', 'missed_call_sms',
    'google_review_url', 'review_request_sms', 'auto_review_request', 'widget_enabled',
    'review_request_delay_minutes',
    'address_line', 'city', 'province', 'postal_code', 'parking_info', 'public_phone',
  ];
  scalarFields.forEach((f) => {
    if (body[f] !== undefined && body[f] !== null) merged[f] = body[f];
  });

  const phone = normalizeBusinessPhone(body);
  if (phone) merged.phone_forward = phone;

  if (body.services_text !== undefined) {
    merged.services = normalizeServices(parseServices(body.services_text), { fillDefaults: false });
  } else if (Array.isArray(body.services)) {
    merged.services = normalizeServices(body.services, { fillDefaults: false });
  }

  if (body.faq_text !== undefined) {
    merged.faq = parseFaq(body.faq_text);
  } else if (Array.isArray(body.faq)) {
    merged.faq = body.faq;
  }

  if (body.policies_text !== undefined) {
    merged.policies = parsePolicies(body.policies_text);
  } else if (Array.isArray(body.policies)) {
    merged.policies = body.policies;
  }

  if (body.agent_favorites !== undefined) {
    merged.agent_favorites = normalizeAgentFavorites(body.agent_favorites);
  }

  if (body.qualification_workflow === 'appointment' || body.qualification_workflow === 'field_service') {
    merged.qualification_workflow = body.qualification_workflow;
  }

  if (body.qualification_fields !== undefined) {
    merged.qualification_fields = normalizeQualificationFields(
      body.qualification_fields,
      detectQualificationWorkflow(merged),
    );
  } else if (!merged.qualification_fields || !merged.qualification_fields.length) {
    const wf = detectQualificationWorkflow(merged);
    merged.qualification_fields = defaultFieldsForWorkflow(wf);
  }

  if (body.hours && typeof body.hours === 'object') {
    merged.hours = body.hours;
  }

  if (body.website_url !== undefined) {
    merged.website_url = body.website_url;
  }

  if (body.reservation_links !== undefined || body.reservation_url !== undefined) {
    const links = normalizeReservationLinks(
      body.reservation_links !== undefined ? body.reservation_links : merged.reservation_links,
      body.reservation_url !== undefined ? body.reservation_url : merged.reservation_url
    );
    merged.reservation_links = links;
    merged.reservation_url = links[0] ? links[0].url : '';
  }

  if (body.google_review_url !== undefined) merged.google_review_url = body.google_review_url;
  if (body.review_request_sms !== undefined) merged.review_request_sms = body.review_request_sms;
  if (body.auto_review_request !== undefined) merged.auto_review_request = !!body.auto_review_request;
  if (body.widget_enabled !== undefined) merged.widget_enabled = !!body.widget_enabled;
  if (body.review_request_delay_minutes !== undefined) {
    const n = parseInt(body.review_request_delay_minutes, 10);
    merged.review_request_delay_minutes = Number.isFinite(n)
      ? Math.min(120, Math.max(1, n))
      : 5;
  }

  merged.dossier = rowToDossier(merged);
  return merged;
}

module.exports = {
  rowToDossier,
  formToTenantPayload,
  validateOnboarding,
  settingsToTenantPayload,
  normalizeAgentFavorites,
  normalizeReservationLinks,
  parseFaq,
  parsePolicies,
  parseServices,
  servicesToText,
  faqToText,
  policiesToText,
  guessAreaCodeFromCity,
  guessCityFromAreaCode,
  DEFAULT_HOURS,
};
