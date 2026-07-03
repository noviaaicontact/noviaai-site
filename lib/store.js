// Mémoire des conversations : Supabase (SaaS) ou Netlify Blobs / RAM (fallback).

const HISTORY_MAX = 12;
const { loadThreadHistory, saveThreadHistory } = require('./tenant');

let _mem = {};
let _blob = null;

function getBlob() {
  if (_blob !== null) return _blob;
  try {
    const { getStore } = require('@netlify/blobs');
    _blob = getStore('sms-conversations');
  } catch (e) {
    _blob = false;
  }
  return _blob;
}

async function loadHistory(key, tenantId, callerPhone) {
  if (tenantId && callerPhone) {
    const h = await loadThreadHistory(tenantId, callerPhone);
    if (h) return h;
  }
  const s = getBlob();
  if (s) {
    try {
      const d = await s.get(key, { type: 'json' });
      return (d && d.messages) || [];
    } catch (e) { /* fallback */ }
  }
  return _mem[key] || [];
}

async function saveHistory(key, messages, tenantId, callerPhone) {
  const trimmed = messages.slice(-HISTORY_MAX);
  if (tenantId && callerPhone) {
    await saveThreadHistory(tenantId, callerPhone, trimmed);
  }
  const s = getBlob();
  if (s) {
    try {
      await s.setJSON(key, { messages: trimmed, updated: Date.now() });
      return;
    } catch (e) { /* fallback */ }
  }
  _mem[key] = trimmed;
}

module.exports = { loadHistory, saveHistory, HISTORY_MAX };
