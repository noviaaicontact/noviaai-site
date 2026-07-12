// Construit le dossier JSON (base de connaissances IA) à partir d'une ligne tenant Supabase.

const { withChatbotDefaults, DEFAULT_HOURS: STARTER_HOURS } = require('./chatbot-defaults');

const DEFAULT_HOURS = STARTER_HOURS;

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
  const publicPhone = row.line_mode === 'forward' && row.existing_business_number
    ? row.existing_business_number
    : (row.provisioning_status === 'active' && row.twilio_number)
      ? row.twilio_number
      : (row.twilio_number || row.existing_business_number || '');
  const welcome = row.welcome_sms ||
    `Bonjour! Ici ${agentName}, de ${businessName}. Comment puis-je vous aider? 😊`;
  const missed = row.missed_call_sms ||
    `Bonjour! Ici ${agentName}, de ${businessName}. Désolé, on a manqué votre appel! Répondez à ce texto — je vous réponds tout de suite pour votre demande. 😊`;

  const faq = Array.isArray(row.faq) ? row.faq : [];
  const policies = Array.isArray(row.policies) ? row.policies : parsePolicies(row.policies_text || '');
  const reservationLinks = normalizeReservationLinks(row.reservation_links, row.reservation_url);

  return {
    meta: { type: 'agent_personnalise', version: '2.0', langue: 'fr-CA' },
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
    services: Array.isArray(row.services) ? row.services : [],
    faq,
    policies,
    identite_agent: {
      nom_agent: agentName,
      role: `Employée virtuelle de ${businessName} — tu représentes l'entreprise à l'accueil`,
      ton: row.agent_tone || 'Français québécois, chaleureux, amical et professionnel',
      vouvoiement: row.vouvoiement !== false,
      interdictions: [
        'Inventer des prix, horaires précis, disponibilités ou services non listés dans la base',
        'Confirmer un rendez-vous — seulement noter la demande ou envoyer le lien de réservation',
        'Répondre à des questions médicales, légales ou techniques hors FAQ',
        'Prétendre être un robot ou une IA générique — tu es une employée du commerce',
      ],
    },
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
    business_name: body.business_name || 'Mon commerce',
    business_type: body.business_type || 'PME',
    agent_name: body.agent_name || '',
    agent_tone: body.agent_tone || '',
    phone_forward: phone,
    existing_business_number: lineMode === 'hosted' || lineMode === 'forward'
      ? (body.existing_business_number || phone)
      : (body.existing_business_number || ''),
    line_mode: lineMode,
    area_code: (body.area_code || '418').replace(/\D/g, '').slice(0, 3),
    reservation_url: reservationLinks[0] ? reservationLinks[0].url : '',
    reservation_links: reservationLinks,
    address_line: body.address_line || '',
    city: body.city || 'Québec',
    province: body.province || 'QC',
    postal_code: body.postal_code || '',
    contact_email: body.contact_email || body.email || '',
    parking_info: body.parking_info || '',
    welcome_sms: body.welcome_sms || '',
    missed_call_sms: body.missed_call_sms || '',
    avg_client_value: parseFloat(body.avg_client_value) || 75,
    hours: body.hours || null,
    services: body.services || [],
    faq,
    policies,
    onboarding_done: true,
  });

  payload.dossier = rowToDossier(payload);
  return payload;
}

function settingsToTenantPayload(body, existing) {
  const ex = existing || {};
  const merged = { ...ex };

  const scalarFields = [
    'business_name', 'business_type', 'agent_name', 'agent_tone',
    'contact_email', 'welcome_sms', 'missed_call_sms',
    'google_review_url', 'review_request_sms', 'auto_review_request', 'widget_enabled',
    'review_request_delay_minutes',
    'address_line', 'city', 'province', 'postal_code', 'parking_info',
  ];
  scalarFields.forEach((f) => {
    if (body[f] !== undefined && body[f] !== null) merged[f] = body[f];
  });

  const phone = normalizeBusinessPhone(body);
  if (phone) merged.phone_forward = phone;

  if (body.services_text !== undefined) {
    merged.services = parseServices(body.services_text);
  } else if (Array.isArray(body.services)) {
    merged.services = body.services;
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

  if (body.plan && ['starter', 'pro', 'business'].includes(body.plan)) {
    merged.plan = body.plan;
  }

  merged.dossier = rowToDossier(merged);
  return merged;
}

module.exports = {
  rowToDossier,
  formToTenantPayload,
  settingsToTenantPayload,
  normalizeReservationLinks,
  parseFaq,
  parsePolicies,
  parseServices,
  servicesToText,
  faqToText,
  policiesToText,
  DEFAULT_HOURS,
};
