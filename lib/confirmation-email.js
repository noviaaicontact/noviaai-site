const { sendEmail } = require('./email');
const { readFileSync } = require('fs');
const { join } = require('path');

function loadConfirmationTemplate() {
  try {
    return readFileSync(join(__dirname, '..', 'supabase', 'email-template-confirm-signup.html'), 'utf8');
  } catch {
    return '';
  }
}

function renderConfirmationHtml(email, confirmationUrl) {
  const tpl = loadConfirmationTemplate();
  if (tpl) {
    return tpl
      .replace(/\{\{\s*\.Email\s*\}\}/g, email)
      .replace(/\{\{\s*\.ConfirmationURL\s*\}\}/g, confirmationUrl);
  }
  return `
    <h2>Confirmez votre compte NoviaAI</h2>
    <p>Bonjour, confirmez votre courriel <strong>${email}</strong>.</p>
    <p><a href="${confirmationUrl}">Confirmer mon compte NoviaAI</a></p>
  `;
}

async function sendSignupConfirmationEmail(email, confirmationUrl) {
  const html = renderConfirmationHtml(email, confirmationUrl);
  return sendEmail({
    to: email,
    subject: 'Confirmez votre compte NoviaAI',
    html,
  });
}

module.exports = { sendSignupConfirmationEmail, renderConfirmationHtml };
