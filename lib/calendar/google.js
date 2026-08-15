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

function apiError(data, fallback) {
  const msg = data?.error?.message || data?.error_description || data?.error || fallback;
  const err = new Error(typeof msg === 'string' ? msg : fallback);
  if (data?.error?.code === 401 || data?.error === 'invalid_grant') err.code = 'expired';
  return err;
}

async function listBusy(accessToken, timeMin, timeMax, calendarId = 'primary') {
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: TZ,
      items: [{ id: calendarId || 'primary' }],
    }),
  });
  const data = await readJson(res);
  if (!res.ok) throw apiError(data, 'Calendrier Google indisponible');
  const cal = data.calendars && data.calendars[calendarId || 'primary'];
  if (cal && cal.errors && cal.errors.length) {
    throw new Error(cal.errors[0].reason || 'Calendrier Google indisponible');
  }
  return (cal && cal.busy) || [];
}

async function createEvent(accessToken, event, calendarId = 'primary') {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: event.summary,
        description: event.description || '',
        start: { dateTime: formatLocalDateTime(event.start), timeZone: TZ },
        end: { dateTime: formatLocalDateTime(event.end), timeZone: TZ },
      }),
    },
  );
  const data = await readJson(res);
  if (!res.ok) throw apiError(data, 'Impossible de créer l\'événement Google');
  return { id: data.id, htmlLink: data.htmlLink || null };
}

module.exports = { listBusy, createEvent };
