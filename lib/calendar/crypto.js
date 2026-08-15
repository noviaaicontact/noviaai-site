const crypto = require('crypto');

function keyBytes() {
  const raw = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || 'noviaai-calendar-dev';
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function encryptSecret(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptSecret(payload) {
  if (!payload) return null;
  const buf = Buffer.from(String(payload), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function stateSecret() {
  return keyBytes();
}

function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyState(state) {
  const raw = String(state || '');
  const i = raw.lastIndexOf('.');
  if (i < 1) throw new Error('État OAuth invalide');
  const body = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('État OAuth invalide');
  }
  const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!data || !data.t || !data.p || !data.e) throw new Error('État OAuth incomplet');
  if (Date.now() > Number(data.e)) throw new Error('Lien de connexion expiré — réessayez.');
  return data;
}

function randomVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function challengeS256(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

module.exports = {
  encryptSecret,
  decryptSecret,
  signState,
  verifyState,
  randomVerifier,
  challengeS256,
};
