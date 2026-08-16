const { TZ } = require('./oauth');

const DAY_KEYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const DAY_INDEX = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
};
const SLOT_MINUTES = 30;
const LOOKAHEAD_DAYS = 7;
const MAX_SLOTS = 14;
const SCHEDULING_RE = /rendez-vous|rendez vous|rdv|réserver|reserver|reservation|réservation|disponib|dispo|horaire|plage|créneau|creneau|calendrier|calendar|agenda|google|outlook|demain|aujourd|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{1,2}\s*h(?:\s*\d{2})?|\d{1,2}:\d{2}/i;

function looksLikeScheduling(text) {
  return SCHEDULING_RE.test(String(text || ''));
}

function torontoParts(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const map = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: wd[map.weekday] ?? 0,
  };
}

function zonedDate(year, month, day, hour, minute) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour + 4, minute || 0));
  for (let i = 0; i < 8; i += 1) {
    const p = torontoParts(guess);
    const target = Date.UTC(year, month - 1, day, hour, minute || 0);
    const actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = target - actual;
    if (Math.abs(diff) < 60 * 1000) return guess;
    guess.setTime(guess.getTime() + diff);
  }
  return guess;
}

function addDaysYmd(y, m, d, n) {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function parseHHMM(s) {
  const m = String(s || '').match(/(\d{1,2})\s*[:hH]\s*(\d{2})?/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function normalizeHours(hours) {
  const raw = (hours && hours.horaire) || hours || {};
  const out = {};
  for (const key of DAY_KEYS) {
    const v = raw[key];
    out[key] = v && typeof v === 'object' ? v : { ouvert: false };
  }
  return out;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function mergeBusy(ranges) {
  const items = (ranges || [])
    .map((r) => ({
      start: new Date(r.start).getTime(),
      end: new Date(r.end).getTime(),
    }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of items) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

function buildOpenSlots(hours, fromDate = new Date(), durationMin = SLOT_MINUTES) {
  const h = normalizeHours(hours);
  const now = fromDate.getTime();
  const startParts = torontoParts(fromDate);
  const slots = [];

  for (let i = 0; i < LOOKAHEAD_DAYS; i += 1) {
    const ymd = addDaysYmd(startParts.year, startParts.month, startParts.day, i);
    const probe = zonedDate(ymd.year, ymd.month, ymd.day, 12, 0);
    const wd = torontoParts(probe).weekday;
    const dayKey = DAY_KEYS[wd];
    const conf = h[dayKey];
    if (!conf || !conf.ouvert) continue;
    const open = parseHHMM(conf.debut || '09:00');
    const close = parseHHMM(conf.fin || '17:00');
    if (!open || !close) continue;

    let cursor = zonedDate(ymd.year, ymd.month, ymd.day, open.hour, open.minute);
    const endDay = zonedDate(ymd.year, ymd.month, ymd.day, close.hour, close.minute);
    while (cursor.getTime() + durationMin * 60 * 1000 <= endDay.getTime()) {
      const start = cursor.getTime();
      const end = start + durationMin * 60 * 1000;
      if (start >= now + 15 * 60 * 1000) {
        slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
      }
      cursor = new Date(cursor.getTime() + durationMin * 60 * 1000);
    }
  }
  return slots;
}

function subtractBusy(slots, busyRanges) {
  const busy = mergeBusy(busyRanges);
  return (slots || []).filter((s) => {
    const a = new Date(s.start).getTime();
    const b = new Date(s.end).getTime();
    return !busy.some((r) => overlaps(a, b, r.start, r.end));
  });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatLocalDateTime(iso) {
  const p = torontoParts(new Date(iso));
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:00`;
}

function formatSlotFr(isoStart, isoEnd) {
  const start = new Date(isoStart);
  const end = new Date(isoEnd);
  const day = new Intl.DateTimeFormat('fr-CA', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(start);
  const hm = new Intl.DateTimeFormat('fr-CA', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const a = hm.format(start).replace(' h ', 'h').replace(' h', 'h');
  const b = hm.format(end).replace(' h ', 'h').replace(' h', 'h');
  return `${day} ${a}–${b}`;
}

function nextWeekdayDate(weekday, fromDate) {
  const p = torontoParts(fromDate);
  let add = (weekday - p.weekday + 7) % 7;
  if (add === 0) add = 0;
  return addDaysYmd(p.year, p.month, p.day, add);
}

function parseAcceptedSlot(text, hours, fromDate = new Date(), durationMin = SLOT_MINUTES) {
  const minutes = Number(durationMin) > 0 ? Number(durationMin) : SLOT_MINUTES;
  const raw = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!raw.trim()) return null;

  const iso = raw.match(/(\d{4}-\d{2}-\d{2})[t t](\d{1,2}):(\d{2})/);
  if (iso) {
    const start = zonedDate(Number(iso[1].slice(0, 4)), Number(iso[1].slice(5, 7)), Number(iso[1].slice(8, 10)), Number(iso[2]), Number(iso[3]));
    return {
      start: start.toISOString(),
      end: new Date(start.getTime() + minutes * 60 * 1000).toISOString(),
    };
  }

  let ymd = null;
  if (/\baujourd.?hui\b/.test(raw)) {
    const p = torontoParts(fromDate);
    ymd = { year: p.year, month: p.month, day: p.day };
  } else if (/\bapres.?demain\b/.test(raw)) {
    const p = torontoParts(fromDate);
    ymd = addDaysYmd(p.year, p.month, p.day, 2);
  } else if (/\bdemain\b/.test(raw)) {
    const p = torontoParts(fromDate);
    ymd = addDaysYmd(p.year, p.month, p.day, 1);
  } else {
    for (const [name, idx] of Object.entries(DAY_INDEX)) {
      if (raw.includes(name)) {
        ymd = nextWeekdayDate(idx, fromDate);
        const candidate = zonedDate(ymd.year, ymd.month, ymd.day, 23, 59);
        if (candidate.getTime() < fromDate.getTime()) {
          ymd = addDaysYmd(ymd.year, ymd.month, ymd.day, 7);
        }
        break;
      }
    }
  }

  const time = parseHHMM(raw);
  if (!time) return null;
  if (!ymd) {
    const p = torontoParts(fromDate);
    ymd = { year: p.year, month: p.month, day: p.day };
    const todayStart = zonedDate(ymd.year, ymd.month, ymd.day, time.hour, time.minute);
    if (todayStart.getTime() < fromDate.getTime() + 10 * 60 * 1000) {
      ymd = addDaysYmd(ymd.year, ymd.month, ymd.day, 1);
    }
  }

  const start = zonedDate(ymd.year, ymd.month, ymd.day, time.hour, time.minute);
  const dayKey = DAY_KEYS[torontoParts(start).weekday];
  const conf = normalizeHours(hours)[dayKey];
  if (conf && conf.ouvert === false) return null;

  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + minutes * 60 * 1000).toISOString(),
  };
}

const ACCEPT_RE = /\b(oui|ok|okay|parfait|d['’]accord|c['’]est bon|cest bon|je prends|je prendrai|confirme|ca me va|ça me va|excellent|nickel)\b/i;

function parseSlotFromLastTimedLine(text, hours, durationMin) {
  const lines = String(text || '').split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!parseHHMM(lines[i].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) continue;
    const slot = parseAcceptedSlot(lines[i], hours, new Date(), durationMin);
    if (slot) return slot;
  }
  return parseAcceptedSlot(text, hours, new Date(), durationMin);
}

function lastDayHint(texts) {
  const blob = texts.filter(Boolean).join('\n').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let best = { pos: -1, token: '' };
  const tokens = ['aujourdhui', 'aujourd hui', 'demain', 'apres-demain', 'apres demain', ...Object.keys(DAY_INDEX)];
  for (const token of tokens) {
    const pos = blob.lastIndexOf(token.replace(' ', ''));
    const pos2 = blob.lastIndexOf(token);
    const p = Math.max(pos, pos2);
    if (p >= best.pos) best = { pos: p, token };
  }
  if (best.pos < 0) return '';
  if (best.token.includes('aujourdhui') || best.token.includes('aujourd')) return 'aujourd\'hui';
  if (best.token.includes('apres')) return 'après-demain';
  if (best.token === 'demain') return 'demain';
  return best.token;
}

/** Préfère l’heure dite par le client, pas la liste de plages de l’agent. */
function extractAcceptedSlot({ userMessage, aiReply, qualificationData, history, hours, durationMin }) {
  const minutes = durationMin || SLOT_MINUTES;
  const fromQual = parseAcceptedSlot(qualificationData?.creneau_confirme || '', hours, new Date(), minutes);
  if (fromQual) return fromQual;

  const user = String(userMessage || '');
  const userNorm = user.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const histText = [...(history || []).map((m) => m.content), aiReply].filter(Boolean).join('\n');
  const dayHint = lastDayHint([user, histText]);

  if (parseHHMM(userNorm)) {
    let slot = parseAcceptedSlot(user, hours, new Date(), minutes);
    if (!slot && dayHint && !Object.keys(DAY_INDEX).some((d) => userNorm.includes(d)) && !/demain|aujourdhui/.test(userNorm)) {
      slot = parseAcceptedSlot(`${dayHint} ${user}`, hours, new Date(), minutes);
    }
    if (slot) return slot;
  }

  if (ACCEPT_RE.test(user)) {
    const lastAsst = [...(history || [])].reverse().find((m) => m.role === 'assistant');
    const fromAi = parseSlotFromLastTimedLine(aiReply || (lastAsst && lastAsst.content) || '', hours, minutes);
    if (fromAi) return fromAi;
  }

  return null;
}

module.exports = {
  TZ,
  SLOT_MINUTES,
  MAX_SLOTS,
  looksLikeScheduling,
  buildOpenSlots,
  subtractBusy,
  formatSlotFr,
  formatLocalDateTime,
  parseAcceptedSlot,
  extractAcceptedSlot,
  mergeBusy,
  DEFAULT_DURATION_MIN: SLOT_MINUTES,
};
