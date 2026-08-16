const { getAdmin, isDbConfigured } = require('../db');
const { encryptSecret, decryptSecret } = require('./crypto');
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
    return '\n\nAGENDA RÉEL (calendrier connecté)\nLe calendrier est connecté, mais les plages n\'ont pas chargé à temps. Dis que tu as accès à l\'agenda. Propose selon les HORAIRES, sans inventer de conflit. Ne dis PAS que le rendez-vous est confirmé.\n';
  }
  if (!result.connected) return '';
  if (result.error) {
    return '\n\nAGENDA RÉEL\nLe calendrier du commerce est temporairement indisponible. Ne confirme aucune heure précise — note la demande. Si on te demande si le calendrier est connecté, dis que la connexion existe mais que l\'agenda ne répond pas en ce moment.\n';
  }
  if (!result.slots.length) {
    return '\n\nAGENDA RÉEL (calendrier Google/Outlook CONNECTÉ)\nAucune plage libre dans les 7 prochains jours selon l\'agenda. Propose de noter les disponibilités pour un rappel humain. N\'invente aucune heure. Si on te demande si tu as accès au calendrier : oui. Ne dis PAS que le rendez-vous est confirmé.\n';
  }
  const lines = result.slots.map((s) => `- ${formatSlotFr(s.start, s.end)}`);
  return `\n\nAGENDA RÉEL (calendrier Google/Outlook CONNECTÉ)
Si on te demande si tu as accès au calendrier : OUI.
Ces plages sont les SEULES heures libres. Une heure absente de cette liste est PRISE.
- Si le client demande une heure QUI EST dans la liste : dis que le créneau est libre. Ne dis PAS que c'est confirmé, inscrit à l'agenda, ou réservé — le système confirmera seulement après création de l'événement.
- Si le client demande une heure QUI N'EST PAS dans la liste : dis que c'est déjà pris et propose 2–3 plages de la liste.
Ne dis JAMAIS « c'est confirmé » ou « c'est dans l'agenda » dans ce message.
${lines.join('\n')}\n`;
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

const BOOKING_CLAIM_RE = /c['’]?est confirmé|inscrit à l['’]agenda|noté au calendrier|rendez-vous est (pris|confirmé)|je confirme (votre |le )?rendez-vous|c['’]est (bien )?réservé|je viens de (le )?réserver/i;

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

/** Le SMS/chat ne doit dire « confirmé » que si l'événement agenda existe vraiment. */
function applyCalendarConfirmationToReply({
  reply,
  tenant,
  booking,
  userMessage,
  aiReply,
  bookingAction,
  durationMin,
}) {
  const text = String(reply || '').trim();
  const biz = (tenant && tenant.business_name) || 'notre commerce';
  const claimed = BOOKING_CLAIM_RE.test(text);
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

  if (booking && booking.ok && booking.slot) {
    const when = formatSlotFr(booking.slot.start, booking.slot.end);
    const stamp = `C'est confirmé dans l'agenda : ${when}.`;
    let out = text;
    if (!/confirmé dans l'agenda/i.test(out)) {
      out = `${out} ${stamp}`.trim();
    }
    return { reply: out, calendarConfirmed: true };
  }

  if (booking && booking.skipped === 'already' && canCreate) {
    return { reply: text, calendarConfirmed: true };
  }

  const skippedNoCreate = (bookingAction && !bookingAction.create)
    || (booking && ['external_link', 'human', 'ask_service', 'send_link'].includes(booking.skipped));
  if (skippedNoCreate) {
    let out = text;
    if (claimed) {
      out = out
        .replace(/[^.!?\n]*\b(confirmé|inscrit à l['’]agenda|noté au calendrier|réservé|je confirme)[^.!?\n]*[.!?]?/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    return { reply: out || text, calendarConfirmed: false };
  }

  if (!extracted && !claimed) {
    return { reply: text, calendarConfirmed: false };
  }

  const note = `${biz} vous confirmera ce rendez-vous.`;
  let out = text;
  if (claimed) {
    out = out
      .replace(/[^.!?\n]*\b(confirmé|inscrit à l['’]agenda|noté au calendrier|réservé|je confirme)[^.!?\n]*[.!?]?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (!/vous confirmera/i.test(out)) {
    out = `${out} ${note}`.trim();
  }
  return { reply: out, calendarConfirmed: false };
}

async function disconnect(tenantId, provider) {
  if (!PROVIDERS.includes(provider)) throw new Error('Fournisseur inconnu');
  const row = await loadConnection(tenantId, provider);
  if (row) {
    const token = decryptSecret(row.refresh_token_enc) || decryptSecret(row.access_token_enc);
    await revokeToken(provider, token);
    await getAdmin()
      .from('tenant_calendar_connections')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('provider', provider);
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
  providerConfigured,
  settingsRedirect,
  verifyState,
  buildEventPayload,
  assertOAuthCallbackSession,
  oauthCookieHeader,
};
