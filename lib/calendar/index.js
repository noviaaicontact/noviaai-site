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
} = require('./oauth');
const google = require('./google');
const microsoft = require('./microsoft');
const {
  looksLikeScheduling,
  buildOpenSlots,
  subtractBusy,
  formatSlotFr,
  parseAcceptedSlot,
  MAX_SLOTS,
} = require('./slots');

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

async function finishOAuth({ state, code, error, errorDescription }) {
  if (error) {
    return settingsRedirect({
      calendar: 'error',
      reason: error === 'access_denied' ? 'denied' : 'oauth',
    });
  }
  const st = verifyState(state);
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

async function getAvailableSlots(tenantId, hours) {
  const rows = await connectedRows(tenantId);
  if (!rows.length) return { connected: false, slots: [], error: null };

  const open = buildOpenSlots(hours);
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

async function formatAvailabilityForPrompt(tenantId, dossier) {
  const hours = dossier && dossier.heures_ouverture;
  const result = await Promise.race([
    getAvailableSlots(tenantId, hours),
    new Promise((resolve) => setTimeout(() => resolve({ connected: false, timeout: true }), 2500)),
  ]);
  if (!result || result.timeout || !result.connected) return '';
  if (result.error) {
    return '\n\nAGENDA RÉEL\nLe calendrier du commerce est temporairement indisponible. Ne confirme aucune heure précise — note la demande.\n';
  }
  if (!result.slots.length) {
    return '\n\nAGENDA RÉEL (calendrier connecté)\nAucune plage libre dans les 7 prochains jours selon l\'agenda. Propose de noter les disponibilités pour un rappel humain. N\'invente aucune heure.\n';
  }
  const lines = result.slots.map((s) => `- ${formatSlotFr(s.start, s.end)}`);
  return `\n\nAGENDA RÉEL (calendrier connecté — priorité sur « ne jamais confirmer »)\nPropose UNIQUEMENT ces plages réellement libres. Si le client en choisit une, confirme-la clairement (jour + heure). N'invente aucune autre heure.\n${lines.join('\n')}\n`;
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

function buildEventPayload(tenant, callerPhone, qualificationData, slot) {
  const q = qualificationData || {};
  const name = q.nom || 'Client';
  const service = q.service_souhaite || q.probleme || q.demande || '';
  const biz = tenant.business_name || 'Rendez-vous';
  const summary = service
    ? `RDV — ${name} — ${service}`
    : `RDV — ${name} — ${biz}`;
  const lines = [
    `Nom: ${name}`,
    `Téléphone: ${q.telephone || callerPhone}`,
    service ? `Service: ${service}` : null,
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
}) {
  if (!tenant?.id || !callerPhone) return null;
  const rows = await connectedRows(tenant.id);
  if (!rows.length) return null;

  const blob = [
    qualificationData?.creneau_confirme,
    qualificationData?.disponibilites,
    userMessage,
    aiReply,
    ...(history || []).slice(-4).map((m) => m.content),
  ].filter(Boolean).join('\n');

  const slot = parseAcceptedSlot(blob, tenant.hours);
  if (!slot) return null;
  if (await alreadyBooked(tenant.id, callerPhone, slot.start)) return { skipped: 'already' };

  const { busy, errors } = await collectBusy(tenant.id, slot.start, slot.end);
  if (errors.length && errors.length === rows.length) {
    return { skipped: 'unavailable', error: errors[0].error };
  }
  if (!slotIsFree(slot, busy)) {
    return { skipped: 'conflict' };
  }

  const event = buildEventPayload(tenant, callerPhone, qualificationData, slot);
  let created = null;
  let used = null;
  for (const row of rows) {
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
  return { ok: true, provider: used, eventId: created.id, slot };
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

async function startConnect(tenantId, provider) {
  if (!providerConfigured(provider)) {
    throw new Error(provider === 'google'
      ? 'Google Calendar n\'est pas encore configuré.'
      : 'Microsoft Calendar n\'est pas encore configuré.');
  }
  return { url: buildAuthUrl(tenantId, provider) };
}

module.exports = {
  TZ,
  configuredFlags,
  listConnections,
  startConnect,
  finishOAuth,
  disconnect,
  getAvailableSlots,
  formatAvailabilityForPrompt,
  maybeCreateCalendarEvent,
  looksLikeScheduling,
  providerConfigured,
  settingsRedirect,
  verifyState,
};
