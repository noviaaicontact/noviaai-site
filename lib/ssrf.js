/**
 * Garde anti-SSRF pour les fetches d'URL fournies par un commerce (import de site).
 */
const dns = require('dns').promises;
const { BlockList, isIP } = require('net');

const MAX_REDIRECTS = 5;

const blocked = new BlockList();
blocked.addSubnet('0.0.0.0', 8, 'ipv4');
blocked.addSubnet('10.0.0.0', 8, 'ipv4');
blocked.addSubnet('100.64.0.0', 10, 'ipv4');
blocked.addSubnet('127.0.0.0', 8, 'ipv4');
blocked.addSubnet('169.254.0.0', 16, 'ipv4');
blocked.addSubnet('172.16.0.0', 12, 'ipv4');
blocked.addSubnet('192.168.0.0', 16, 'ipv4');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.google.com',
  'instance-data',
  'kubernetes',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
}

function ipv4FromMapped(addr) {
  const s = String(addr || '');
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : null;
}

function isBlockedAddress(addr) {
  if (!addr) return true;
  const mapped = ipv4FromMapped(addr);
  const ip = mapped || addr;
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, 'ipv4');
  if (v === 6) return blocked.check(ip, 'ipv6');
  return true;
}

function isBlockedHostname(host) {
  const h = normalizeHost(host);
  if (!h) return true;
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.includes('metadata.google')) return true;
  if (isIP(h) && isBlockedAddress(h)) return true;
  return false;
}

function parseHttpUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || ''));
  } catch {
    throw new Error('URL invalide');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Seules les URLs http/https sont acceptées');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL refusée');
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error('URL interne refusée');
  }
  return parsed;
}

async function assertPublicResolved(parsed) {
  const host = parsed.hostname;
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error('URL interne refusée');
    return;
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('Hôte inaccessible');
  }
  if (!records || !records.length) throw new Error('Hôte inaccessible');
  for (const rec of records) {
    if (isBlockedAddress(rec.address)) throw new Error('URL interne refusée');
  }
}

async function assertSafeUrl(raw) {
  const parsed = parseHttpUrl(raw);
  await assertPublicResolved(parsed);
  return parsed;
}

async function safeFetch(raw, init = {}, hop = 0) {
  if (hop > MAX_REDIRECTS) throw new Error('Trop de redirections');
  const parsed = await assertSafeUrl(raw);
  const res = await fetch(parsed.href, {
    ...init,
    redirect: 'manual',
  });
  const status = res.status;
  if (status >= 300 && status < 400) {
    const loc = res.headers.get('location');
    if (!loc) throw new Error('Redirection invalide');
    const next = new URL(loc, parsed.href).href;
    return safeFetch(next, init, hop + 1);
  }
  res.safeFinalUrl = parsed.href;
  return res;
}

module.exports = {
  isBlockedHostname,
  isBlockedAddress,
  parseHttpUrl,
  assertSafeUrl,
  safeFetch,
};
