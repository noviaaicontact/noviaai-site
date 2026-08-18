/**
 * Chat proprio : construit l'agent selon comment le commerce fonctionne.
 * Site crawlé = faits. Conversation = actions par service (rappel, lien, agenda).
 */

const { settingsToTenantPayload, normalizeAgentFavorites, normalizeReservationLinks } = require('./dossier-builder');
const { updateTenantById } = require('./tenant');
const { normalizeService, normalizeServices, formatServicesForPrompt } = require('./service-workflows');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_INSTRUCTIONS = 2000;
const BOOKING_MODES = ['calendar', 'external_link', 'estimate', 'human'];

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseCoachDecision(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fence = text.match(/\{[\s\S]*\}/);
  const jsonText = fence ? fence[0] : text;
  try {
    const data = JSON.parse(jsonText);
    const favorites = Array.isArray(data.favorites_add)
      ? data.favorites_add.map((f) => ({
        label: String((f && f.label) || '').trim().slice(0, 80),
        content: String((f && f.content) || '').trim().slice(0, 500),
      })).filter((f) => f.content)
      : [];
    const services = Array.isArray(data.services_upsert)
      ? data.services_upsert.map((s) => {
        if (!s || typeof s !== 'object') return null;
        const nom = String(s.nom || '').trim().slice(0, 80);
        if (!nom) return null;
        const mode = BOOKING_MODES.includes(s.booking_mode) ? s.booking_mode : '';
        const row = { nom };
        if (mode) row.booking_mode = mode;
        if (s.booking_url) row.booking_url = String(s.booking_url).trim().slice(0, 300);
        if (s.prix) row.prix = String(s.prix).trim().slice(0, 80);
        if (s.notify_owner === false) row.notify_owner = false;
        if (s.notify_owner === true) row.notify_owner = true;
        if (s.duration_minutes != null) row.duration_minutes = s.duration_minutes;
        return row;
      }).filter(Boolean)
      : [];
    const links = Array.isArray(data.links_add)
      ? data.links_add.map((l) => ({
        label: String((l && l.label) || '').trim().slice(0, 80),
        url: String((l && l.url) || '').trim().slice(0, 300),
      })).filter((l) => /^https?:\/\//i.test(l.url))
      : [];
    const faq = Array.isArray(data.faq_add)
      ? data.faq_add.map((f) => ({
        question: String((f && f.question) || '').trim().slice(0, 200),
        reponse: String((f && f.reponse) || '').trim().slice(0, 500),
      })).filter((f) => f.question && f.reponse)
      : [];
    const wf = data.workflow === 'appointment' || data.workflow === 'field_service'
      ? data.workflow
      : null;
    return {
      reply: String(data.reply || '').trim().slice(0, 500),
      instructions_add: String(data.instructions_add || '').trim().slice(0, 1500),
      favorites_add: favorites.slice(0, 5),
      services_upsert: services.slice(0, 20),
      links_add: links.slice(0, 10),
      faq_add: faq.slice(0, 12),
      workflow: wf,
      public_phone: String(data.public_phone || '').trim().slice(0, 32) || null,
      agent_name: String(data.agent_name || '').trim().slice(0, 40) || null,
    };
  } catch {
    return null;
  }
}

function mergeInstructions(existing, add) {
  const extra = String(add || '').trim();
  const base = String(existing || '').trim();
  if (!extra) return base;
  if (!base) return extra.slice(0, MAX_INSTRUCTIONS);
  if (base.toLowerCase().includes(extra.toLowerCase())) return base;
  return `${base}\n${extra}`.slice(0, MAX_INSTRUCTIONS);
}

function mergeFavorites(existing, add) {
  const out = normalizeAgentFavorites(existing);
  normalizeAgentFavorites(add).forEach((fav) => {
    const hit = out.some((x) => String(x.content).toLowerCase() === String(fav.content).toLowerCase());
    if (!hit) out.push(fav);
  });
  return out.slice(0, 30);
}

function mergeServices(existing, upserts) {
  const list = normalizeServices(existing, { fillDefaults: false }).map((s) => ({ ...s }));
  (upserts || []).forEach((raw) => {
    const next = normalizeService(raw, { fillDefaults: false });
    if (!next) return;
    const key = normName(next.nom);
    const idx = list.findIndex((s) => normName(s.nom) === key);
    if (idx >= 0) {
      const cur = { ...list[idx], ...next };
      if (raw.notify_owner === false) cur.notify_owner = false;
      if (raw.notify_owner === true) delete cur.notify_owner;
      list[idx] = cur;
    } else {
      list.push(next);
    }
  });
  return list.slice(0, 80);
}

function mergeReservationLinks(existing, add) {
  const out = normalizeReservationLinks(existing || [], '').slice();
  (add || []).forEach((l) => {
    const url = String(l && l.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    const idx = out.findIndex((x) => x.url === url);
    if (idx >= 0) {
      if (l.label) out[idx] = { ...out[idx], label: String(l.label).trim() };
    } else {
      out.push({ label: String((l && l.label) || '').trim(), url });
    }
  });
  return out.slice(0, 20);
}

function mergeFaq(existing, add) {
  const out = Array.isArray(existing) ? existing.slice() : [];
  (add || []).forEach((f) => {
    const q = String(f.question || '').trim();
    const r = String(f.reponse || '').trim();
    if (!q || !r) return;
    const hit = out.some((x) => normName(x.question) === normName(q));
    if (!hit) out.push({ question: q, reponse: r });
  });
  return out.slice(0, 40);
}

function servicesBrief(tenant) {
  const text = formatServicesForPrompt(tenant.services || []);
  if (text && !text.startsWith('(aucun')) return text;
  return '(aucun service configuré — à créer d’après ce que dit le propriétaire)';
}

function buildCoachPrompt(tenant, siteBits) {
  const name = tenant.agent_name || 'l’agent';
  const biz = tenant.business_name || 'le commerce';
  const hasSite = !!(tenant.website_url && String(tenant.website_url).trim());
  const links = Array.isArray(tenant.reservation_links) ? tenant.reservation_links : [];
  const linkLines = links.filter((l) => l && l.url).map((l) => `- ${l.label || 'Lien'} : ${l.url}`).join('\n')
    || '(aucun lien)';
  const wf = tenant.qualification_workflow === 'appointment' ? 'sur rendez-vous' : 'service sur place / magasin';

  return `Tu CONSTRUIS l'agente SMS « ${name} » pour « ${biz} ».
Pas un FAQ générique : tu définis comment CHAQUE type de demande se traite.

ACTIONS possibles par service :
- human = l'équipe rappelle (ouverture, réparation, install). JAMAIS d'heure ferme.
- external_link = coller une URL exacte (Fresha, soumission, boutique). N'invente PAS d'URL.
- calendar = réserver un créneau Google (seulement si le proprio le dit).
- estimate = visite d'estimation à l'agenda.

notify_owner: false seulement si c'est gratuit / magasin (analyse d'eau, produits à aller chercher). Sinon true / omis.

Le site ${hasSite ? 'est analysé — sers-t-en pour les faits, pas pour inventer des actions' : "n'est PAS collé : demande l'URL en haut"}.
Type de demandes actuel : ${wf}.
Change workflow à "appointment" si salon/clinique/rdv, "field_service" si garage/terrain/magasin.

Services déjà configurés :
${servicesBrief(tenant)}

Liens :
${linkLines}

${siteBits ? `Faits du site :\n${siteBits}\n` : ''}
Consignes déjà là :
${String(tenant.agent_instructions || '(aucune)').slice(0, 500)}

Méthode (obligatoire) :
1. Écoute TOUTES les consignes du propriétaire.
2. EXÉCUTE : remplis services_upsert, links_add, faq_add, instructions_add, favorites_add avec TOUT ce qui est utilisable MAINTENANT. Ne laisse pas ça « pour plus tard ».
3. ENREGISTRE via ce JSON — le système sauve tout seul en base. Dans reply, liste concrètement ce que tu as enregistré.
4. Ensuite seulement, UNE question s'il manque encore une action (lien manquant, rappel vs magasin).
5. Tutoiement, québécois. Tu n'es pas un chatbot de discussion : tu configures l'agente pour vrai.

Réponds UNIQUEMENT un JSON :
{"reply":"…","workflow":null,"instructions_add":"","favorites_add":[],"services_upsert":[{"nom":"…","booking_mode":"human","booking_url":"","notify_owner":true,"prix":""}],"links_add":[{"label":"","url":""}],"faq_add":[{"question":"","reponse":""}],"public_phone":null,"agent_name":null}`;
}

async function siteContext(tenantId, message) {
  try {
    const { searchKnowledge } = require('./knowledge');
    const hits = await searchKnowledge(tenantId, message || 'services horaires contact', 4, 0.28);
    return (hits || []).map((h) => h.content).filter(Boolean).join('\n').slice(0, 1600);
  } catch {
    return '';
  }
}

function emptyDecision() {
  return {
    reply: 'Explique-moi un service : qu’est-ce que le client veut, et qu’est-ce que vous faites après — rappel, lien, ou magasin ?',
    instructions_add: '',
    favorites_add: [],
    services_upsert: [],
    links_add: [],
    faq_add: [],
    workflow: null,
    public_phone: null,
    agent_name: null,
  };
}

async function decideCoachPatch({ tenant, message, history }) {
  const fallback = emptyDecision();
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallback;

  const siteBits = await siteContext(tenant.id, message);
  const messages = [
    { role: 'system', content: buildCoachPrompt(tenant, siteBits) },
    ...(history || []).slice(-8).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: String(m.content || '').slice(0, 2000),
    })),
    { role: 'user', content: String(message || '').slice(0, 4000) },
  ];

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 900,
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      console.warn('agent-coach http', res.status);
      return fallback;
    }
    const data = await res.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return parseCoachDecision(raw) || fallback;
  } catch (e) {
    console.warn('agent-coach', e.message);
    return fallback;
  }
}

async function runAgentCoach({ tenant, message, history }) {
  const decision = await decideCoachPatch({ tenant, message, history });
  const patchBody = {};
  const applied = [];

  if (decision.instructions_add) {
    patchBody.agent_instructions = mergeInstructions(tenant.agent_instructions, decision.instructions_add);
    applied.push('consignes');
  }
  if (decision.favorites_add && decision.favorites_add.length) {
    patchBody.agent_favorites = mergeFavorites(tenant.agent_favorites, decision.favorites_add);
    applied.push('infos');
  }
  if (decision.services_upsert && decision.services_upsert.length) {
    patchBody.services = mergeServices(tenant.services, decision.services_upsert);
    applied.push('services');
  }
  if (decision.links_add && decision.links_add.length) {
    patchBody.reservation_links = mergeReservationLinks(tenant.reservation_links, decision.links_add);
    applied.push('liens');
  }
  if (decision.faq_add && decision.faq_add.length) {
    patchBody.faq = mergeFaq(tenant.faq, decision.faq_add);
    applied.push('faq');
  }
  if (decision.workflow) {
    patchBody.qualification_workflow = decision.workflow;
    applied.push('type de demandes');
  }
  if (decision.public_phone) {
    patchBody.public_phone = decision.public_phone;
    applied.push('téléphone');
  }
  if (decision.agent_name) {
    patchBody.agent_name = decision.agent_name;
    applied.push('prénom');
  }

  let saved = false;
  let updated = tenant;
  if (applied.length) {
    const merged = settingsToTenantPayload(patchBody, tenant);
    updated = await updateTenantById(tenant.id, merged);
    saved = true;
  }

  const reply = decision.reply
    || (saved ? 'C’est noté, l’agente est à jour.' : emptyDecision().reply);

  return {
    reply,
    saved,
    applied,
    tenant: updated,
  };
}

module.exports = {
  parseCoachDecision,
  mergeInstructions,
  mergeFavorites,
  mergeServices,
  mergeReservationLinks,
  runAgentCoach,
};
