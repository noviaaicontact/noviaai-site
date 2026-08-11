/**
 * Analyse complète du site web (background Netlify — jusqu'à ~15 min).
 * Déclenché après l'enregistrement du lien Site web dans Agent.
 */
const { parseJson, corsHeaders } = require('../../lib/http');
const { resolveTenantContext } = require('../../lib/tenant-context');
const { ingestWebsite } = require('../../lib/knowledge');
const { getAdmin } = require('../../lib/db');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'POST seulement' }) };
  }

  const ctx = await resolveTenantContext(event);
  if (!ctx.ok) return ctx.response;

  const body = parseJson(event);
  const url = String(body.url || ctx.tenant.website_url || '').trim();
  if (!url) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'URL du site requise' }),
    };
  }

  // Persister l'URL si fournie
  if (body.url && body.url !== ctx.tenant.website_url) {
    try {
      const db = getAdmin();
      if (db) {
        await db.from('tenants').update({
          website_url: url,
          updated_at: new Date().toISOString(),
        }).eq('id', ctx.tenant.id);
      }
    } catch (e) {
      console.error('website_url persist', e.message);
    }
  }

  try {
    const result = await ingestWebsite(ctx.tenant.id, url, {
      maxPages: Math.min(20, Number(body.max_pages) || 20),
      replace: true,
    });
    console.log('analyze-website done', ctx.tenant.id, result.pages_indexed, result.chunks);
    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (e) {
    console.error('analyze-website', e);
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'Analyse du site échouée' }),
    };
  }
};
