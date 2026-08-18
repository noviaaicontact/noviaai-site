// Base de connaissances : scrape URL, chunks, embeddings pgvector.

const cheerio = require('cheerio');
const { getAdmin, isDbConfigured } = require('./db');
const { safeFetch } = require('./ssrf');

const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 120;

function isKnowledgeReady() {
  return isDbConfigured() && !!process.env.OPENAI_API_KEY;
}

const MAX_SITE_PAGES = 20;
const PRIORITY_PATHS = [
  '/',
  '/services', '/nos-services', '/service', '/prestations',
  '/prix', '/tarifs', '/pricing', '/rates', '/forfaits',
  '/a-propos', '/apropos', '/about', '/about-us', '/notre-entreprise', '/qui-sommes-nous',
  '/contact', '/contactez-nous', '/nous-joindre',
  '/faq', '/foire-aux-questions', '/aide', '/questions',
  '/horaires', '/hours', '/ouverture',
  '/equipe', '/team', '/notre-equipe',
  '/reservation', '/reservations', '/rendez-vous', '/booking', '/book',
  '/soumission', '/devis', '/estimation', '/demande-de-soumission',
  '/realisations', '/portfolio', '/gallery', '/galerie',
  '/zones', '/secteur', '/territoire', '/service-area',
  '/categorie-produit', '/product-category', '/boutique', '/shop', '/produits',
  '/analyse-de-leau', '/ouverture-et-fermeture', '/livraison-et-installation',
  '/promo', '/promotions',
];
const SKIP_PATH_RE = /\/(wp-admin|wp-login|wp-json|wp-content|wp-includes|cart|checkout|panier|wishlist|login|connexion|account|mon-compte|cdn-cgi|privacy|confidentialite|cookie|terms|conditions|mentions-legales|tag\/|product-tag\/|author\/|feed\/|embed\/|xmlrpc)/i;
const SKIP_QUERY_KEYS = [
  'add_to_wishlist', 'add-to-cart', 'added-to-cart', '_wpnonce',
  'remove_item', 'undo_item', 'fill_cart', 'share',
];

function shouldSkipCrawlUrl(url) {
  const raw = String(url || '');
  if (!raw) return true;
  if (SKIP_PATH_RE.test(raw)) return true;
  try {
    const u = new URL(raw, 'https://example.invalid');
    return SKIP_QUERY_KEYS.some((k) => u.searchParams.has(k));
  } catch {
    return SKIP_QUERY_KEYS.some((k) => raw.includes(k));
  }
}

function normalizeUrl(raw, base) {
  try {
    const u = new URL(raw, base);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = '';
    // Wishlist / tracking / filtres WooCommerce : une seule URL canonique par page.
    u.search = '';
    let href = u.href;
    if (href.endsWith('/') && u.pathname !== '/') href = href.slice(0, -1);
    return href;
  } catch {
    return null;
  }
}

function sameSite(a, b) {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, '');
    const hb = new URL(b).hostname.replace(/^www\./, '');
    return ha === hb;
  } catch {
    return false;
  }
}

function pathScore(pathname) {
  const p = (pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  const idx = PRIORITY_PATHS.findIndex((x) => {
    const n = x.replace(/\/+$/, '') || '/';
    return p === n || p.startsWith(`${n}/`) || (n.length > 8 && p.startsWith(`${n}-`));
  });
  if (idx >= 0) return 1000 - idx;
  if (p === '/') return 999;
  // Pénaliser pages profondes / blog
  const depth = p.split('/').filter(Boolean).length;
  if (/blog|news|article|nouveaut/.test(p)) return 5 - depth;
  return 40 - depth * 5;
}

async function fetchPageRaw(url, timeoutMs = 15000) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL invalide');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Seules les URLs http/https sont acceptées');
  }

  const res = await safeFetch(parsed.href, {
    headers: {
      'User-Agent': 'NoviaAI-Bot/1.0 (+https://noviaai.ca; site analysis for business AI agent)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Page inaccessible (${res.status})`);
  const html = await res.text();
  const finalUrl = res.safeFinalUrl || parsed.href;
  let finalParsed = parsed;
  try { finalParsed = new URL(finalUrl); } catch (_) { /* keep */ }
  return { html, finalUrl, parsed: finalParsed };
}

function extractLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const out = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const abs = normalizeUrl(href, baseUrl);
    if (!abs) return;
    if (!sameSite(abs, baseUrl)) return;
    if (shouldSkipCrawlUrl(href) || shouldSkipCrawlUrl(abs)) return;
    if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|mp4|mp3|css|js)(\?|$)/i.test(abs)) return;
    out.push(abs);
  });
  return [...new Set(out)];
}

function extractPageContent(html, fallbackHost) {
  const $ = cheerio.load(html);
  const links = []; // filled by caller if needed
  $('script, style, iframe, noscript, svg, template').remove();
  const title = $('title').first().text().trim()
    || $('h1').first().text().trim()
    || fallbackHost;
  // Garder main/article en priorité
  const main = $('main, article, [role="main"], .content, #content').first();
  const root = main.length ? main : $('body');
  root.find('nav, footer, .cookie, .cookies, #cookie').remove();
  const text = root.text().replace(/\s+/g, ' ').trim();
  return { title, text: text.slice(0, 60000), links };
}

async function fetchPageText(url) {
  const { html, finalUrl, parsed } = await fetchPageRaw(url, 20000);
  const { title, text } = extractPageContent(html, parsed.hostname);
  if (text.length < 80) throw new Error('Page trop vide — peu de texte extractible');
  return {
    title,
    text,
    finalUrl,
    links: extractLinks(html, finalUrl),
  };
}

async function fetchSitemapUrls(origin) {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const found = [];
  for (const sm of candidates) {
    try {
      const res = await safeFetch(sm, {
        headers: { 'User-Agent': 'NoviaAI-Bot/1.0', Accept: 'application/xml,text/xml,*/*' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
      locs.forEach((loc) => {
        const abs = normalizeUrl(loc, origin);
        if (abs && sameSite(abs, origin) && !shouldSkipCrawlUrl(loc) && !shouldSkipCrawlUrl(abs)) found.push(abs);
      });
      if (found.length) break;
    } catch (_) { /* ignore */ }
  }
  return [...new Set(found)];
}

async function discoverSiteUrls(startUrl, maxPages = MAX_SITE_PAGES, extraUrls = []) {
  const start = normalizeUrl(startUrl, startUrl);
  if (!start) throw new Error('URL invalide');
  const origin = new URL(start).origin;
  const scored = new Map();

  const add = (url, bonus = 0) => {
    if (shouldSkipCrawlUrl(url)) return;
    const abs = normalizeUrl(url, origin);
    if (!abs || !sameSite(abs, origin) || shouldSkipCrawlUrl(abs)) return;
    const score = pathScore(new URL(abs).pathname) + bonus;
    const prev = scored.get(abs) || -Infinity;
    if (score > prev) scored.set(abs, score);
  };

  add(start, 50);
  PRIORITY_PATHS.forEach((p) => add(`${origin}${p === '/' ? '' : p}`, 20));
  (extraUrls || []).forEach((u) => add(u, 80));

  const fromSitemap = await fetchSitemapUrls(origin);
  fromSitemap.slice(0, 80).forEach((u) => add(u, 10));

  try {
    const home = await fetchPageText(start);
    (home.links || []).forEach((u) => add(u, 15));
  } catch (_) { /* homepage may fail; keep priority paths */ }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .slice(0, maxPages);
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

async function createEmbeddingsBatch(texts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY manquante');
  const inputs = texts.map((t) => String(t).slice(0, 8000));
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: inputs,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('embedding error', err);
    throw new Error('Erreur OpenAI embeddings');
  }
  const data = await res.json();
  const rows = (data.data || []).slice().sort((a, b) => a.index - b.index);
  return rows.map((r) => r.embedding);
}

async function createEmbedding(text) {
  const [emb] = await createEmbeddingsBatch([text]);
  return emb;
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

  const BATCH = 16;
  let index = 0;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const embeddings = await createEmbeddingsBatch(slice);
    const rows = slice.map((content, j) => ({
      tenant_id: tenantId,
      source_id: sourceRow.id,
      content,
      embedding: embeddings[j],
      chunk_index: index + j,
      metadata: chunkMeta,
    }));
    const { error: chunkErr } = await db.from('knowledge_chunks').insert(rows);
    if (chunkErr) throw chunkErr;
    index += slice.length;
  }

  await db.from('knowledge_sources').update({
    status: 'ready',
    chunk_count: index,
    error_message: null,
    updated_at: new Date().toISOString(),
  }).eq('id', sourceRow.id);

  return index;
}

async function deleteSiteCrawlSources(tenantId, origin) {
  const db = getAdmin();
  if (!db || !origin) return 0;
  const host = new URL(origin).hostname.replace(/^www\./, '');
  const { data } = await db
    .from('knowledge_sources')
    .select('id, source_url, title')
    .eq('tenant_id', tenantId)
    .eq('source_type', 'url');
  let n = 0;
  for (const row of data || []) {
    const url = row.source_url || '';
    const isCrawl = (row.title || '').startsWith('[Site]')
      || (url && sameSite(url, origin));
    if (!isCrawl) continue;
    try {
      const h = new URL(url).hostname.replace(/^www\./, '');
      if (h !== host && !(row.title || '').startsWith('[Site]')) continue;
    } catch {
      if (!(row.title || '').startsWith('[Site]')) continue;
    }
    await deleteSource(tenantId, row.id);
    n += 1;
  }
  return n;
}

/**
 * Analyse un site PME en profondeur : sitemap + pages prioritaires + liens internes,
 * puis indexe chaque page dans la base de connaissances de l'agent.
 */
async function ingestWebsite(tenantId, startUrl, opts = {}) {
  const db = getAdmin();
  if (!db) throw new Error('Base de données non configurée');
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY requise pour indexer le site');

  const maxPages = Math.min(MAX_SITE_PAGES, Math.max(3, Number(opts.maxPages) || MAX_SITE_PAGES));
  const start = normalizeUrl(startUrl, startUrl);
  if (!start) throw new Error('URL invalide');
  const origin = new URL(start).origin;

  if (opts.replace !== false) {
    await deleteSiteCrawlSources(tenantId, origin);
  }

  const queue = await discoverSiteUrls(start, maxPages, opts.extraUrls || []);
  const visited = new Set();
  const pages = [];
  const errors = [];
  let combinedText = '';

  while (queue.length && pages.length < maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    try {
      const page = await fetchPageText(url);
      if (page.text.length < 80) continue;
      const canon = normalizeUrl(page.finalUrl, origin) || page.finalUrl;
      if (visited.has(canon) || pages.some((p) => p.finalUrl === canon || p.finalUrl === page.finalUrl)) continue;
      visited.add(canon);
      pages.push({ ...page, finalUrl: canon });
      combinedText += `\n\n### ${page.title}\n${page.text.slice(0, 8000)}`;
      (page.links || []).slice(0, 40).forEach((l) => {
        if (
          !visited.has(l)
          && sameSite(l, origin)
          && !shouldSkipCrawlUrl(l)
          && queue.length < maxPages * 2
        ) {
          queue.push(l);
        }
      });
    } catch (e) {
      errors.push({ url, error: e.message || 'échec' });
    }
  }

  if (!pages.length) {
    throw new Error('Impossible d\'analyser le site — aucune page lisible trouvée');
  }

  let totalChunks = 0;
  const sources = [];
  for (const page of pages) {
    const { data: source, error: insErr } = await db.from('knowledge_sources').insert({
      tenant_id: tenantId,
      source_type: 'url',
      title: `[Site] ${page.title}`.slice(0, 200),
      source_url: page.finalUrl,
      status: 'processing',
    }).select('*').single();
    if (insErr) {
      if (/knowledge_sources/i.test(insErr.message)) {
        throw new Error('Migration Supabase requise — exécutez supabase/schema-v6-knowledge-base.sql');
      }
      errors.push({ url: page.finalUrl, error: insErr.message });
      continue;
    }
    try {
      const count = await indexTextSource(tenantId, source, page.text, {
        url: page.finalUrl,
        title: page.title,
        type: 'website_crawl',
        site_origin: origin,
      });
      totalChunks += count;
      sources.push({ ...source, status: 'ready', chunk_count: count });
    } catch (e) {
      await db.from('knowledge_sources').update({
        status: 'failed',
        error_message: e.message || 'Erreur indexation',
        updated_at: new Date().toISOString(),
      }).eq('id', source.id);
      errors.push({ url: page.finalUrl, error: e.message });
    }
  }

  await maybeFillPublicPhoneFromText(tenantId, combinedText);

  // Synthèse métier pour l'agent (source dédiée, haute priorité en RAG)
  try {
    const summary = await synthesizeSiteSummary(combinedText.slice(0, 24000));
    if (summary && summary.length > 80) {
      const { data: source } = await db.from('knowledge_sources').insert({
        tenant_id: tenantId,
        source_type: 'url',
        title: '[Site] Synthèse commerce (analyse complète)',
        source_url: origin,
        status: 'processing',
      }).select('*').single();
      if (source) {
        const count = await indexTextSource(tenantId, source, summary, {
          url: origin,
          title: 'Synthèse site',
          type: 'website_summary',
          site_origin: origin,
        });
        totalChunks += count;
        sources.push({ ...source, status: 'ready', chunk_count: count });
      }
    }
  } catch (e) {
    console.error('site summary', e.message);
  }

  return {
    ok: true,
    origin,
    pages_indexed: sources.filter((s) => s.title && !String(s.title).includes('Synthèse')).length,
    sources_total: sources.length,
    chunks: totalChunks,
    urls_tried: visited.size,
    errors: errors.slice(0, 10),
  };
}

async function synthesizeSiteSummary(siteText) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !siteText || siteText.length < 200) return null;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 1200,
      messages: [
        {
          role: 'system',
          content: `Tu analyses le site web d'une PME québécoise pour un agent SMS/chat.
Extrais UNIQUEMENT des faits présents dans le texte. Réponds en français québécois, structuré ainsi :
- Commerce (nom, type, zone desservie)
- Services et prix si mentionnés
- Horaires
- Adresse et téléphone
- Politiques (annulation, garantie, etc.)
- FAQ / infos fréquentes
- Liens utiles (réservation, soumission)
Pas de markdown. Pas d'invention.`,
        },
        { role: 'user', content: siteText.slice(0, 22000) },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return String(data.choices?.[0]?.message?.content || '').trim();
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

async function searchKnowledge(tenantId, query, limit = 5, threshold = 0.35) {
  const db = getAdmin();
  if (!db || !query || !process.env.OPENAI_API_KEY) return [];

  try {
    const embedding = await createEmbedding(query);
    const { data, error } = await db.rpc('match_knowledge_chunks', {
      p_tenant_id: tenantId,
      p_query_embedding: embedding,
      p_match_count: limit,
      p_match_threshold: threshold,
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
  ingestWebsite,
  discoverSiteUrls,
  normalizeUrl,
  shouldSkipCrawlUrl,
  pathScore,
  ingestFile,
  searchKnowledge,
  testRetrieval,
  findWebsitePhone,
  maybeFillPublicPhoneFromText,
  MAX_SITE_PAGES,
};
