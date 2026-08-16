const { getAdmin, isDbConfigured } = require('../db');
const { encryptSecret, decryptSecret, tryDecryptSecret } = require('./crypto');
const {
  PROVIDERS,
  TZ,
  googleConfigured,
  microsoftConfigured,
  providerConfigured,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  fetchAccountEmail,
  revokeToken,
  verifyState,
  settingsRedirect,
  oauthCookieHeader,
  assertOAuthCallbackSession,
} = require('./oauth');
const google = require('./google');
const microsoft = require('./microsoft');
const {
  looksLikeScheduling,
  buildOpenSlots,
  subtractBusy,
  formatSlotFr,
  extractAcceptedSlot,
  assistantRejectedSlot,
  stripCalendarClaims,
  MAX_SLOTS,
  SLOT_MINUTES,
} = require('./slots');
const {
  buildCalendarEventSummary,
  planCalendarBooking,
} = require('../service-workflows');

function configuredFlags() {
  return {
    google: googleConfigured(),
    microsoft: microsoftConfigured(),
  };
}

function publicStatus(row) {
  if (!row) {
    return { connected: false, status: 'disconnected', email: null, error: null };
  }
  const ok = row.status === 'connected' && !!row.refresh_token_enc;
  return {
    connected: ok,
    status: ok ? 'connected' : (row.status || 'error'),
    email: row.account_email || null,
    error: row.last_error || null,
    connected_at: row.connected_at || null,
  };
}

async function listConnections(tenantId) {
  const empty = {
    google: publicStatus(null),
    microsoft: publicStatus(null),
    configured: configuredFlags(),
  };
  if (!isDbConfigured() || !tenantId) return empty;
  const { data, error } = await getAdmin()
    .from('tenant_calendar_connections')
    .select('provider, account_email, status, last_error, connected_at, refresh_token_enc')
    .eq('tenant_id', tenantId);
  if (error) {
    console.warn('listConnections', error.message);
    return empty;
  }
  const out = { ...empty };
  for (const row of data || []) {
    if (PROVIDERS.includes(row.provider)) out[row.provider] = publicStatus(row);
  }
  return out;
}

async function loadConnection(tenantId, provider) {
  if (!isDbConfigured() || !tenantId || !provider) return null;
  const { data } = await getAdmin()
    .from('tenant_calendar_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
    .maybeSingle();
  return data || null;
}

async function markConnectionError(tenantId, provider, err) {
  const expired = err && err.code === 'expired';
  await getAdmin().from('tenant_calendar_connections').update({
    status: expired ? 'expired' : 'error',
    last_error: String(err.message || err).slice(0, 300),
    updated_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId).eq('provider', provider);
}

async function saveTokens(tenantId, provider, tokens, extra = {}) {
  const expiresIn = Number(tokens.expires_in || 3600);
  const patch = {
    tenant_id: tenantId,
    provider,
    access_token_enc: encryptSecret(tokens.access_token),
    token_expires_at: new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000).toISOString(),
    status: 'connected',
    last_error: null,
    updated_at: new Date().toISOString(),
    ...extra,
  };
  if (tokens.refresh_token) patch.refresh_token_enc = encryptSecret(tokens.refresh_token);
  if (tokens.scope) patch.scopes = tokens.scope;
  await getAdmin().from('tenant_calendar_connections').upsert(patch, {
    onConflict: 'tenant_id,provider',
  });
}

async function finishOAuth({ state, code, error, errorDescription, event }) {
  if (error) {
    return settingsRedirect({
      calendar: 'error',
      reason: error === 'access_denied' ? 'denied' : 'oauth',
    });
  }
  const { st } = await assertOAuthCallbackSession(state, event);
  if (!code) throw new Error('Code OAuth manquant');
  const tokens = await exchangeCode(st.p, code, st.v);
  const email = await fetchAccountEmail(st.p, tokens.access_token).catch(() => null);
  await saveTokens(st.t, st.p, tokens, {
    account_email: email,
    calendar_id: st.p === 'google' ? 'primary' : 'default',
    connected_at: new Date().toISOString(),
  });
  return settingsRedirect({ calendar: 'ok', provider: st.p });
}

async function getValidAccessToken(row) {
  if (!row) throw new Error('Calendrier non connecté');
  const refresh = decryptSecret(row.refresh_token_enc);
  const access = decryptSecret(row.access_token_enc);
  const exp = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  if (access && exp > Date.now() + 60 * 1000) return access;

  const tokens = await refreshAccessToken(row.provider, refresh);
  await saveTokens(row.tenant_id, row.provider, {
    ...tokens,
    refresh_token: tokens.refresh_token || refresh,
  });
  return tokens.access_token;
}

async function connectedRows(tenantId) {
  if (!isDbConfigured() || !tenantId) return [];
  const { data } = await getAdmin()
    .from('tenant_calendar_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'connected');
  return (data || []).filter((r) => r.refresh_token_enc);
}

async function collectBusy(tenantId, timeMin, timeMax) {
  const rows = await connectedRows(tenantId);
  const busy = [];
  const errors = [];
  for (const row of rows) {
    try {
      const token = await getValidAccessToken(row);
      if (row.provider === 'google') {
        const items = await google.listBusy(token, timeMin, timeMax, row.calendar_id || 'primary');
        busy.push(...items);
      } else if (row.provider === 'microsoft') {
        const items = await microsoft.listBusy(token, timeMin, timeMax);
        busy.push(...items);
      }
    } catch (e) {
      await markConnectionError(row.tenant_id, row.provider, e);
      errors.push({ provider: row.provider, error: e.message });
    }
  }
  return { busy, errors, connected: rows.length };
}

async function getAvailableSlots(tenantId, hours, durationMin) {
  const rows = await connectedRows(tenantId);
  if (!rows.length) return { connected: false, slots: [], error: null };

  const open = buildOpenSlots(hours, new Date(), durationMin || SLOT_MINUTES);
  if (!open.length) return { connected: true, slots: [], error: null };

  const timeMin = open[0].start;
  const timeMax = open[open.length - 1].end;
  const { busy, errors } = await collectBusy(tenantId, timeMin, timeMax);
  if (errors.length && errors.length === rows.length) {
    return { connected: true, slots: [], error: errors[0].error };
  }
  const free = subtractBusy(open, busy).slice(0, MAX_SLOTS);
  return { connected: true, slots: free, error: null };
}

const offeredSlotsCache = new Map();

function rememberOfferedSlots(tenantId, slots) {
  if (!tenantId) return;
  offeredSlotsCache.set(String(tenantId), {
    slots: Array.isArray(slots) ? slots.slice(0, MAX_SLOTS) : [],
    at: Date.now(),
  });
}

function peekOfferedSlots(tenantId) {
  const hit = offeredSlotsCache.get(String(tenantId || ''));
  if (!hit || Date.now() - hit.at > 20000) return [];
  return hit.slots || [];
}

function formatOfferedSlotsLine(slots) {
  const top = (slots || []).slice(0, 3).map((s) => formatSlotFr(s.start, s.end));
  if (!top.length) return '';
  return `Voici les prochaines plages libres : ${top.join(' · ')}.`;
}

async function hasConnectedCalendar(tenantId) {
  const rows = await connectedRows(tenantId);
  return rows.length > 0;
}

async function formatAvailabilityForPrompt(tenantId, dossier, durationMin) {
  const hours = dossier && dossier.heures_ouverture;
  const minutes = durationMin || SLOT_MINUTES;
  const result = await Promise.race([
    getAvailableSlots(tenantId, hours, minutes),
    new Promise((resolve) => setTimeout(() => resolve({ connected: false, timeout: true }), 6000)),
  ]);
  if (!result || result.timeout) {
    const connected = await hasConnectedCalendar(tenantId).catch(() => false);
    if (!connected) return '';
    rememberOfferedSlots(tenantId, []);
    return '\n\nAGENDA RÉEL (calendrier connecté)\nLe calendrier est connecté. N\'invente aucune heure. Ne dis PAS si un créneau est libre, pris ou confirmé — le système l\'ajoutera.\n';
  }
  if (!result.connected) return '';
  rememberOfferedSlots(tenantId, result.slots || []);
  if (result.error) {
    return '\n\nAGENDA RÉEL\nLe calendrier du commerce est temporairement indisponible. N\'invente aucune heure et ne confirme rien. Le système gère l\'agenda.\n';
  }
  if (!result.slots.length) {
    return '\n\nAGENDA RÉEL (calendrier Google/Outlook CONNECTÉ)\nL\'agenda est connecté. N\'invente aucune heure. Ne dis PAS que c\'est confirmé. Le système indiquera s\'il n\'y a pas de plage.\n';
  }
  return `\n\nAGENDA RÉEL (calendrier Google/Outlook CONNECTÉ)
Si on te demande si tu as accès au calendrier : OUI.
N'invente AUCUNE heure. Ne liste AUCUNE plage. Ne dis JAMAIS qu'une heure est libre, prise, confirmée ou réservée.
Accuse réception, identifie le service, pose les questions manquantes (nom, etc.).
Le système ajoutera lui-même les disponibilités et la confirmation.\n`;
}

function slotIsFree(slot, busy) {
  const a = new Date(slot.start).getTime();
  const b = new Date(slot.end).getTime();
  return !(busy || []).some((r) => {
    const s = new Date(r.start).getTime();
    const e = new Date(r.end).getTime();
    return a < e && b > s;
  });
}

function buildEventPayload(tenant, callerPhone, qualificationData, slot, action) {
  const q = qualificationData || {};
  const name = q.nom || 'Client';
  const service = (action && action.service && action.service.nom)
    || q.service_souhaite || q.probleme || q.demande || '';
  const summary = buildCalendarEventSummary({
    booking_mode: action && action.booking_mode,
    serviceName: service,
    prospectName: name,
    businessName: tenant.business_name,
  });
  const lines = [
    `Nom: ${name}`,
    `Téléphone: ${q.telephone || callerPhone}`,
    service ? `Service: ${service}` : null,
    action && action.booking_mode === 'estimate' ? 'Type: visite d\'estimation' : null,
    q.preferences ? `Préférences: ${q.preferences}` : null,
    q.adresse ? `Adresse: ${q.adresse}` : null,
    q.disponibilites ? `Disponibilités: ${q.disponibilites}` : null,
    q.creneau_confirme ? `Créneau: ${q.creneau_confirme}` : null,
    '',
    'Créé automatiquement par NoviaAI.',
  ].filter((x) => x !== null);
  return {
    summary: summary.slice(0, 200),
    description: lines.join('\n'),
    start: slot.start,
    end: slot.end,
  };
}

async function alreadyBooked(tenantId, callerPhone, startsAt) {
  const { data } = await getAdmin()
    .from('tenant_calendar_bookings')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('caller_phone', callerPhone)
    .eq('starts_at', startsAt)
    .maybeSingle();
  return !!data;
}

async function createOnProvider(row, event) {
  const token = await getValidAccessToken(row);
  if (row.provider === 'google') {
    return google.createEvent(token, event, row.calendar_id || 'primary');
  }
  return microsoft.createEvent(token, event);
}

async function maybeCreateCalendarEvent({
  tenant,
  callerPhone,
  userMessage,
  aiReply,
  qualificationData,
  history,
  bookingAction,
  shouldAbort,
}) {
  const aborted = () => typeof shouldAbort === 'function' && shouldAbort();
  if (!tenant?.id || !callerPhone) return null;
  if (aborted()) return { skipped: 'timeout' };

  const plan = planCalendarBooking({
    bookingAction,
    services: tenant.services,
    userMessage,
    qualificationData,
    calendarConnected: true,
    reservationLinks: tenant.reservation_links,
    reservationUrl: tenant.reservation_url,
    tenant,
  });
  if (!plan.create) {
    return { skipped: plan.skipped, action: plan.action };
  }
  const action = plan.action;

  const rows = await connectedRows(tenant.id);
  if (!rows.length) return null;

  const durationMin = action.durationMin || action.duration_minutes || SLOT_MINUTES;
  const blobParts = {
    userMessage,
    aiReply,
    qualificationData,
    history,
    hours: tenant.hours,
    durationMin,
  };
  const slot = extractAcceptedSlot(blobParts);
  if (!slot) return null;
  if (assistantRejectedSlot(aiReply)) {
    return { skipped: 'ai_rejected', action, slot };
  }
  if (aborted()) return { skipped: 'timeout' };
  if (await alreadyBooked(tenant.id, callerPhone, slot.start)) return { skipped: 'already' };

  const { busy, errors } = await collectBusy(tenant.id, slot.start, slot.end);
  if (aborted()) return { skipped: 'timeout' };
  if (errors.length && errors.length === rows.length) {
    return { skipped: 'unavailable', error: errors[0].error };
  }
  if (!slotIsFree(slot, busy)) {
    return { skipped: 'conflict' };
  }

  const event = buildEventPayload(tenant, callerPhone, qualificationData, slot, action);
  let created = null;
  let used = null;
  for (const row of rows) {
    if (aborted()) return { skipped: 'timeout' };
    try {
      created = await createOnProvider(row, event);
      used = row.provider;
      break;
    } catch (e) {
      await markConnectionError(row.tenant_id, row.provider, e);
    }
  }
  if (!created) return { skipped: 'create_failed' };

  const { error: bookErr } = await getAdmin().from('tenant_calendar_bookings').insert({
    tenant_id: tenant.id,
    caller_phone: callerPhone,
    starts_at: slot.start,
    ends_at: slot.end,
    provider: used,
    external_event_id: created.id,
  });
  if (bookErr && !/duplicate|unique/i.test(bookErr.message || '')) {
    console.warn('calendar booking log', bookErr.message);
  }
  return { ok: true, provider: used, eventId: created.id, slot, action };
}

async function maybeCreateCalendarEventWithBudget(opts, ms) {
  const budget = Number(ms) > 0 ? Number(ms) : 4000;
  let aborted = false;
  const timer = setTimeout(() => { aborted = true; }, budget);
  try {
    const raced = await Promise.race([
      maybeCreateCalendarEvent({
        ...opts,
        shouldAbort: () => aborted || (typeof opts.shouldAbort === 'function' && opts.shouldAbort()),
      }).then((value) => ({ finished: true, value })),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), budget)),
    ]);
    if (raced && raced.timeout) return { skipped: 'timeout' };
    return raced.value;
  } finally {
    clearTimeout(timer);
  }
}

/** Le SMS/chat ne doit dire « confirmé » / « pris » / des plages que d'après l'agenda réel. */
function applyCalendarConfirmationToReply({
  reply,
  tenant,
  booking,
  userMessage,
  aiReply,
  bookingAction,
  durationMin,
  offeredSlots,
}) {
  const text = String(reply || '').trim();
  const biz = (tenant && tenant.business_name) || 'notre commerce';
  const minutes = durationMin
    || (bookingAction && (bookingAction.durationMin || bookingAction.duration_minutes))
    || SLOT_MINUTES;
  const canCreate = bookingAction ? !!bookingAction.create : true;
  const extracted = canCreate && !!extractAcceptedSlot({
    userMessage,
    aiReply: aiReply || text,
    hours: tenant && tenant.hours,
    durationMin: minutes,
  });
  let out = stripCalendarClaims(text);
  if (text && !out) out = 'Bien reçu.';
  const slots = Array.isArray(offeredSlots) ? offeredSlots : peekOfferedSlots(tenant && tenant.id);
  const slotLine = formatOfferedSlotsLine(slots);

  if (booking && booking.ok && booking.slot) {
    const when = formatSlotFr(booking.slot.start, booking.slot.end);
    const stamp = `C'est confirmé dans l'agenda : ${when}.`;
    return { reply: [out, stamp].filter(Boolean).join(' ').trim(), calendarConfirmed: true };
  }

  if (booking && booking.skipped === 'already' && canCreate) {
    const fact = 'Ce rendez-vous est déjà dans l\'agenda.';
    if (!/déjà dans l['’]agenda/i.test(out)) {
      out = [out, fact].filter(Boolean).join(' ').trim();
    }
    return { reply: out || fact, calendarConfirmed: true };
  }

  const skippedNoCreate = (bookingAction && !bookingAction.create)
    || (booking && ['external_link', 'human', 'ask_service', 'send_link'].includes(booking.skipped));
  if (skippedNoCreate) {
    return { reply: out || text, calendarConfirmed: false };
  }

  if (booking && booking.skipped === 'timeout') {
    return { reply: out || text, calendarConfirmed: false };
  }

  if (booking && ['create_failed', 'unavailable', 'error'].includes(booking.skipped)) {
    const note = `${biz} vous confirmera ce rendez-vous.`;
    if (!/vous confirmera/i.test(out)) {
      out = [out, note].filter(Boolean).join(' ').trim();
    }
    return { reply: out || note, calendarConfirmed: false };
  }

  if (booking && (booking.skipped === 'conflict' || booking.skipped === 'ai_rejected')) {
    const fact = slotLine
      ? `Cette heure n'est pas libre. ${slotLine}`
      : 'Cette heure n\'est pas libre. Indiquez-moi une autre plage.';
    return { reply: [out, fact].filter(Boolean).join(' ').trim(), calendarConfirmed: false };
  }

  if (extracted && canCreate) {
    const note = `${biz} vous confirmera ce rendez-vous.`;
    if (!/vous confirmera/i.test(out)) {
      out = [out, note].filter(Boolean).join(' ').trim();
    }
    return { reply: out, calendarConfirmed: false };
  }

  if (canCreate && looksLikeScheduling(userMessage) && slotLine) {
    return { reply: [out, slotLine].filter(Boolean).join(' ').trim(), calendarConfirmed: false };
  }

  return { reply: out || text, calendarConfirmed: false };
}

async function disconnect(tenantId, provider) {
  if (!PROVIDERS.includes(provider)) throw new Error('Fournisseur inconnu');
  const row = await loadConnection(tenantId, provider);
  if (row) {
    const token = tryDecryptSecret(row.refresh_token_enc) || tryDecryptSecret(row.access_token_enc);
    try {
      await revokeToken(provider, token);
    } catch (e) {
      console.warn('calendar revoke skipped', provider, e && e.message);
    }
    const { error } = await getAdmin()
      .from('tenant_calendar_connections')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('provider', provider);
    if (error) throw new Error(error.message || 'Déconnexion impossible');
  }
  return { ok: true };
}

async function startConnect(tenantId, provider, { userId } = {}) {
  if (!providerConfigured(provider)) {
    throw new Error(provider === 'google'
      ? 'Google Calendar n\'est pas encore configuré.'
      : 'Microsoft Calendar n\'est pas encore configuré.');
  }
  if (!userId) throw new Error('Session NoviaAI requise');
  const { url, cookie } = buildAuthUrl(tenantId, provider, { userId });
  return { url, cookie };
}

module.exports = {
  TZ,
  configuredFlags,
  listConnections,
  startConnect,
  finishOAuth,
  disconnect,
  getAvailableSlots,
  hasConnectedCalendar,
  formatAvailabilityForPrompt,
  maybeCreateCalendarEvent,
  maybeCreateCalendarEventWithBudget,
  applyCalendarConfirmationToReply,
  looksLikeScheduling,
  stripCalendarClaims,
  providerConfigured,
  settingsRedirect,
  verifyState,
  buildEventPayload,
  assertOAuthCallbackSession,
  oauthCookieHeader,
};
