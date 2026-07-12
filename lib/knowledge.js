// Base de connaissances : scrape URL, chunks, embeddings pgvector.

const cheerio = require('cheerio');
const { getAdmin, isDbConfigured } = require('./db');

const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 120;

function isKnowledgeReady() {
  return isDbConfigured() && !!process.env.OPENAI_API_KEY;
}

async function fetchPageText(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL invalide');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Seules les URLs http/https sont acceptées');
  }

  const res = await fetch(parsed.href, {
    headers: {
      'User-Agent': 'NoviaAI-Bot/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Page inaccessible (${res.status})`);

  const html = await res.text();
  const $ = cheerio.load(html);
  $('script, style, nav, footer, iframe, noscript, svg').remove();
  const title = $('title').first().text().trim() || parsed.hostname;
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  if (text.length < 80) throw new Error('Page trop vide — peu de texte extractible');

  return {
    title,
    text: text.slice(0, 60000),
    finalUrl: res.url || parsed.href,
  };
}

function chunkText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks = [];
  for (let i = 0; i < clean.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    chunks.push(clean.slice(i, i + CHUNK_SIZE));
    if (i + CHUNK_SIZE >= clean.length) break;
  }
  return chunks;
}

async function createEmbedding(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY manquante');

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: String(text).slice(0, 8000),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('embedding error', err);
    throw new Error('Erreur OpenAI embeddings');
  }

  const data = await res.json();
  return data.data && data.data[0] && data.data[0].embedding;
}

async function listSources(tenantId) {
  const db = getAdmin();
  if (!db) return [];
  const { data, error } = await db
    .from('knowledge_sources')
    .select('id, source_type, title, source_url, file_name, status, chunk_count, error_message, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) {
    if (/knowledge_sources|schema cache/i.test(error.message)) return { error: 'migration', sources: [] };
    throw error;
  }
  return data || [];
}

async function deleteSource(tenantId, sourceId) {
  const db = getAdmin();
  if (!db) throw new Error('Base de données non configurée');
  const { error } = await db.from('knowledge_sources').delete()
    .eq('id', sourceId)
    .eq('tenant_id', tenantId);
  if (error) throw error;
  return { ok: true };
}

const MAX_FILE_BYTES = 4 * 1024 * 1024;

const MIME_MAP = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  txt: 'text/plain',
  csv: 'text/csv',
};

function fileKind(mimeType, fileName) {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') return 'docx';
  if (mimeType === 'application/msword' || ext === 'doc') return 'doc';
  if (mimeType === 'text/plain' || ext === 'txt') return 'txt';
  if (mimeType === 'text/csv' || ext === 'csv') return 'csv';
  return null;
}

async function extractFileText(buffer, mimeType, fileName) {
  const kind = fileKind(mimeType, fileName);
  if (!kind) throw new Error('Format non supporté — PDF, DOCX, DOC, TXT ou CSV');

  if (kind === 'pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return String(data.text || '').replace(/\s+/g, ' ').trim();
  }
  if (kind === 'docx' || kind === 'doc') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return String(result.value || '').replace(/\s+/g, ' ').trim();
  }
  return String(buffer.toString('utf8') || '').replace(/\s+/g, ' ').trim();
}

async function uploadFileStorage(tenantId, sourceId, fileName, buffer, mimeType) {
  const db = getAdmin();
  if (!db) return null;
  const safeName = String(fileName || 'document').replace(/[^\w.\-() ]+/g, '_').slice(0, 120);
  const path = `${tenantId}/${sourceId}/${safeName}`;
  try {
    const { error } = await db.storage.from('knowledge-files').upload(path, buffer, {
      contentType: mimeType || 'application/octet-stream',
      upsert: true,
    });
    if (error) {
      console.error('storage upload', error.message);
      return null;
    }
    return path;
  } catch (e) {
    console.error('storage upload', e.message);
    return null;
  }
}

async function indexTextSource(tenantId, sourceRow, text, chunkMeta) {
  const db = getAdmin();
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error('Aucun contenu indexable');

  let index = 0;
  for (const content of chunks) {
    const embedding = await createEmbedding(content);
    const { error: chunkErr } = await db.from('knowledge_chunks').insert({
      tenant_id: tenantId,
      source_id: sourceRow.id,
      content,
      embedding,
      chunk_index: index,
      metadata: chunkMeta,
    });
    if (chunkErr) throw chunkErr;
    index += 1;
  }

  await db.from('knowledge_sources').update({
    status: 'ready',
    chunk_count: index,
    error_message: null,
    updated_at: new Date().toISOString(),
  }).eq('id', sourceRow.id);

  return index;
}

async function ingestUrl(tenantId, url) {
  const db = getAdmin();
  if (!db) throw new Error('Base de données non configurée');
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY requise pour indexer le site');

  const page = await fetchPageText(url);

  const { data: source, error: insErr } = await db.from('knowledge_sources').insert({
    tenant_id: tenantId,
    source_type: 'url',
    title: page.title.slice(0, 200),
    source_url: page.finalUrl,
    status: 'processing',
  }).select('*').single();

  if (insErr) {
    if (/knowledge_sources/i.test(insErr.message)) {
      throw new Error('Migration Supabase requise — exécutez supabase/schema-v6-knowledge-base.sql');
    }
    throw insErr;
  }

  try {
    const count = await indexTextSource(tenantId, source, page.text, {
      url: page.finalUrl,
      title: page.title,
      type: 'url',
    });
    await maybeFillPublicPhoneFromText(tenantId, page.text);
    return { source: { ...source, status: 'ready', chunk_count: count }, chunks: count };
  } catch (e) {
    await db.from('knowledge_sources').update({
      status: 'failed',
      error_message: e.message || 'Erreur indexation',
      updated_at: new Date().toISOString(),
    }).eq('id', source.id);
    throw e;
  }
}

async function ingestFile(tenantId, { buffer, fileName, mimeType }) {
  const db = getAdmin();
  if (!db) throw new Error('Base de données non configurée');
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY requise pour indexer les fichiers');
  if (!buffer || !buffer.length) throw new Error('Fichier vide');
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error(`Fichier trop volumineux (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} Mo)`);
  }

  const kind = fileKind(mimeType, fileName);
  if (!kind) throw new Error('Format non supporté — PDF, DOCX, DOC, TXT ou CSV');

  const text = await extractFileText(buffer, mimeType, fileName);
  if (text.length < 40) throw new Error('Document trop court ou illisible');

  const title = String(fileName || 'Document').slice(0, 200);
  const resolvedMime = mimeType || MIME_MAP[kind] || 'application/octet-stream';

  const { data: source, error: insErr } = await db.from('knowledge_sources').insert({
    tenant_id: tenantId,
    source_type: 'file',
    title,
    file_name: fileName,
    mime_type: resolvedMime,
    status: 'processing',
  }).select('*').single();

  if (insErr) {
    if (/knowledge_sources/i.test(insErr.message)) {
      throw new Error('Migration Supabase requise — exécutez supabase/schema-v6-knowledge-base.sql');
    }
    throw insErr;
  }

  const storagePath = await uploadFileStorage(tenantId, source.id, fileName, buffer, resolvedMime);
  if (storagePath) {
    await db.from('knowledge_sources').update({ storage_path: storagePath }).eq('id', source.id);
  }

  try {
    const count = await indexTextSource(tenantId, source, text, {
      file_name: fileName,
      title,
      type: 'file',
    });
    return { source: { ...source, status: 'ready', chunk_count: count, storage_path: storagePath }, chunks: count };
  } catch (e) {
    await db.from('knowledge_sources').update({
      status: 'failed',
      error_message: e.message || 'Erreur indexation',
      updated_at: new Date().toISOString(),
    }).eq('id', source.id);
    throw e;
  }
}

async function searchKnowledge(tenantId, query, limit = 5) {
  const db = getAdmin();
  if (!db || !query || !process.env.OPENAI_API_KEY) return [];

  try {
    const embedding = await createEmbedding(query);
    const { data, error } = await db.rpc('match_knowledge_chunks', {
      p_tenant_id: tenantId,
      p_query_embedding: embedding,
      p_match_count: limit,
      p_match_threshold: 0.35,
    });
    if (error) {
      if (/match_knowledge|knowledge_chunks/i.test(error.message)) return [];
      throw error;
    }
    return (data || []).map((row) => ({
      content: row.content,
      similarity: row.similarity,
      metadata: row.metadata,
      source_id: row.source_id,
    }));
  } catch (e) {
    console.error('searchKnowledge', e.message);
    return [];
  }
}

async function testRetrieval(tenantId, question) {
  const hits = await searchKnowledge(tenantId, question, 5);
  return { hits, question };
}

async function maybeFillPublicPhoneFromText(tenantId, text) {
  const db = getAdmin();
  if (!db || !tenantId) return null;
  const { data: tenant } = await db.from('tenants').select('public_phone, twilio_number').eq('id', tenantId).maybeSingle();
  if (!tenant || (tenant.public_phone && String(tenant.public_phone).trim())) return null;

  const { extractPhonesFromText, digitsOnly } = require('./phone-util');
  const twilioTen = (() => {
    const d = digitsOnly(tenant.twilio_number);
    return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  })();

  const counts = new Map();
  extractPhonesFromText(text).forEach((p) => {
    if (!p.digits || p.digits === twilioTen) return;
    counts.set(p.digits, (counts.get(p.digits) || 0) + 1);
  });
  let best = null;
  let bestN = 0;
  counts.forEach((n, digits) => {
    if (n > bestN) {
      bestN = n;
      best = digits;
    }
  });
  if (!best) return null;
  const display = `${best.slice(0, 3)}-${best.slice(3, 6)}-${best.slice(6)}`;
  await db.from('tenants').update({
    public_phone: display,
    updated_at: new Date().toISOString(),
  }).eq('id', tenantId);
  return display;
}

/** Numéro le plus fréquent dans la base de connaissances (hors ligne Twilio). */
async function findWebsitePhone(tenantId, twilioNumber) {
  const db = getAdmin();
  if (!db || !tenantId) return null;
  const { data, error } = await db
    .from('knowledge_chunks')
    .select('content')
    .eq('tenant_id', tenantId)
    .limit(40);
  if (error || !data || !data.length) return null;

  const { extractPhonesFromText, digitsOnly, formatDisplay } = require('./phone-util');
  const twilioTen = (() => {
    const d = digitsOnly(twilioNumber);
    return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  })();

  const counts = new Map();
  data.forEach((row) => {
    extractPhonesFromText(row.content).forEach((p) => {
      if (!p.digits || p.digits === twilioTen) return;
      counts.set(p.digits, (counts.get(p.digits) || 0) + 1);
    });
  });
  let best = null;
  let bestN = 0;
  counts.forEach((n, digits) => {
    if (n > bestN) {
      bestN = n;
      best = digits;
    }
  });
  return best ? formatDisplay(best) : null;
}

module.exports = {
  isKnowledgeReady,
  fetchPageText,
  chunkText,
  listSources,
  deleteSource,
  ingestUrl,
  ingestFile,
  searchKnowledge,
  testRetrieval,
  findWebsitePhone,
  maybeFillPublicPhoneFromText,
};
