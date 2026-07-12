const twilio = require('twilio');

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio non configuré');
  return twilio(sid, token);
}

function baseUrl() {
  const u = process.env.PUBLIC_BASE_URL;
  if (!u) throw new Error('PUBLIC_BASE_URL requis pour configurer les webhooks');
  return u.replace(/\/$/, '');
}

function guessAreaCode(tenant) {
  if (tenant.area_code) return String(tenant.area_code).replace(/\D/g, '').slice(0, 3);
  const pf = (tenant.existing_business_number || tenant.phone_forward || '').replace(/\D/g, '');
  if (pf.length >= 10 && pf.startsWith('1')) return pf.slice(1, 4);
  if (pf.length >= 10) return pf.slice(0, 3);
  const city = (tenant.city || '').toLowerCase();
  if (city.includes('montréal') || city.includes('montreal')) return '514';
  if (city.includes('laval')) return '450';
  return process.env.TWILIO_DEFAULT_AREA_CODE || '418';
}

const FALLBACK_AREA_CODES = ['418', '581', '438', '514', '450', '819', '873'];

async function findAvailableNumber(preferredArea) {
  const client = getClient();
  const codes = [preferredArea, ...FALLBACK_AREA_CODES.filter((c) => c !== preferredArea)];
  for (const areaCode of codes) {
    try {
      const nums = await client.availablePhoneNumbers('CA').local.list({
        areaCode,
        smsEnabled: true,
        voiceEnabled: true,
        limit: 5,
      });
      if (nums && nums.length) return nums[0];
    } catch (e) {
      console.warn('search area', areaCode, e.message);
    }
  }
  const any = await client.availablePhoneNumbers('CA').local.list({
    smsEnabled: true,
    voiceEnabled: true,
    limit: 1,
  });
  if (!any || !any.length) throw new Error('Aucun numéro disponible au Canada');
  return any[0];
}

async function configureNumber(sid) {
  const client = getClient();
  const b = baseUrl();
  return client.incomingPhoneNumbers(sid).update({
    smsUrl: `${b}/.netlify/functions/sms`,
    smsMethod: 'POST',
    voiceUrl: `${b}/.netlify/functions/voice`,
    voiceMethod: 'POST',
    friendlyName: 'NoviaAI Rattrapeur',
  });
}

async function purchaseAndConfigure(tenant) {
  const area = guessAreaCode(tenant);
  const available = await findAvailableNumber(area);
  const client = getClient();
  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: available.phoneNumber,
    friendlyName: `NoviaAI — ${tenant.business_name}`.slice(0, 64),
  });
  await configureNumber(purchased.sid);
  return {
    phoneNumber: purchased.phoneNumber,
    sid: purchased.sid,
    areaCode: area,
  };
}

async function releaseNumber(twilioSid) {
  // Par défaut on libère le numéro à l'annulation (coût Twilio). Opt-out: TWILIO_RELEASE_ON_CANCEL=false
  if (!twilioSid || process.env.TWILIO_RELEASE_ON_CANCEL === 'false') return;
  const client = getClient();
  try {
    await client.incomingPhoneNumbers(twilioSid).remove();
  } catch (e) {
    console.error('release number', e.message);
  }
}

module.exports = { purchaseAndConfigure, configureNumber, releaseNumber, guessAreaCode };
