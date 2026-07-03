const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getUserFromRequest } = require('../../lib/auth');
const { getTenantByUserId } = require('../../lib/tenant');
const { listSources, ingestUrl, ingestFile, deleteSource, testRetrieval } = require('../../lib/knowledge');
const { generateReply } = require('../../lib/ai');
const { rowToDossier } = require('../../lib/dossier-builder');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const user = await getUserFromRequest(event);
  if (!user) return json(401, { error: 'Non authentifié' });

  const tenant = await getTenantByUserId(user.id);
  if (!tenant) return json(404, { error: 'Commerce introuvable' });

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
        const result = await ingestUrl(tenant.id, url);
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
        const retrieval = await testRetrieval(tenant.id, question);
        const dossier = rowToDossier(tenant);
        const reply = await generateReply(dossier, [], question, tenant.id);
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
