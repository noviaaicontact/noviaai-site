/**
 * Workflow d'action par service — générique, sans logique d'industrie.
 *
 * booking_mode:
 *   calendar      → plages Google/Outlook, durée du service
 *   estimate      → même agenda, visite d'estimation
 *   external_link → coller l'URL (Fresha, Calendly, Jobber…)
 *   human         → ne pas réserver, l'équipe rappelle
 */

const BOOKING_MODES = ['calendar', 'external_link', 'estimate', 'human'];
const DEFAULT_DURATION_MIN = 30;
const MIN_DURATION_MIN = 15;
const MAX_DURATION_MIN = 240;

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function clampDuration(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_DURATION_MIN;
  return Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, n));
}

function firstReservationUrl(opts = {}) {
  const links = opts.reservationLinks || opts.reservation_links || [];
  if (Array.isArray(links)) {
    const hit = links.find((l) => l && String(l.url || '').trim());
    if (hit) return String(hit.url).trim();
  }
  return String(opts.reservationUrl || opts.reservation_url || '').trim();
}

function inferredFallbackMode(opts = {}) {
  if (opts.calendarConnected) return 'calendar';
  if (firstReservationUrl(opts)) return 'external_link';
  return 'human';
}

function normalizeService(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const nom = String(raw.nom || raw.description_courte || '').trim();
  if (!nom) return null;
  const prix = String(raw.prix || '').trim();
  const explicit = BOOKING_MODES.includes(raw.booking_mode) ? raw.booking_mode : '';
  const fill = !!opts.fillDefaults;
  const booking_mode = explicit || (fill ? (opts.fallbackMode || 'calendar') : '');
  const out = {
    nom,
    prix,
    description_courte: String(raw.description_courte || nom).trim() || nom,
  };
  if (booking_mode) out.booking_mode = booking_mode;
  if (booking_mode === 'calendar' || booking_mode === 'estimate' || raw.duration_minutes != null) {
    out.duration_minutes = clampDuration(raw.duration_minutes);
  }
  const url = String(raw.booking_url || '').trim();
  if (booking_mode === 'external_link') {
    out.booking_url = url || String(opts.fallbackUrl || '').trim();
  } else if (url) {
    out.booking_url = url;
  }
  return out;
}

function normalizeServices(list, opts = {}) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => normalizeService(item, opts))
    .filter(Boolean)
    .slice(0, 80);
}

function scoreServiceMatch(nom, blob) {
  const name = normalizeText(nom);
  if (!name || name.length < 3) return 0;
  if (blob.includes(name)) return name.length + 100;
  const tokens = name.split(' ').filter((t) => t.length >= 4);
  if (!tokens.length) return 0;
  const hit = tokens.filter((t) => blob.includes(t));
  if (!hit.length) return 0;
  if (hit.length === tokens.length) return name.length + 50;
  return hit.join('').length;
}

function matchService(services, texts) {
  const blob = normalizeText([].concat(texts || []).filter(Boolean).join(' '));
  if (!blob) return null;
  const list = Array.isArray(services) ? services : [];
  let best = null;
  let bestScore = 0;
  for (const raw of list) {
    const s = normalizeService(raw, { fillDefaults: false });
    if (!s) continue;
    const score = scoreServiceMatch(s.nom, blob);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

function finalizeAction({
  service = null,
  matched = false,
  inferred = false,
  booking_mode = null,
  booking_url = '',
}) {
  const mode = BOOKING_MODES.includes(booking_mode) ? booking_mode : null;
  const duration_minutes = clampDuration(service && service.duration_minutes);
  const create = !!(matched && shouldCreateCalendarEvent(mode));
  let action = 'ask_service';
  if (create) action = 'create_calendar';
  else if (mode === 'external_link') action = 'send_link';
  else if (mode === 'human') action = 'human';
  return {
    matched: !!matched,
    inferred: !!inferred,
    service: service && service.nom ? service : null,
    booking_mode: mode,
    duration_minutes,
    durationMin: duration_minutes,
    booking_url: String(booking_url || (service && service.booking_url) || '').trim(),
    create,
    action,
  };
}

function qualificationMatchTexts(opts = {}) {
  const q = opts.qualificationData || {};
  return [q.service_souhaite, q.probleme, q.demande].filter(Boolean);
}

function unmatchedDecision(services, opts = {}) {
  const fallbackUrl = firstReservationUrl(opts);
  const list = Array.isArray(services) ? services.map((s) => normalizeService(s, { fillDefaults: false })).filter(Boolean) : [];
  const explicit = list.filter((s) => s.booking_mode);
  const modes = [...new Set(explicit.map((s) => s.booking_mode))];
  const hasCalOrEstimate = explicit.some((s) => shouldCreateCalendarEvent(s.booking_mode));

  if (list.length === 1) {
    const only = list[0];
    const mode = only.booking_mode || inferredFallbackMode(opts);
    return finalizeAction({
      service: { ...only, booking_mode: mode, duration_minutes: only.duration_minutes || DEFAULT_DURATION_MIN },
      matched: true,
      inferred: !only.booking_mode,
      booking_mode: mode,
      booking_url: only.booking_url || fallbackUrl,
    });
  }

  if (!hasCalOrEstimate) {
    const linkSvc = explicit.find((s) => s.booking_mode === 'external_link');
    const url = (linkSvc && linkSvc.booking_url) || fallbackUrl;
    const onlyLink = modes.length === 0 || (modes.length === 1 && modes[0] === 'external_link');
    if (url && onlyLink) {
      return finalizeAction({
        service: linkSvc || null,
        matched: false,
        inferred: true,
        booking_mode: 'external_link',
        booking_url: url,
      });
    }
    if (modes.length === 1 && modes[0] === 'human') {
      return finalizeAction({
        service: explicit[0] || null,
        matched: false,
        inferred: true,
        booking_mode: 'human',
      });
    }
    if (!explicit.length && !opts.calendarConnected && !url) {
      return finalizeAction({ matched: false, inferred: true, booking_mode: 'human' });
    }
  }

  return finalizeAction({ matched: false, booking_mode: null });
}

function resolveBookingAction(opts = {}) {
  const fallbackMode = inferredFallbackMode(opts);
  const fallbackUrl = firstReservationUrl(opts);
  const services = opts.services
    || (opts.tenant && opts.tenant.services)
    || [];
  // Message courant d'abord — jamais l'historique ni la réponse IA.
  const matched = matchService(services, [opts.userMessage])
    || matchService(services, qualificationMatchTexts(opts));

  if (matched) {
    const mode = matched.booking_mode || fallbackMode;
    return finalizeAction({
      service: {
        ...matched,
        booking_mode: mode,
        duration_minutes: matched.duration_minutes || DEFAULT_DURATION_MIN,
        booking_url: matched.booking_url || fallbackUrl,
      },
      matched: true,
      inferred: !matched.booking_mode,
      booking_mode: mode,
      booking_url: matched.booking_url || fallbackUrl,
    });
  }

  return unmatchedDecision(services, opts);
}

function shouldCreateCalendarEvent(mode) {
  return mode === 'calendar' || mode === 'estimate';
}

function planCalendarBooking(opts = {}) {
  const action = opts.bookingAction != null ? opts.bookingAction : resolveBookingAction(opts);
  const q = opts.qualificationData || {};
  const serviceName = (action.service && action.service.nom)
    || q.service_souhaite || q.probleme || q.demande || '';
  const eventSummary = action.create
    ? buildCalendarEventSummary({
      booking_mode: action.booking_mode,
      serviceName,
      prospectName: q.nom,
      businessName: opts.businessName || (opts.tenant && opts.tenant.business_name),
    })
    : null;
  return {
    create: !!action.create,
    skipped: action.create ? null : (action.booking_mode || action.action),
    action,
    durationMin: action.duration_minutes || action.durationMin || DEFAULT_DURATION_MIN,
    eventSummary,
  };
}

function buildCalendarEventSummary({ booking_mode, serviceName, prospectName, businessName }) {
  const name = String(prospectName || 'Client').trim() || 'Client';
  const service = String(serviceName || '').trim();
  if (booking_mode === 'estimate') {
    return `Estimation — ${service || 'service'} — ${name}`.slice(0, 200);
  }
  if (service) return `RDV — ${name} — ${service}`.slice(0, 200);
  return `RDV — ${name} — ${businessName || 'Rendez-vous'}`.slice(0, 200);
}

const MODE_LABELS = {
  calendar: 'agenda Google',
  estimate: "visite d'estimation (agenda)",
  external_link: 'lien externe',
  human: 'rappel humain',
};

function formatServicesForPrompt(services) {
  const list = Array.isArray(services) ? services : [];
  if (!list.length) {
    return '(aucun service saisi manuellement — cherche dans les EXTRAITS PERTINENTS / synthèse du site)';
  }
  return list.map((raw) => {
    const s = normalizeService(raw, { fillDefaults: false });
    if (!s) return '';
    let line = `- ${s.nom}`;
    if (s.prix) line += ` : ${s.prix}`;
    if (s.booking_mode === 'calendar') {
      line += ` [ACTION: ${MODE_LABELS.calendar}, durée ${s.duration_minutes || DEFAULT_DURATION_MIN} min — propose des plages, ne confirme pas]`;
    } else if (s.booking_mode === 'estimate') {
      line += ` [ACTION: ${MODE_LABELS.estimate}, durée ${s.duration_minutes || DEFAULT_DURATION_MIN} min — propose des plages, ne confirme pas]`;
    } else if (s.booking_mode === 'external_link') {
      const url = s.booking_url || '';
      line += url
        ? ` [ACTION: envoyer ce lien exact: ${url} — ne pas créer d'événement agenda]`
        : ` [ACTION: ${MODE_LABELS.external_link} — coller l'URL du service, ne pas créer d'événement agenda]`;
    } else if (s.booking_mode === 'human') {
      line += ` [ACTION: ${MODE_LABELS.human} — ne pas réserver, prendre les infos, l'équipe rappelle]`;
    }
    return line;
  }).filter(Boolean).join('\n');
}

module.exports = {
  BOOKING_MODES,
  DEFAULT_DURATION_MIN,
  MIN_DURATION_MIN,
  MAX_DURATION_MIN,
  clampDuration,
  normalizeService,
  normalizeServices,
  matchService,
  resolveBookingAction,
  shouldCreateCalendarEvent,
  planCalendarBooking,
  buildCalendarEventSummary,
  formatServicesForPrompt,
  inferredFallbackMode,
};
