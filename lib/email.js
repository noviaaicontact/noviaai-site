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
};
