/** Normalise un numéro nord-américain en E.164 (+1XXXXXXXXXX). */
function toE164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (String(raw).trim().startsWith('+')) return String(raw).trim();
  return `+${d}`;
}

function formatDisplay(e164) {
  const d = String(e164 || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  return e164 || '';
}

module.exports = { toE164, formatDisplay };
