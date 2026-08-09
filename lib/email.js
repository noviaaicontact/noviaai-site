// Notifications courriel via Resend (https://resend.com) — gratuit pour démarrer.

async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'NoviaAI <onboarding@resend.dev>';
  if (!key || !to) {
    console.log('[email skip]', subject, '→', to);
    return { skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('email fail', err);
    throw new Error('Envoi courriel échoué');
  }
  return res.json();
}

function fmtPhone(p) {
  return p || 'Inconnu';
}

async function sendWelcomeEmail(tenant) {
  const to = tenant.contact_email || tenant.email;
  const num = tenant.twilio_number;
  const html = `
    <h2>Bienvenue chez NoviaAI, ${tenant.business_name}! 🎉</h2>
    <p>Votre ligne intelligente est <strong>active</strong>.</p>
    <p><strong>Numéro SMS / appels :</strong> ${num}</p>
    <p>Mettez ce numéro sur Google / votre site. Quand vous ne répondez pas, vos clients reçoivent un texto automatique avec votre message personnalisé.</p>
    <p><a href="${process.env.PUBLIC_BASE_URL || ''}/dashboard.html">Ouvrir mon tableau de bord</a></p>
  `;
  return sendEmail({ to, subject: `✅ Votre ligne NoviaAI est active — ${num}`, html });
}

function qualificationEmailBlock(qualHtml, message) {
  if (qualHtml) {
    return `<h3>Résumé client</h3>${qualHtml}${message ? `<p style="margin-top:12px"><strong>Notes :</strong> ${message}</p>` : ''}`;
  }
  return `<p><strong>Détails :</strong> ${message || '—'}</p>`;
}

async function sendLeadAlert(tenant, callerPhone, message, qualificationData, qualHtml) {
  const to = tenant.contact_email || tenant.email;
  const html = `
    <h2>Nouveau lead 📲</h2>
    <p><strong>Commerce :</strong> ${tenant.business_name}</p>
    <p><strong>De :</strong> ${fmtPhone(callerPhone)}</p>
    ${qualificationEmailBlock(qualHtml, message)}
    <p><a href="${process.env.PUBLIC_BASE_URL || ''}/conversations.html">Voir dans Conversations</a></p>
  `;
  return sendEmail({ to, subject: `Nouveau lead — ${tenant.business_name}`, html });
}

async function sendProvisioningFailedEmail(tenant, errMsg) {
  const admin = process.env.ADMIN_EMAIL || 'noviaai.contact@gmail.com';
  return sendEmail({
    to: admin,
    subject: `⚠️ Provisioning échoué — ${tenant.business_name}`,
    html: `<p>Tenant ${tenant.id}<br>Erreur: ${errMsg}</p>`,
  });
}

async function sendHostedSmsRequestEmail(tenant) {
  const admin = process.env.ADMIN_EMAIL || 'noviaai.contact@gmail.com';
  const num = tenant.existing_business_number || tenant.phone_forward || '—';
  const html = `
    <h2>📱 Demande portage Hosted SMS</h2>
    <p><strong>Commerce :</strong> ${tenant.business_name}</p>
    <p><strong>Contact :</strong> ${tenant.contact_email || tenant.email}</p>
    <p><strong>Numéro à porter :</strong> ${fmtPhone(num)}</p>
    <p><strong>Cellulaire propriétaire :</strong> ${fmtPhone(tenant.phone_forward)}</p>
    <p><strong>Tenant ID :</strong> ${tenant.id}</p>
    <p>Action : lancer Hosted SMS / portage Twilio, puis marquer hosted_status=active dans Supabase.</p>
  `;
  await sendEmail({ to: admin, subject: `Portage SMS — ${tenant.business_name}`, html });
  const clientEmail = tenant.contact_email || tenant.email;
  if (clientEmail) {
    await sendEmail({
      to: clientEmail,
      subject: `Demande de portage reçue — ${tenant.business_name}`,
      html: `
        <h2>On s'occupe de votre numéro</h2>
        <p>Nous avons bien reçu votre demande pour porter <strong>${fmtPhone(num)}</strong> sur NoviaAI.</p>
        <p>Notre équipe vous contacte sous <strong>48 h ouvrables</strong> pour finaliser le portage.</p>
        <p>En attendant, votre abonnement est actif — la ligne s'activera dès le portage complété.</p>
      `,
    });
  }
}

async function sendMissedCallAlert(tenant, callerPhone) {
  if (tenant.notify_email === false) return;
  const to = tenant.contact_email || tenant.email;
  const html = `
    <h2>Appel manqué rattrapé 📞</h2>
    <p>Un texto automatique a été envoyé à <strong>${fmtPhone(callerPhone)}</strong>.</p>
    <p>Consultez la conversation dans votre tableau de bord.</p>
  `;
  return sendEmail({ to, subject: `Appel manqué rattrapé — ${fmtPhone(callerPhone)}`, html });
}

async function sendVoicemailAlert(tenant, callerPhone, transcript, extracted, recordingUrl) {
  if (tenant.notify_email === false) return;
  const to = tenant.contact_email || tenant.email;
  const ex = extracted || {};
  const rows = [
    ex.nom ? `<tr><td style="padding:6px 12px 6px 0;font-weight:600">Nom</td><td>${String(ex.nom).replace(/</g, '&lt;')}</td></tr>` : '',
    (ex.telephone || callerPhone) ? `<tr><td style="padding:6px 12px 6px 0;font-weight:600">Téléphone</td><td>${fmtPhone(ex.telephone || callerPhone)}</td></tr>` : '',
    ex.raison ? `<tr><td style="padding:6px 12px 6px 0;font-weight:600">Raison</td><td>${String(ex.raison).replace(/</g, '&lt;')}</td></tr>` : '',
  ].filter(Boolean).join('');
  const html = `
    <h2>🎙 Message vocal transcrit</h2>
    <p><strong>Commerce :</strong> ${tenant.business_name}</p>
    <p><strong>De :</strong> ${fmtPhone(callerPhone)}</p>
    ${transcript ? `<p><strong>Transcription :</strong><br>« ${String(transcript).replace(/</g, '&lt;')} »</p>` : ''}
    ${rows ? `<h3>Infos extraites</h3><table style="border-collapse:collapse">${rows}</table>` : ''}
    <p><a href="${process.env.PUBLIC_BASE_URL || ''}/conversations.html">Voir dans Conversations</a></p>
  `;
  return sendEmail({ to, subject: `🎙 Message vocal — ${tenant.business_name}`, html });
}

async function sendAppointmentRequest(tenant, callerPhone, summary, qualificationData, qualHtml) {
  const to = tenant.contact_email || tenant.email;
  const html = `
    <h2>📅 Demande de rendez-vous (à confirmer)</h2>
    <p><strong>Commerce :</strong> ${tenant.business_name}</p>
    <p><strong>Client :</strong> ${fmtPhone(callerPhone)}</p>
    ${qualificationEmailBlock(qualHtml, summary)}
    <p><em>L'IA n'a PAS confirmé le RDV — contactez le client pour valider.</em></p>
    <p><a href="${process.env.PUBLIC_BASE_URL || ''}/conversations.html">Conversations</a></p>
  `;
  return sendEmail({ to, subject: `📅 RDV à confirmer — ${tenant.business_name}`, html });
}

async function sendHumanTransferAlert(tenant, callerPhone, reason, summary, qualificationData, qualHtml) {
  const to = tenant.contact_email || tenant.email;
  const html = `
    <h2>🙋 Transfert à un humain</h2>
    <p><strong>Commerce :</strong> ${tenant.business_name}</p>
    <p><strong>Client :</strong> ${fmtPhone(callerPhone)}</p>
    <p><strong>Raison :</strong> ${reason}</p>
    ${qualificationEmailBlock(qualHtml, summary)}
    <p><em>L'IA a escaladé — le client attend un rappel.</em></p>
    <p><a href="${process.env.PUBLIC_BASE_URL || ''}/conversations.html">Répondre via Conversations</a></p>
  `;
  return sendEmail({ to, subject: `🙋 Client à rappeler — ${tenant.business_name}`, html });
}

/** Libellés lisibles pour les tranches du formulaire /potentiel. */
const QUALIF_LABELS = {
  sector: {
    esthetique: 'Esthétique', coiffure: 'Coiffure', construction: 'Construction',
    nettoyage: 'Nettoyage', garage: 'Garage / automobile',
    'services-pro': 'Services professionnels', autre: 'Autre',
  },
  calls: {
    '0-20': '0 à 20', '21-50': '21 à 50', '51-100': '51 à 100',
    '101-200': '101 à 200', '200+': '200 +',
  },
  missed: {
    '0-5': '0 à 5', '6-10': '6 à 10', '11-20': '11 à 20',
    '21-50': '21 à 50', '50+': '50 +',
  },
  value: {
    'moins-100': 'Moins de 100 $', '100-250': '100 à 250 $', '250-500': '250 à 500 $',
    '500-1000': '500 à 1 000 $', '1000+': '1 000 $ +',
  },
  intent: {
    'oui-absolument': '🔥 Oui, absolument',
    'oui-en-savoir-plus': '👍 Oui, veut en savoir plus',
    curieux: '👀 Simplement curieux',
  },
};

function esc(v) {
  return String(v == null ? '—' : v).replace(/</g, '&lt;');
}

function qualifRow(label, value) {
  return `<tr><td style="padding:7px 14px 7px 0;font-weight:600;white-space:nowrap">${label}</td><td style="padding:7px 0">${esc(value)}</td></tr>`;
}

/** Nouveau prospect issu du formulaire de qualification /potentiel (pubs Meta). */
async function sendMarketingLeadAlert(lead, estimate) {
  const to = process.env.ADMIN_EMAIL || 'noviaai.contact@gmail.com';
  const L = QUALIF_LABELS;
  const utm = lead.utm || {};
  const origin = [utm.source, utm.campaign, utm.content].filter(Boolean).join(' · ') || 'direct';
  const monthly = estimate && estimate.monthly ? `${estimate.monthly} $ / mois` : '—';

  const html = `
    <h2>🎯 Nouveau prospect qualifié</h2>
    <p><strong>${esc(lead.business_name)}</strong> — ${esc(L.sector[lead.sector] || lead.sector)}</p>
    <table style="border-collapse:collapse;font-size:14px">
      ${qualifRow('Contact', `${lead.first_name} ${lead.last_name}`)}
      ${qualifRow('Téléphone', lead.phone)}
      ${qualifRow('Courriel', lead.email)}
      ${qualifRow('Appels reçus / mois', L.calls[lead.calls_per_month] || lead.calls_per_month)}
      ${qualifRow('Appels manqués / mois', L.missed[lead.missed_calls_per_month] || lead.missed_calls_per_month)}
      ${qualifRow('Valeur d\'un client', L.value[lead.avg_client_value] || lead.avg_client_value)}
      ${qualifRow('Intérêt', L.intent[lead.intent] || lead.intent)}
      ${qualifRow('Estimation montrée', monthly)}
      ${qualifRow('Provenance', origin)}
    </table>
    <p style="margin-top:18px">
      <a href="tel:${esc(lead.phone)}" style="background:#c8f135;color:#0b1f3b;padding:11px 16px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Appeler maintenant</a>
    </p>
    <p style="font-size:13px;color:#889">Consentement au contact reçu le ${esc(lead.consent_at)}.</p>
  `;

  return sendEmail({
    to,
    subject: `🎯 Prospect — ${lead.business_name} (${monthly})`,
    html,
  });
}

function formatDateFr(isoOrUnix) {
  if (!isoOrUnix) return null;
  const d = typeof isoOrUnix === 'number'
    ? new Date(isoOrUnix * 1000)
    : new Date(isoOrUnix);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('fr-CA', {
    timeZone: 'America/Toronto',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Rappel ~3 jours avant la fin de l'essai (webhook Stripe trial_will_end).
 * @param {object} tenant
 * @param {{ trialEndsAt?: string|number, portalUrl?: string, amountLabel?: string }} opts
 */
async function sendTrialEndingEmail(tenant, opts = {}) {
  const to = tenant.contact_email || tenant.email;
  if (!to) return { skipped: true };
  const base = (process.env.PUBLIC_BASE_URL || 'https://noviaai.ca').replace(/\/$/, '');
  const dateLabel = formatDateFr(opts.trialEndsAt || tenant.trial_ends_at) || 'dans quelques jours';
  const amount = opts.amountLabel || '299 $ CAD';
  const planName = opts.planLabel || 'Croissance';
  const reco = opts.recommendationHtml || '';
  const manageUrl = opts.portalUrl || `${base}/dashboard.html`;
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#0b1f3b">
      <h2 style="margin:0 0 12px">Votre essai NoviaAI se termine bientôt</h2>
      <p>Bonjour${tenant.business_name ? ` — <strong>${tenant.business_name}</strong>` : ''},</p>
      <p>Votre essai gratuit se termine le <strong>${dateLabel}</strong>.</p>
      ${reco}
      <p>Après cette date, votre forfait ${planName} (<strong>${amount}/mois</strong>) sera prélevé automatiquement sur la carte enregistrée — aucun autre geste requis pour garder votre ligne active.</p>
      <p style="margin:24px 0">
        <a href="${manageUrl}" style="background:#c8f135;color:#0b1f3b;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
          Gérer mon abonnement
        </a>
      </p>
      <p style="font-size:14px;color:#556">Vous pouvez annuler en un clic avant la fin de l'essai. Aucun montant ne sera prélevé si vous annulez à temps.</p>
      <p style="font-size:13px;color:#889"><a href="${base}/dashboard.html" style="color:#0b1f3b">Ouvrir mon tableau de bord</a></p>
    </div>
  `;
  return sendEmail({
    to,
    subject: `Rappel : prélèvement NoviaAI le ${dateLabel}`,
    html,
  });
}

/**
 * Paiement refusé — invite à mettre à jour la carte.
 * @param {object} tenant
 * @param {{ portalUrl?: string, amountLabel?: string }} opts
 */
async function sendPaymentFailedEmail(tenant, opts = {}) {
  const to = tenant.contact_email || tenant.email;
  if (!to) return { skipped: true };
  const base = (process.env.PUBLIC_BASE_URL || 'https://noviaai.ca').replace(/\/$/, '');
  const manageUrl = opts.portalUrl || `${base}/dashboard.html`;
  const amount = opts.amountLabel || '299 $ CAD';
  const planName = opts.planLabel || 'Croissance';
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#0b1f3b">
      <h2 style="margin:0 0 12px">Paiement NoviaAI non abouti</h2>
      <p>Bonjour${tenant.business_name ? ` — <strong>${tenant.business_name}</strong>` : ''},</p>
      <p>Nous n'avons pas pu prélever votre forfait ${planName} (<strong>${amount}/mois</strong>). Votre ligne reste active temporairement, mais elle sera suspendue si le paiement n'est pas régularisé.</p>
      <p style="margin:24px 0">
        <a href="${manageUrl}" style="background:#c8f135;color:#0b1f3b;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
          Mettre à jour ma carte
        </a>
      </p>
      <p style="font-size:14px;color:#556">Besoin d'aide? Répondez à ce courriel — on est là.</p>
    </div>
  `;
  return sendEmail({
    to,
    subject: `Action requise — paiement NoviaAI refusé`,
    html,
  });
}

/**
 * Reçu après un paiement réussi (facture Stripe amount_paid > 0).
 * @param {object} tenant
 * @param {{ amountLabel?: string, invoiceUrl?: string, portalUrl?: string, periodLabel?: string }} opts
 */
async function sendPaymentReceiptEmail(tenant, opts = {}) {
  const to = tenant.contact_email || tenant.email;
  if (!to) return { skipped: true };
  const base = (process.env.PUBLIC_BASE_URL || 'https://noviaai.ca').replace(/\/$/, '');
  const amount = opts.amountLabel || '299 $ CAD';
  const planName = opts.planLabel || 'Croissance';
  const manageUrl = opts.portalUrl || `${base}/dashboard.html`;
  const invoiceBtn = opts.invoiceUrl
    ? `<p style="margin:16px 0 0"><a href="${opts.invoiceUrl}" style="color:#0b1f3b">Voir la facture Stripe (PDF)</a></p>`
    : '';
  const period = opts.periodLabel ? `<p>Période : <strong>${opts.periodLabel}</strong></p>` : '';
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#0b1f3b">
      <h2 style="margin:0 0 12px">Paiement reçu — merci!</h2>
      <p>Bonjour${tenant.business_name ? ` — <strong>${tenant.business_name}</strong>` : ''},</p>
      <p>Nous confirmons la réception de votre paiement NoviaAI ${planName} : <strong>${amount}</strong>.</p>
      ${period}
      <p>Votre ligne et votre agent restent actifs. Vous pouvez gérer votre abonnement en tout temps :</p>
      <p style="margin:24px 0">
        <a href="${manageUrl}" style="background:#c8f135;color:#0b1f3b;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
          Gérer mon abonnement
        </a>
      </p>
      ${invoiceBtn}
      <p style="font-size:13px;color:#889;margin-top:24px"><a href="${base}/dashboard.html" style="color:#0b1f3b">Ouvrir mon tableau de bord</a></p>
    </div>
  `;
  return sendEmail({
    to,
    subject: `Reçu NoviaAI — ${amount}`,
    html,
  });
}

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendLeadAlert,
  sendProvisioningFailedEmail,
  sendHostedSmsRequestEmail,
  sendMissedCallAlert,
  sendVoicemailAlert,
  sendAppointmentRequest,
  sendHumanTransferAlert,
  sendMarketingLeadAlert,
  sendTrialEndingEmail,
  sendPaymentFailedEmail,
  sendPaymentReceiptEmail,
};
