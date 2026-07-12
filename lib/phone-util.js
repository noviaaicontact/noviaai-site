/** Normalise un numéro nord-américain en E.164 (+1XXXXXXXXXX). */
function toE164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (String(raw).trim().startsWith('+')) return String(raw).trim();
  return `+${d}`;
}

function digitsOnly(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function formatDisplay(e164) {
  const d = digitsOnly(e164);
  if (d.length === 11 && d.startsWith('1')) {
    return `${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return e164 || '';
}

/** Extrait les numéros NA d'un texte (priorise les formats type site web QC). */
function extractPhonesFromText(text) {
  const src = String(text || '');
  const found = [];
  const re = /(?:\+?1[-.\s]?)?(?:\(?([2-9]\d{2})\)?[-.\s])([2-9]\d{2})[-.\s](\d{4})/g;
  let m;
  while ((m = re.exec(src))) {
    const d = `${m[1]}${m[2]}${m[3]}`;
    found.push({ digits: d, display: `${m[1]}-${m[2]}-${m[3]}` });
  }
  return found;
}

/**
 * Numéro à donner aux clients (site / Google), pas la ligne SMS NoviaAI.
 * Priorité: public_phone → numéro distinct du Twilio → Twilio en dernier recours.
 */
function resolveCustomerPhone(row) {
  if (!row) return '';
  const twilioD = digitsOnly(row.twilio_number);
  const normalizedTwilio = twilioD.length === 11 && twilioD.startsWith('1') ? twilioD.slice(1) : twilioD;

  const candidates = [
    row.public_phone,
    row.existing_business_number,
    row.phone_forward,
  ];
  for (const c of candidates) {
    const d = digitsOnly(c);
    if (!d) continue;
    const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
    if (ten.length !== 10) continue;
    if (normalizedTwilio && ten === normalizedTwilio) continue; // évite la ligne SMS
    return formatDisplay(ten);
  }
  // Dernier recours: ligne NoviaAI (souvent publiée sur Google si "nouveau numéro")
  if (row.twilio_number) return formatDisplay(row.twilio_number);
  return '';
}

module.exports = {
  toE164,
  formatDisplay,
  digitsOnly,
  extractPhonesFromText,
  resolveCustomerPhone,
};
