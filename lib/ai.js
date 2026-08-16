// Réponses SMS IA basées sur le dossier commerce (OpenAI).

const { formatQualificationPromptBlock, detectQualificationWorkflow } = require('./qualification');
const {
  formatServicesForPrompt,
  resolveBookingAction,
} = require('./service-workflows');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_SMS = 480;
const MAX_AGENT_INSTRUCTIONS = 2000;

function trimAgentInstructions(text) {
  return String(text || '').trim().slice(0, MAX_AGENT_INSTRUCTIONS);
}

/** Déduit le genre grammatical du prénom (défaut: féminin pour Léa et prénoms en -a/-ie). */
function resolveAgentGender(agent) {
  const explicit = String((agent && (agent.genre || agent.gender)) || '').toLowerCase();
  if (explicit === 'f' || explicit === 'feminin' || explicit === 'féminin' || explicit === 'female') return 'f';
  if (explicit === 'm' || explicit === 'masculin' || explicit === 'male') return 'm';
  const name = String((agent && agent.nom_agent) || '').trim().toLowerCase();
  if (!name) return 'f';
  const male = new Set([
    'jean', 'pierre', 'marc', 'luc', 'paul', 'alex', 'max', 'louis', 'thomas', 'nicolas',
    'samuel', 'olivier', 'antoine', 'hugo', 'leo', 'léo', 'gabriel', 'felix', 'félix',
    'etienne', 'étienne', 'benoit', 'benoît', 'david', 'kevin', 'kévin', 'william',
  ]);
  const female = new Set([
    'lea', 'léa', 'marie', 'sophie', 'julie', 'claire', 'emma', 'chloe', 'chloé',
    'camille', 'jade', 'mia', 'alice', 'anne', 'isabelle', 'catherine', 'valerie', 'valérie',
    'nathalie', 'amelie', 'amélie', 'sarah', 'laura', 'kim', 'eve', 'ève',
  ]);
  const first = name.split(/[\s-]+/)[0];
  if (male.has(first)) return 'm';
  if (female.has(first)) return 'f';
  if (/(a|e|ie|ette|elle|ine)$/i.test(first)) return 'f';
  return 'm';
}

function genderPromptLine(gender) {
  if (gender === 'f') {
    return 'Genre: féminin — conjugue et accorde au féminin (ex. : « Je suis désolée », « ravie », pas « désolé » / « ravi »).';
  }
  return 'Genre: masculin — conjugue et accorde au masculin (ex. : « Je suis désolé », « ravi », pas « désolée » / « ravie »).';
}

function formatHours(hours) {
  const h = (hours && hours.horaire) || hours || {};
  return Object.entries(h)
    .map(([day, v]) => {
      if (!v || !v.ouvert) return `${day}: fermé`;
      return `${day}: ${v.debut || '?'} – ${v.fin || '?'}`;
    })
    .join('\n');
}

function buildSystemPrompt(dossier, opts = {}) {
  const calendarLive = !!opts.calendarLive;
  const biz = (dossier && dossier.entreprise) || {};
  const agent = (dossier && dossier.identite_agent) || {};
  const coord = (dossier && dossier.coordonnees) || {};
  const scripts = (dossier && dossier.scripts) || {};
  const services = formatServicesForPrompt(dossier.services || []);
  const faq = (dossier.faq || [])
    .map((f) => `Q: ${f.question}\nR: ${f.reponse}`)
    .join('\n\n');
  const policies = (dossier.policies || []).map((p) => `- ${p}`).join('\n');
  const favorites = (dossier.agent_favorites || [])
    .map((f) => `- ${f.label ? `${f.label} : ` : ''}${f.content}`)
    .join('\n');
  const favoritesBlock = favorites
    ? `\nFAVORIS AGENT (priorité élevée — infos que le propriétaire veut toujours utiliser; ne pas demander au client de répéter)\n${favorites}\n`
    : '';
  const workflow = detectQualificationWorkflow({
    business_type: biz.type,
    business_name: biz.nom_court,
    coordonnees: coord,
    reservation_url: coord.reservation_url,
  });
  const qualificationBlock = formatQualificationPromptBlock(dossier.qualification_fields || [], workflow);
  const customInstructions = trimAgentInstructions(agent.instructions);
  const instructionsBlock = customInstructions
    ? `\nINSTRUCTIONS PERSONNALISÉES (priorité élevée — du propriétaire du commerce)\n${customInstructions}\n`
    : '';
  const rules = (agent.interdictions || [])
    .filter((r) => !(calendarLive && /confirmer un rendez-vous/i.test(r)))
    .map((r) => `- ${r}`)
    .join('\n');

  const phonePublic = String(coord.telephone || '').trim();
  const phoneLine = phonePublic
    ? `Téléphone du commerce / site web (à donner au client si demandé): ${phonePublic}`
    : 'Téléphone du commerce: non configuré — ne pas inventer de numéro; propose un rappel.';
  const emailLine = coord.courriel
    ? `Courriel: ${coord.courriel}`
    : '';

  const reservationLinks = Array.isArray(coord.reservation_links) && coord.reservation_links.length
    ? coord.reservation_links
      .map((l) => ({
        label: String((l && l.label) || '').trim(),
        url: String((l && l.url) || '').trim(),
      }))
      .filter((l) => l.url)
    : (String(coord.reservation_url || '').trim()
      ? [{ label: '', url: String(coord.reservation_url).trim() }]
      : []);

  const reservationLine = reservationLinks.length
    ? (reservationLinks.length === 1
      ? `Lien de réservation ou de soumission (URL exacte à coller): ${reservationLinks[0].label ? reservationLinks[0].label + ' → ' : ''}${reservationLinks[0].url}`
      : `Liens de réservation ou de soumission (coller l'URL qui correspond au service demandé):\n${reservationLinks.map((l) => `- ${l.label || 'Lien'} : ${l.url}`).join('\n')}`)
    : 'Aucun lien de réservation ou de soumission configuré — propose de noter nom, téléphone et disponibilités.';

  const allText = [services, faq, policies, scripts.reservation || '', scripts.accueil || ''].join('\n');
  const foundLinks = [...allText.matchAll(/https?:\/\/[^\s<>"']+/gi)]
    .map((m) => m[0].replace(/[.,);:]+$/g, ''))
    .filter((u) => /reserv|soumis|rdv|rendez|book|formulaire|appointment|calendly|acuity|demande|contact|quote|devis/i.test(u));
  const knownUrls = new Set(reservationLinks.map((l) => l.url));
  const uniqueLinks = [...new Set(foundLinks)].filter((u) => !knownUrls.has(u)).slice(0, 4);
  const linksBlock = uniqueLinks.length
    ? `\nAutres liens utiles dans la base:\n${uniqueLinks.map((u) => `- ${u}`).join('\n')}`
    : '';

  const gender = resolveAgentGender(agent);
  const roleLabel = gender === 'f' ? 'employée virtuelle' : 'employé virtuel';
  let prompt = `Tu es ${agent.nom_agent || 'Léa'}, ${roleLabel} de ${biz.nom_court || 'ce commerce'}.
${agent.role || ''}
Ton: ${agent.ton || 'Français québécois, chaleureux et professionnel'}
${genderPromptLine(gender)}
${agent.vouvoiement !== false ? 'Vouvoiement.' : 'Tutoiement.'}

COMMERCE
Type: ${biz.type || 'PME'}
Adresse: ${[coord.adresse_ligne1, coord.ville, coord.province].filter(Boolean).join(', ') || 'non précisée'}
${phoneLine}
${emailLine}
${coord.site_web ? `Site web (indexé en profondeur pour toi): ${coord.site_web}` : ''}
${reservationLine}
${linksBlock}

HORAIRES
${formatHours(dossier.heures_ouverture)}

SERVICES
${services || '(aucun service saisi manuellement — cherche dans les EXTRAITS PERTINENTS / synthèse du site)'}

FAQ
${faq || '(aucune FAQ manuelle — cherche dans les EXTRAITS PERTINENTS)'}

POLITIQUES
${policies || '(aucune)'}${favoritesBlock}${qualificationBlock}${instructionsBlock}

SCRIPTS UTILES
Accueil: ${scripts.accueil || ''}
Appel manqué: ${scripts.texto_rappel || ''}
Réservation: ${scripts.reservation || ''}
Rappel humain: ${scripts.transfert_humain || 'Je transmets à l\'équipe pour un rappel.'}

MÉTHODE (obligatoire)
1. Lis la question du client.
2. Cherche la réponse dans cet ordre : FAVORIS AGENT → EXTRAITS PERTINENTS (site web analysé de fond en comble + documents) → FAQ → SERVICES → HORAIRES → POLITIQUES → INSTRUCTIONS PERSONNALISÉES → coordonnées/liens.
3. Le site du commerce a souvent été crawlé (services, prix, contact, FAQ, à propos). Si l'info s'y trouve, réponds avec ces faits — ne dis pas « je ne sais pas ».
4. N'invente JAMAIS un fait absent de ces sources.
5. Si l'info n'est vraiment nulle part, dis-le clairement et propose un rappel humain.

RÈGLES STRICTES
${rules}
- Réponses COURTES pour SMS (2–4 phrases max, ~${MAX_SMS} caractères).
${calendarLive
    ? '- Calendrier CONNECTÉ. Propose uniquement les plages de AGENDA RÉEL. Ne dis PAS que le rendez-vous est confirmé, inscrit ou réservé — le système le confirmera seulement si l\'événement est créé.'
    : '- Ne confirme JAMAIS un rendez-vous à une heure précise — note la demande ou donne le lien de réservation/soumission. Dis clairement que le commerce confirmera.'}
- ACTION PAR SERVICE: identifie le service demandé, puis suis l'ACTION entre crochets pour CE service. Si le service n'est pas clair, demande lequel avant de proposer un créneau ou un lien. Un service « lien externe » : colle l'URL, sans créer d'événement agenda. Un service « rappel humain » : prends les infos, ne réserve pas.
- RÈGLE TÉLÉPHONE (obligatoire): si le client demande le numéro, comment vous joindre, ou « votre téléphone », et qu'un téléphone du commerce / site web est listé ci-dessus → donne TOUJOURS ce numéro exact (celui du site / Google). Ne donne PAS un autre numéro. Ne dis JAMAIS que tu ne peux pas fournir le numéro si il est dans la base. S'il n'y a pas de numéro configuré: dis-le clairement et propose un rappel.
- RÈGLE LIEN (obligatoire): si le client demande un RDV, une réservation, une soumission, un devis, un formulaire ou « le lien », et qu'une URL est listée ci-dessus → inclus TOUJOURS l'URL complète (https://...) dans ta réponse. Ne dis pas seulement « je vous envoie le lien » sans coller l'URL. S'il y a plusieurs liens: envoie celui qui correspond au service demandé (selon le libellé); si ce n'est pas clair, demande quel service ou envoie les liens utiles avec leur libellé. S'il n'y a aucun lien: dis-le et prends les coordonnées.
- Pas de markdown. Pas de listes numérotées longues.`;
  if (calendarLive) {
    prompt = prompt
      .replace(/ne confirme JAMAIS une heure ferme[^\n]*/gi, 'proposer des disponibilités selon AGENDA RÉEL, sans dire que c\'est confirmé')
      .replace(/Ne confirme JAMAIS un RDV[^\n]*/gi, 'Si la plage est dans AGENDA RÉEL, dis qu\'elle est libre. Ne dis pas que le RDV est confirmé.');
  }
  return prompt;
}

async function generateReply(dossier, history, userMessage, tenantId, opts = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  let dossierForPrompt = dossier;
  // Si pas de numéro public configuré, tenter celui trouvé sur le site indexé
  if (tenantId && !(dossier && dossier.coordonnees && String(dossier.coordonnees.telephone || '').trim())) {
    try {
      const { findWebsitePhone } = require('./knowledge');
      const twilio = dossier && dossier.coordonnees && dossier.coordonnees.telephone_sms;
      const webPhone = await findWebsitePhone(tenantId, twilio);
      if (webPhone) {
        dossierForPrompt = {
          ...dossier,
          coordonnees: {
            ...(dossier.coordonnees || {}),
            telephone: webPhone,
          },
        };
      }
    } catch (e) {
      console.error('website phone skip', e.message);
    }
  }

  let kbContext = '';
  if (tenantId) {
    try {
      const { searchKnowledge } = require('./knowledge');
      const biz = (dossierForPrompt && dossierForPrompt.entreprise && dossierForPrompt.entreprise.nom_court) || '';
      const searchQuery = [userMessage, biz].filter(Boolean).join(' — ');
      const hits = await searchKnowledge(tenantId, searchQuery, 10, 0.26);
      if (hits.length) {
        kbContext = '\n\nEXTRAITS PERTINENTS (site web / documents indexés — utilise ces faits en priorité s\'ils répondent à la question):\n'
          + hits.map((h, i) => `[${i + 1}] ${h.content}`).join('\n---\n');
        const kbLinks = [...kbContext.matchAll(/https?:\/\/[^\s<>"']+/gi)]
          .map((m) => m[0].replace(/[.,);:]+$/g, ''));
        const uniq = [...new Set(kbLinks)].slice(0, 5);
        if (uniq.length) {
          kbContext += '\n\nLiens trouvés dans les extraits (coller si pertinent pour la demande):\n'
            + uniq.map((u) => `- ${u}`).join('\n');
        }
      }
    } catch (e) {
      console.error('kb context skip', e.message);
    }
  }

  let calendarContext = '';
  let calendarLive = false;
  if (tenantId) {
    try {
      const { looksLikeScheduling, formatAvailabilityForPrompt, hasConnectedCalendar } = require('./calendar');
      const calendarConnected = await hasConnectedCalendar(tenantId);
      const bookingAction = opts.bookingAction != null ? opts.bookingAction : resolveBookingAction({
        services: dossierForPrompt && dossierForPrompt.services,
        userMessage,
        qualificationData: opts.qualificationData,
        calendarConnected,
        reservationLinks: dossierForPrompt && dossierForPrompt.coordonnees && dossierForPrompt.coordonnees.reservation_links,
        reservationUrl: dossierForPrompt && dossierForPrompt.coordonnees && dossierForPrompt.coordonnees.reservation_url,
      });
      const useCalendar = calendarConnected && bookingAction.create;
      if (bookingAction.action === 'ask_service') {
        calendarContext = '\n\nACTION SERVICE: le service n\'est pas identifié. Demande quel service avant de proposer un créneau, un lien ou une confirmation. Ne propose pas d\'heure précise à réserver.\n';
        calendarLive = false;
      } else if (useCalendar && (looksLikeScheduling(userMessage) || /calendrier|calendar|agenda|google|outlook|rdv|rendez/i.test(userMessage))) {
        calendarContext = await formatAvailabilityForPrompt(
          tenantId,
          dossierForPrompt,
          bookingAction.durationMin || bookingAction.duration_minutes,
        );
        calendarLive = true;
      } else if (useCalendar) {
        calendarContext = '\n\nAGENDA RÉEL (calendrier Google/Outlook CONNECTÉ)\nSi on te demande si tu as accès au calendrier : OUI. Quand le client parle de rendez-vous, propose des plages selon les HORAIRES et l\'agenda, pour la durée du service identifié.\n';
        calendarLive = true;
      } else if (bookingAction.action === 'send_link' && bookingAction.booking_url) {
        calendarContext = `\n\nACTION SERVICE: envoie ce lien exact: ${bookingAction.booking_url}. Ne propose pas de plage d'agenda et ne dis pas que c'est confirmé.\n`;
        calendarLive = false;
      } else if (bookingAction.action === 'human') {
        calendarContext = '\n\nACTION SERVICE: ne réserve pas et ne propose pas de créneau. Prends les infos selon la qualification et dis que l\'équipe va rappeler.\n';
        calendarLive = false;
      }
    } catch (e) {
      console.warn('calendar context skip', e.message);
    }
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(dossierForPrompt, { calendarLive }) + kbContext + calendarContext },
    ...(history || []).slice(-10).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 220,
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('OpenAI error', res.status, err);
    return null;
  }

  const data = await res.json();
  let text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  text = text.trim().replace(/\*\*/g, '');
  if (text.length > MAX_SMS) text = text.slice(0, MAX_SMS - 1) + '…';
  return text || null;
}

function withAiBudget(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), ms)),
  ]).then((value) => (value && value.timeout ? null : value));
}

function buildTimeoutFallback({ tenant, dossier, userMessage, priorAssistantCount }) {
  const agent = (tenant && tenant.agent_name)
    || (dossier && dossier.identite_agent && dossier.identite_agent.nom_agent)
    || 'Léa';
  const biz = (tenant && tenant.business_name)
    || (dossier && dossier.entreprise && dossier.entreprise.nom_court)
    || 'notre commerce';
  let scheduling = false;
  try {
    const { looksLikeScheduling } = require('./calendar');
    scheduling = looksLikeScheduling(userMessage);
  } catch (_) { /* ignore */ }
  if (scheduling) {
    return `Bien reçu. ${agent} de ${biz} revient tout de suite pour vos disponibilités — ${biz} vous confirmera le rendez-vous.`;
  }
  if (priorAssistantCount > 0) {
    return `Un instant, ${agent} de ${biz} vous revient tout de suite.`;
  }
  return `Bien reçu. ${agent} de ${biz} vous répond dans un instant.`;
}

module.exports = { generateReply, buildSystemPrompt, resolveAgentGender, withAiBudget, buildTimeoutFallback };
