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

async function sendLeadAlert(tenant, callerPhone, message) {
  const to = tenant.contact_email || tenant.email;
  const html = `
    <h2>Nouveau lead 📲</h2>
    <p><strong>Commerce :</strong> ${tenant.business_name}</p>
    <p><strong>De :</strong> ${fmtPhone(callerPhone)}</p>
    <p><strong>Message :</strong> ${message}</p>
    <p><a href="${process.env.PUBLIC_BASE_URL || ''}/dashboard.html">Voir dans le tableau de bord</a></p>
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

async function sendAppointmentRequest(tenant, callerPhone, summary) {
  const to = tenant.contact_email || tenant.email;
  const html = `
    <h2>📅 Demande de rendez-vous (à confirmer)</h2>
    <p><strong>Commerce :</strong> ${tenant.business_name}</p>
    <p><strong>Client :</strong> ${fmtPhone(callerPhone)}</p>
    <p><strong>Détails :</strong> ${summary}</p>
    <p><em>L'IA n'a PAS confirmé le RDV — contactez le client pour valider.</em></p>
    <p><a href="${process.env.PUBLIC_BASE_URL || ''}/dashboard.html">Tableau de bord</a></p>
  `;
  return sendEmail({ to, subject: `📅 RDV à confirmer — ${tenant.business_name}`, html });
}

async function sendHumanTransferAlert(tenant, callerPhone, reason, summary) {
  const to = tenant.contact_email || tenant.email;
  const html = `
    <h2>🙋 Transfert à un humain</h2>
    <p><strong>Commerce :</strong> ${tenant.business_name}</p>
    <p><strong>Client :</strong> ${fmtPhone(callerPhone)}</p>
    <p><strong>Raison :</strong> ${reason}</p>
    <p><strong>Résumé :</strong> ${summary}</p>
    <p><em>L'IA a escaladé — le client attend un rappel.</em></p>
    <p><a href="${process.env.PUBLIC_BASE_URL || ''}/dashboard.html">Répondre via le tableau de bord</a></p>
  `;
  return sendEmail({ to, subject: `🙋 Client à rappeler — ${tenant.business_name}`, html });
}

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendLeadAlert,
  sendProvisioningFailedEmail,
  sendMissedCallAlert,
  sendAppointmentRequest,
  sendHumanTransferAlert,
};
