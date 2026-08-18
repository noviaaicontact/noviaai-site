// Transcription message vocal (Whisper) + extraction nom / téléphone / raison.

const { getAdmin, isDbConfigured } = require('./db');
const { logMessage } = require('./tenant');
const { logEvent } = require('./events');
const { touchThread } = require('./inbox');
const { saveThreadQualification } = require('./qualification');

function twilioAuthHeader() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

async function downloadTwilioRecording(recordingUrl) {
  const auth = twilioAuthHeader();
  if (!auth) throw new Error('Twilio non configuré');
  const url = `${String(recordingUrl).replace(/\/$/, '')}.mp3`;
  const res = await fetch(url, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`Téléchargement enregistrement échoué (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function transcribeAudio(buffer) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY manquant pour la transcription');

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/mpeg' }), 'voicemail.mp3');
  form.append('model', 'whisper-1');
  form.append('language', 'fr');
  form.append('response_format', 'json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return String(data.text || '').trim();
}

async function extractVoicemailFields(transcript, callerPhone) {
  const key = process.env.OPENAI_API_KEY;
  const fallback = {
    nom: '',
    telephone: callerPhone || '',
    raison: transcript.slice(0, 300),
  };
  if (!key || !transcript) return fallback;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Tu extrais des infos d'un message vocal laissé à une PME québécoise.
Retourne UNIQUEMENT un JSON: {"nom":"","telephone":"","raison":""}
- nom: prénom/nom du client s'il se présente, sinon ""
- telephone: numéro mentionné (format libre), sinon ""
- raison: sujet / problème / demande en 1-2 phrases courtes
N'invente rien. Numéro de l'appelant connu: ${callerPhone || 'inconnu'}.`,
          },
          { role: 'user', content: transcript },
        ],
        max_tokens: 200,
      }),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    return {
      nom: String(parsed.nom || '').trim().slice(0, 120),
      telephone: String(parsed.telephone || callerPhone || '').trim().slice(0, 40),
      raison: String(parsed.raison || transcript).trim().slice(0, 500),
    };
  } catch (e) {
    console.error('extractVoicemailFields', e.message);
    return fallback;
  }
}

function formatVoicemailMessage(transcript, extracted, durationSec) {
  const dur = durationSec ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}` : '';
  const lines = [`🎙 Message vocal${dur ? ` (${dur})` : ''}`, ''];
  if (transcript) lines.push(`« ${transcript} »`, '');
  const details = [];
  if (extracted.nom) details.push(`Nom : ${extracted.nom}`);
  if (extracted.telephone) details.push(`Tél. : ${extracted.telephone}`);
  if (extracted.raison) details.push(`Raison : ${extracted.raison}`);
  if (details.length) {
    lines.push('📋 ' + details.join(' · '));
  }
  return lines.join('\n').trim();
}

async function upsertMissedCallVoicemail(tenantId, callerPhone, patch) {
  if (!isDbConfigured() || !tenantId) return null;
  const db = getAdmin();
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: recent } = await db.from('missed_calls')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('caller_phone', callerPhone)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent?.id) {
    const { data } = await db.from('missed_calls').update(patch).eq('id', recent.id).select('id').single();
    return data;
  }
  const { data } = await db.from('missed_calls').insert({
    tenant_id: tenantId,
    caller_phone: callerPhone,
    textback_sent: true,
    ...patch,
  }).select('id').single();
  return data;
}

async function processVoicemailRecording({
  tenant,
  callerPhone,
  twilioNumber,
  recordingUrl,
  recordingSid,
  durationSec,
}) {
  if (!tenant?.id || !callerPhone || !recordingUrl) return null;

  let transcript = '';
  let extracted = { nom: '', telephone: callerPhone || '', raison: '' };

  try {
    const audio = await downloadTwilioRecording(recordingUrl);
    transcript = await transcribeAudio(audio);
    extracted = await extractVoicemailFields(transcript, callerPhone);
  } catch (e) {
    console.error('processVoicemailRecording', e.message);
    await logEvent(tenant.id, callerPhone, 'voicemail_error', { error: e.message, recordingSid });
    return null;
  }

  const body = formatVoicemailMessage(transcript, extracted, durationSec);

  await upsertMissedCallVoicemail(tenant.id, callerPhone, {
    recording_url: recordingUrl,
    recording_sid: recordingSid || null,
    recording_duration_sec: durationSec || null,
    transcript,
    extracted_data: extracted,
  });

  await logMessage(tenant.id, callerPhone, 'inbound', body);
  await touchThread(tenant.id, callerPhone, extracted.raison || transcript.slice(0, 120), 'lead');

  const qualData = {
    nom: extracted.nom || '',
    telephone: extracted.telephone || callerPhone || '',
    demande: extracted.raison || '',
  };
  Object.keys(qualData).forEach((k) => { if (!qualData[k]) delete qualData[k]; });
  if (Object.keys(qualData).length) {
    await saveThreadQualification(tenant.id, callerPhone, qualData, true);
  }

  await logEvent(tenant.id, callerPhone, 'voicemail_transcribed', {
    recordingSid,
    duration: durationSec,
    transcript: transcript.slice(0, 500),
    extracted,
  });

  if (extracted.raison || extracted.nom || transcript) {
    try {
      const { insertLead } = require('./agent-tools');
      const summary = [
        extracted.nom ? `Nom: ${extracted.nom}` : '',
        extracted.raison || transcript.slice(0, 200),
      ].filter(Boolean).join(' · ');
      await insertLead(tenant.id, callerPhone, summary, 'voicemail', qualData);
    } catch (e) {
      console.error('voicemail lead', e.message);
    }
  }

  try {
    const { sendVoicemailAlert } = require('./email');
    await sendVoicemailAlert(tenant, callerPhone, transcript, extracted, recordingUrl);
  } catch (e) {
    console.error('voicemail email', e.message);
  }

  return { transcript, extracted, body };
}

function buildVoicemailTwiml({ businessName, recordActionUrl }) {
  const name = String(businessName || 'Notre entreprise').slice(0, 80);
  const { escapeXml } = require('./twilio-util');
  return `<?xml version="1.0" encoding="UTF-8"?><Response>
  <Say language="fr-CA">${escapeXml(name)} est occupé en ce moment. Laissez votre message après le bip. Vous pouvez aussi répondre au texto que nous vous envoyons.</Say>
  <Record maxLength="120" timeout="6" playBeep="true" action="${escapeXml(recordActionUrl)}" method="POST" />
</Response>`;
}

module.exports = {
  downloadTwilioRecording,
  transcribeAudio,
  extractVoicemailFields,
  formatVoicemailMessage,
  processVoicemailRecording,
  buildVoicemailTwiml,
};
