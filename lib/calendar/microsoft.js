const { TZ } = require('./oauth');
const { formatLocalDateTime } = require('./slots');

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || `HTTP ${res.status}` };
  }
}

function apiError(data, fallback, status) {
  const msg = data?.error?.message || data?.error_description || data?.error || fallback;
  const err = new Error(typeof msg === 'string' ? msg : fallback);
  if (status === 401 || data?.error?.code === 'InvalidAuthenticationToken') err.code = 'expired';
  return err;
}

function toIso(dt) {
  if (!dt) return null;
  if (dt.dateTime && dt.timeZone) {
    const raw = String(dt.dateTime).replace(' ', 'T');
    const hasOffset = /[zZ]|[+-]\d{2}:\d{2}$/.test(raw);
    return hasOffset ? new Date(raw).toISOString() : new Date(`${raw}`).toISOString();
  }
  if (dt.dateTime) return new Date(dt.dateTime).toISOString();
  return null;
}

async function listBusy(accessToken, timeMin, timeMax) {
  const start = encodeURIComponent(timeMin);
  const end = encodeURIComponent(timeMax);
  const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start}&endDateTime=${end}&$select=start,end,showAs,isCancelled&$top=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: `outlook.timezone="${TZ}"`,
    },
  });
  const data = await readJson(res);
  if (!res.ok) throw apiError(data, 'Calendrier Microsoft indisponible', res.status);
  return (data.value || [])
    .filter((ev) => !ev.isCancelled && ev.showAs !== 'free' && ev.showAs !== 'workingElsewhere')
    .map((ev) => ({
      start: toIso(ev.start) || timeMin,
      end: toIso(ev.end) || timeMax,
    }))
    .filter((b) => b.start && b.end);
}

async function createEvent(accessToken, event) {
  const res = await fetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject: event.summary,
      body: { contentType: 'text', content: event.description || '' },
      start: { dateTime: formatLocalDateTime(event.start), timeZone: TZ },
      end: { dateTime: formatLocalDateTime(event.end), timeZone: TZ },
    }),
  });
  const data = await readJson(res);
  if (!res.ok) throw apiError(data, 'Impossible de créer l\'événement Microsoft', res.status);
  return { id: data.id, htmlLink: data.webLink || null };
}

module.exports = { listBusy, createEvent };
