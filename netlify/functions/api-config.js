const { json } = require('../../lib/http');
const { PLANS } = require('../../lib/plans');

exports.handler = async () => {
  return json(200, {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY),
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    twilioConfigured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    openaiConfigured: !!process.env.OPENAI_API_KEY,
    resendConfigured: !!process.env.RESEND_API_KEY,
    autoProvision: process.env.TWILIO_AUTO_PROVISION !== 'false',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
    plans: PLANS,
  });
};
