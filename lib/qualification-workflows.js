/**
 * Workflows de qualification NoviaAI — adaptés au type d'entreprise.
 *
 * SCÉNARIO 1 — appointment : salons, cliniques, services sur rendez-vous
 * SCÉNARIO 2 — field_service : plombiers, électriciens, garages, terrain
 */

const WORKFLOW_APPOINTMENT = 'appointment';
const WORKFLOW_FIELD_SERVICE = 'field_service';

const APPOINTMENT_KEYWORDS = [
  'salon', 'coiffure', 'coiffeur', 'esthétique', 'esthetique', 'beauté', 'beaute',
  'spa', 'clinique', 'dentiste', 'dental', 'médical', 'medical', 'physio',
  'massoth', 'optom', 'vétérinaire', 'veterinaire', 'cabinet', 'consultation',
  'avocat', 'comptable', 'notaire', 'professionnel', 'barbier', 'onglerie',
];

const FIELD_SERVICE_KEYWORDS = [
  'plombier', 'plomberie', 'électricien', 'electricien', 'garage', 'mécanique',
  'mecanique', 'automobile', 'toiture', 'couvreur', 'entrepreneur', 'construction',
  'chauffage', 'hvac', 'climatisation', 'déneigement', 'deneigement', 'excavation',
  'serrurier', 'vitrier', 'paysag', 'dépannage', 'depannage', 'urgence',
];

const FIELD_DEFINITIONS = {
  nom: { label: 'Nom du client', enabled: true, required: true },
  telephone: { label: 'Téléphone', enabled: true, required: false },
  service_souhaite: { label: 'Service désiré', enabled: true, required: true },
  preferences: { label: 'Préférences du client', enabled: false, required: false },
  disponibilites: { label: 'Disponibilités', enabled: true, required: true },
  creneau_confirme: { label: 'Créneau souhaité', enabled: false, required: false },
  demande: { label: 'Demande / sujet', enabled: true, required: true },
  probleme: { label: 'Type de problème', enabled: true, required: true },
  urgence: { label: 'Urgence', enabled: false, required: false },
  depuis_quand: { label: 'Depuis quand', enabled: false, required: false },
  adresse: { label: 'Adresse', enabled: true, required: false },
  disponibilite_rappel: { label: 'Meilleur moment pour rappeler', enabled: true, required: true },
};

const WORKFLOW_FIELD_KEYS = {
  [WORKFLOW_APPOINTMENT]: [
    'nom', 'telephone', 'service_souhaite', 'preferences', 'disponibilites', 'creneau_confirme',
  ],
  [WORKFLOW_FIELD_SERVICE]: [
    'nom', 'telephone', 'probleme', 'urgence', 'depuis_quand', 'adresse', 'disponibilite_rappel',
  ],
};

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function matchesKeywords(text, keywords) {
  const t = normalizeText(text);
  return keywords.some((kw) => t.includes(normalizeText(kw)));
}

/**
 * Détecte le workflow à partir du type d'entreprise, nom ou instruction explicite.
 * @param {{ business_type?: string, business_name?: string, qualification_workflow?: string }} tenantOrDossier
 */
function detectQualificationWorkflow(tenantOrDossier) {
  const explicit = String(
    tenantOrDossier?.qualification_workflow
    || tenantOrDossier?.entreprise?.qualification_workflow
    || '',
  ).trim();
  if (explicit === WORKFLOW_APPOINTMENT || explicit === WORKFLOW_FIELD_SERVICE) {
    return explicit;
  }

  const blob = [
    tenantOrDossier?.business_type,
    tenantOrDossier?.business_name,
    tenantOrDossier?.entreprise?.type,
    tenantOrDossier?.entreprise?.nom_court,
  ].filter(Boolean).join(' ');

  if (matchesKeywords(blob, APPOINTMENT_KEYWORDS)) return WORKFLOW_APPOINTMENT;
  if (matchesKeywords(blob, FIELD_SERVICE_KEYWORDS)) return WORKFLOW_FIELD_SERVICE;

  // Lien de réservation → plutôt appointment
  const hasBooking = !!(tenantOrDossier?.reservation_url
    || tenantOrDossier?.coordonnees?.reservation_url
    || (tenantOrDossier?.coordonnees?.reservation_links || []).length);
  if (hasBooking) return WORKFLOW_APPOINTMENT;

  return WORKFLOW_FIELD_SERVICE;
}

function defaultFieldsForWorkflow(workflow) {
  const keys = WORKFLOW_FIELD_KEYS[workflow] || WORKFLOW_FIELD_KEYS[WORKFLOW_FIELD_SERVICE];
  return keys.map((key) => {
    const def = FIELD_DEFINITIONS[key] || { label: key, enabled: true, required: false };
    return { key, label: def.label, enabled: def.enabled, required: def.required };
  });
}

function mergeQualificationFields(raw, workflow) {
  const wf = workflow || WORKFLOW_FIELD_SERVICE;
  const defaults = defaultFieldsForWorkflow(wf);
  const allowed = new Set(defaults.map((f) => f.key));
  const byKey = new Map(defaults.map((f) => [f.key, { ...f }]));

  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const key = String(item.key || '').trim();
      if (!allowed.has(key)) return;
      byKey.set(key, {
        key,
        label: String(item.label || byKey.get(key).label).trim().slice(0, 80) || byKey.get(key).label,
        enabled: item.enabled !== false,
        required: item.required != null ? !!item.required : byKey.get(key).required,
      });
    });
  }

  return defaults.map((f) => byKey.get(f.key) || { ...f });
}

function missedCallSmsForWorkflow(workflow, businessName, agentName) {
  const biz = businessName || 'notre entreprise';
  const agent = agentName || 'Léa';
  if (workflow === WORKFLOW_APPOINTMENT) {
    return (
      `Bonjour! Ici ${agent}, de ${biz}. Désolé, on a manqué votre appel! `
      + `Répondez à ce texto — je vais noter le service souhaité et vos disponibilités pour un rendez-vous.`
    );
  }
  return (
    `Bonjour! Ici ${agent}, de ${biz}. Nous avons remarqué votre appel. `
    + `Je vais prendre quelques informations pour que notre équipe puisse mieux vous aider.`
  );
}

function formatWorkflowPromptBlock(workflow, fields) {
  const list = (fields || []).filter((f) => f.enabled);
  if (!list.length) return '';

  const lines = list.map((f) => {
    const req = f.required ? ' (obligatoire)' : ' (si pertinent)';
    return `- ${f.label}${req}`;
  }).join('\n');

  if (workflow === WORKFLOW_APPOINTMENT) {
    return `
WORKFLOW QUALIFICATION — PRISE DE RENDEZ-VOUS (Scénario 1)
Objectif : transformer l'appel manqué en demande de RDV qualifiée (pas seulement un chat).

Infos à collecter (UNE question à la fois, SMS court) :
${lines}

Étapes conversationnelles :
1. Accueillir + confirmer que vous pouvez l'aider pour un rendez-vous.
2. Demander le service désiré (coupe, consultation, etc.).
3. Demander les préférences (coiffeur, durée, première visite, etc.) si pertinent.
4. Proposer des disponibilités selon les HORAIRES — ne confirme JAMAIS une heure ferme.
5. Si un lien de réservation est configuré, l'envoyer avec l'URL complète.
6. Récapituler brièvement avant de transmettre à l'équipe.

Règles :
- Ne redemande JAMAIS une info déjà donnée.
- Le numéro de l'appelant est souvent connu — confirme seulement si utile.
- Ne confirme JAMAIS un RDV à une heure précise sans lien/agenda — note la demande seulement.
`;
  }

  return `
WORKFLOW QUALIFICATION — SERVICE TERRAIN (Scénario 2)
Objectif : transformer l'appel manqué en demande qualifiée prête pour rappel ou intervention.

Infos à collecter (UNE question à la fois, SMS court) :
${lines}

Ordre suggéré :
1. Nom du client
2. Type de problème (fuite, panne, bruit, etc.)
3. Adresse ou secteur pour l'intervention
4. Meilleur moment pour un rappel

Règles :
- Ne redemande JAMAIS une info déjà donnée.
- Ne demande PAS si c'est urgent (sauf si le client le mentionne spontanément).
- Le numéro de l'appelant est souvent connu — confirme seulement si utile.
- Ne donne JAMAIS de prix ferme ni de délai garanti — note la demande pour l'équipe.
- En cas d'urgence vitale (gaz, incendie), orienter vers les services d'urgence appropriés.
`;
}

function fieldValue(data, ...keys) {
  if (!data) return '';
  for (const k of keys) {
    const v = String(data[k] || '').trim();
    if (v) return v;
  }
  return '';
}

function recommendNextAction(workflow, data) {
  const urgence = normalizeText(fieldValue(data, 'urgence'));
  const isUrgent = /urgent|oui|immédiat|immediate|asap|aujourd|maintenant/.test(urgence);

  if (workflow === WORKFLOW_APPOINTMENT) {
    const service = fieldValue(data, 'service_souhaite', 'demande');
    const dispo = fieldValue(data, 'disponibilites', 'creneau_confirme');
    if (service && dispo) {
      return 'Confirmer le créneau avec le client et synchroniser l\'agenda / lien de réservation.';
    }
    if (service) return 'Proposer des disponibilités selon l\'agenda et confirmer le rendez-vous.';
    return 'Identifier le service souhaité et les préférences du client.';
  }

  if (isUrgent && fieldValue(data, 'adresse', 'probleme')) {
    return 'Rappeler le client en priorité — urgence signalée.';
  }
  if (fieldValue(data, 'nom') && fieldValue(data, 'probleme') && fieldValue(data, 'disponibilite_rappel')) {
    return 'Planifier rappel ou intervention selon disponibilité indiquée.';
  }
  if (fieldValue(data, 'probleme')) {
    return 'Compléter adresse et disponibilité pour rappel.';
  }
  return 'Continuer la qualification (problème, urgence, adresse).';
}

function formatOwnerSummaryText(workflow, data, fields, callerPhone) {
  const phone = fieldValue(data, 'telephone') || callerPhone || '—';
  const lines = ['Nouveau prospect', ''];

  const add = (label, ...keys) => {
    const val = fieldValue(data, ...keys);
    if (val) lines.push(`${label} : ${val}`);
  };

  add('Nom', 'nom');
  lines.push(`Téléphone : ${phone}`);

  if (workflow === WORKFLOW_APPOINTMENT) {
    add('Service demandé', 'service_souhaite', 'demande');
    add('Préférences', 'preferences');
    add('Disponibilités', 'disponibilites', 'creneau_confirme');
  } else {
    add('Service demandé', 'probleme', 'demande');
    add('Urgence', 'urgence');
    add('Depuis quand', 'depuis_quand');
    add('Adresse', 'adresse');
    add('Disponibilité rappel', 'disponibilite_rappel', 'disponibilites');
  }

  const details = fieldValue(data, 'demande', 'probleme', 'preferences');
  if (details && !lines.some((l) => l.includes(details))) {
    lines.push(`Détails : ${details}`);
  }

  lines.push(`Prochaine action recommandée : ${recommendNextAction(workflow, data)}`);
  return lines.join('\n');
}

function formatOwnerSummaryHtml(workflow, data, fields, callerPhone) {
  const text = formatOwnerSummaryText(workflow, data, fields, callerPhone);
  const rows = text.split('\n').filter(Boolean).map((line) => {
    const idx = line.indexOf(' : ');
    if (idx === -1) {
      return `<tr><td colspan="2" style="padding:8px 0;font-weight:700">${line.replace(/</g, '&lt;')}</td></tr>`;
    }
    const label = line.slice(0, idx);
    const val = line.slice(idx + 3);
    return `<tr><td style="padding:6px 12px 6px 0;font-weight:600;vertical-align:top;white-space:nowrap">${label.replace(/</g, '&lt;')}</td><td style="padding:6px 0">${val.replace(/</g, '&lt;')}</td></tr>`;
  }).join('');
  return `<table style="border-collapse:collapse;font-size:14px;line-height:1.5">${rows}</table>`;
}

function workflowLabel(workflow) {
  if (workflow === WORKFLOW_APPOINTMENT) return 'Prise de rendez-vous';
  return 'Service terrain';
}

function isQualificationComplete(workflow, data, fields) {
  const enabled = (fields || []).filter((f) => f.enabled && f.required);
  return enabled.every((f) => fieldValue(data, f.key));
}

module.exports = {
  WORKFLOW_APPOINTMENT,
  WORKFLOW_FIELD_SERVICE,
  detectQualificationWorkflow,
  defaultFieldsForWorkflow,
  mergeQualificationFields,
  missedCallSmsForWorkflow,
  formatWorkflowPromptBlock,
  recommendNextAction,
  formatOwnerSummaryText,
  formatOwnerSummaryHtml,
  workflowLabel,
  isQualificationComplete,
  FIELD_DEFINITIONS,
};
