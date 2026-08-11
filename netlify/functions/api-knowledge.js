const { json, parseJson, corsHeaders } = require('../../lib/http');
const { resolveTenantContext } = require('../../lib/tenant-context');
const {
  listSources, ingestUrl, ingestWebsite, ingestFile, deleteSource, testRetrieval,
} = require('../../lib/knowledge');
const { generateReply } = require('../../lib/ai');
const { rowToDossier } = require('../../lib/dossier-builder');

function looksLikeSiteRoot(url) {
  try {
    const u = new URL(url);
    const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return path === '/' || path.split('/').filter(Boolean).length <= 1;
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const ctx = await resolveTenantContext(event);
  if (!ctx.ok) return ctx.response;
  const tenant = ctx.tenant;

  try {
    if (event.httpMethod === 'GET') {
      const sources = await listSources(tenant.id);
      if (sources && sources.error === 'migration') {
        return json(200, {
          sources: [],
          migration_required: true,
          hint: 'Exécutez supabase/schema-v6-knowledge-base.sql dans Supabase',
        });
      }
      return json(200, { sources: sources || [] });
    }

    if (event.httpMethod === 'DELETE') {
      const body = parseJson(event);
      const sourceId = body.source_id || event.queryStringParameters?.id;
      if (!sourceId) return json(400, { error: 'source_id requis' });
      await deleteSource(tenant.id, sourceId);
      return json(200, { ok: true });
    }

    if (event.httpMethod === 'POST') {
      const body = parseJson(event);
      const action = body.action || 'import_url';

      if (action === 'import_url') {
        const url = (body.url || '').trim();
        if (!url) return json(400, { error: 'URL requise' });
        // Une URL "racine" → crawl profond ; une page précise → page seule.
        const deep = body.deep !== false && looksLikeSiteRoot(url);
        const result = deep
          ? await ingestWebsite(tenant.id, url, { maxPages: Number(body.max_pages) || 12, replace: !!body.replace })
          : await ingestUrl(tenant.id, url);
        return json(200, result);
      }

      if (action === 'analyze_website') {
        const url = (body.url || tenant.website_url || '').trim();
        if (!url) return json(400, { error: 'URL du site requise' });
        const result = await ingestWebsite(tenant.id, url, {
          maxPages: Math.min(20, Number(body.max_pages) || 16),
          replace: body.replace !== false,
        });
        return json(200, result);
      }

      if (action === 'import_file') {
        const fileName = (body.file_name || body.fileName || 'document.pdf').trim();
        const mimeType = (body.mime_type || body.mimeType || '').trim();
        const b64 = body.file_base64 || body.fileBase64;
        if (!b64) return json(400, { error: 'file_base64 requis' });
        const buffer = Buffer.from(b64, 'base64');
        const result = await ingestFile(tenant.id, { buffer, fileName, mimeType });
        return json(200, result);
      }

      if (action === 'test') {
        const question = (body.question || '').trim();
        if (!question) return json(400, { error: 'Question requise' });
        const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
        const retrieval = await testRetrieval(tenant.id, question);
        const dossier = rowToDossier(tenant);
        const reply = await generateReply(dossier, history, question, tenant.id);
        return json(200, {
          hits: retrieval.hits,
          reply: reply || null,
        });
      }

      return json(400, { error: 'Action inconnue' });
    }

    return json(405, { error: 'Méthode non supportée' });
  } catch (e) {
    console.error('api-knowledge', e);
    return json(500, { error: e.message || 'Erreur serveur' });
  }
};
