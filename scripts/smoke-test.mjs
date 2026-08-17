/**
 * Tests unitaires rapides (sans réseau) — logique critique du SaaS.
 * Usage: npm test
 */
import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { shouldSendTextback } = require('../lib/voice-callback.js');
const { monthlyLimit, FAIR_USE_SMS } = require('../lib/usage-limits.js');
const { normalizePlan, PLANS, DEFAULT_PLAN } = require('../lib/plans.js');
const { resolveCustomerPhone, toE164, isTestCaller } = require('../lib/phone-util.js');
const { USER_PATCHABLE_FIELDS, pickPatch } = require('../lib/tenant.js');
const { validateOnboarding, formToTenantPayload, settingsToTenantPayload } = require('../lib/dossier-builder.js');
const { withAiBudget, buildTimeoutFallback } = require('../lib/ai.js');
const {
  applyCalendarConfirmationToReply,
  looksLikeScheduling,
  maybeCreateCalendarEvent,
  buildEventPayload,
  startConnect,
  assertOAuthCallbackSession,
} = require('../lib/calendar/index.js');
const { buildOpenSlots, parseAcceptedSlot, extractAcceptedSlot, assistantRejectedSlot, stripCalendarClaims } = require('../lib/calendar/slots.js');
const { getConversations, getThreadMessages } = require('../lib/inbox.js');
const { textbackMessage } = require('../lib/sms-send.js');
const { validateTwilioRequest } = require('../lib/twilio-util.js');
const { authorizeCron, isNetlifySchedulerEvent, withCronSecret } = require('../lib/cron-auth.js');
const { parseHttpUrl, isBlockedHostname } = require('../lib/ssrf.js');
const { encryptSecret, decryptSecret, tryDecryptSecret } = require('../lib/calendar/crypto.js');
const { isProductionEnv } = require('../lib/runtime-env.js');
const { dbPatchAfterCheckoutCreate, tenantPatchFromCheckoutSession } = require('../lib/stripe.js');
const {
  planCalendarBooking,
  resolveBookingAction,
  shouldCreateCalendarEvent,
  formatServicesForPrompt,
  normalizeServices,
} = require('../lib/service-workflows.js');

function restoreEnv(name, prev) {
  if (prev === undefined || prev === null) delete process.env[name];
  else process.env[name] = prev;
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed += 1;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    failed += 1;
  }
}

const VALID_ONBOARDING = {
  business_name: 'Spa Test',
  city: 'Lévis',
  phone_forward: '4185551234',
  missed_call_sms: 'Désolé d\'avoir manqué votre appel, comment puis-je aider?',
  area_code: '418',
  line_mode: 'new',
  hours: { lundi: { ouvert: true, debut: '9h', fin: '17h' } },
};

console.log('\n🧪 NoviaAI smoke tests\n');

await test('shouldSendTextback: no-answer → SMS', () => {
  assert.strictEqual(shouldSendTextback('no-answer', '0', 'false'), true);
});

await test('shouldSendTextback: boîte vocale courte → SMS', () => {
  assert.strictEqual(shouldSendTextback('completed', '8', 'false'), true);
});

await test('shouldSendTextback: vraie conversation → pas de SMS', () => {
  assert.strictEqual(shouldSendTextback('completed', '45', 'true'), false);
});

await test('monthlyLimit Pro = 750 conversations', () => {
  assert.strictEqual(monthlyLimit('pro'), 750);
  assert.strictEqual(monthlyLimit('essentiel'), 50);
  assert.strictEqual(FAIR_USE_SMS, 750);
});

await test('normalizePlan: starter → essentiel, inconnu → croissance', () => {
  assert.strictEqual(normalizePlan('starter'), 'essentiel');
  assert.strictEqual(normalizePlan(null), DEFAULT_PLAN);
  assert.ok(PLANS.pro);
});

await test('resolveCustomerPhone: public_phone prioritaire', () => {
  const phone = resolveCustomerPhone({
    public_phone: '418-836-3138',
    twilio_number: '+15814996602',
    phone_forward: '581-909-5332',
  });
  assert.ok(phone.includes('418') || phone.includes('836'));
});

await test('toE164: ne transforme pas un test widget en faux numéro', () => {
  assert.strictEqual(toE164('web:w_test_calendar_coupe_mswb1e6i'), null);
  assert.strictEqual(toE164('test:agent'), null);
  assert.strictEqual(toE164('+14185551212'), '+14185551212');
  assert.ok(isTestCaller('web:w_test_human_urgence_abc'));
  assert.ok(isTestCaller('test:agent'));
  assert.ok(!isTestCaller('web:client-session-xyz'));
  assert.ok(!isTestCaller('+14185551212'));
});

await test('textback: SMS d\'appel manqué inchangé', () => {
  const msg = textbackMessage({
    scripts: { texto_rappel: 'On a manqué votre appel — répondez ici.' },
    identite_agent: { nom_agent: 'Léa' },
  });
  assert.strictEqual(msg, 'On a manqué votre appel — répondez ici.');
});

await test('validateOnboarding: payload vide refusé', () => {
  const check = validateOnboarding({});
  assert.strictEqual(check.ok, false);
  assert.ok(check.errors.length >= 4);
  assert.strictEqual(formToTenantPayload({}).onboarding_done, false);
});

await test('validateOnboarding: payload complet accepté', () => {
  const check = validateOnboarding(VALID_ONBOARDING);
  assert.strictEqual(check.ok, true, check.errors.join(' '));
  assert.strictEqual(formToTenantPayload(VALID_ONBOARDING).onboarding_done, true);
});

await test('validateOnboarding: défauts starter ne suffisent pas', () => {
  const partial = {
    business_name: 'Spa Test',
    city: 'Lévis',
    phone_forward: '4185551234',
    area_code: '418',
    line_mode: 'new',
  };
  assert.strictEqual(validateOnboarding(partial).ok, false);
  assert.strictEqual(formToTenantPayload(partial).onboarding_done, false);
});

await test('validateOnboarding: hosted sans indicatif OK', () => {
  const hosted = { ...VALID_ONBOARDING, line_mode: 'hosted', area_code: '' };
  assert.strictEqual(validateOnboarding(hosted).ok, true, validateOnboarding(hosted).errors.join(' '));
});

await test('validateOnboarding: aucun jour ouvert refusé', () => {
  const closed = {
    ...VALID_ONBOARDING,
    hours: { lundi: { ouvert: false }, mardi: { ouvert: false } },
  };
  assert.strictEqual(validateOnboarding(closed).ok, false);
});

await test('applyCalendarConfirmationToReply: confirme seulement si créé', () => {
  const slot = {
    start: '2026-08-18T18:00:00.000Z',
    end: '2026-08-18T18:30:00.000Z',
  };
  const ok = applyCalendarConfirmationToReply({
    reply: 'Le créneau est libre.',
    tenant: { business_name: 'Spa Test' },
    booking: { ok: true, slot },
    userMessage: 'Oui demain 14h',
  });
  assert.strictEqual(ok.calendarConfirmed, true);
  assert.match(ok.reply, /confirmé dans l'agenda/i);
});

await test('applyCalendarConfirmationToReply: sinon la PME doit confirmer', () => {
  const adj = applyCalendarConfirmationToReply({
    reply: "C'est confirmé, je vous ai inscrit à l'agenda demain.",
    tenant: { business_name: 'Spa Test' },
    booking: { skipped: 'create_failed' },
    userMessage: 'Oui demain 14h',
    aiReply: "C'est confirmé, je vous ai inscrit à l'agenda demain.",
  });
  assert.strictEqual(adj.calendarConfirmed, false);
  assert.match(adj.reply, /vous confirmera/i);
  assert.ok(!/c['']est confirmé/i.test(adj.reply));
});

await test('applyCalendarConfirmationToReply: timeout sans RDV ne parle pas de rendez-vous', () => {
  const adj = applyCalendarConfirmationToReply({
    reply: 'Un instant, Léa de Spa Test vous revient tout de suite.',
    tenant: { business_name: 'Spa Test' },
    booking: { skipped: 'timeout' },
    userMessage: 'Allo',
  });
  assert.strictEqual(adj.calendarConfirmed, false);
  assert.ok(!/confirmera ce rendez-vous/i.test(adj.reply));
});

await test('calendrier: une demande d\'heure n\'est pas une acceptation', () => {
  const hours = { lundi: { ouvert: true, debut: '9h', fin: '17h' } };
  assert.strictEqual(extractAcceptedSlot({
    userMessage: 'Je voudrais une coupe lundi à 10h',
    hours,
    durationMin: 30,
  }), null);
  assert.ok(extractAcceptedSlot({
    userMessage: 'Oui je prends lundi 10h',
    hours,
    durationMin: 30,
  }));
});

await test('calendrier: si l\'IA dit que c\'est pris, on ne confirme pas', () => {
  assert.strictEqual(assistantRejectedSlot('Le créneau de lundi à 10h est déjà pris. Voici 9h.'), true);
  assert.strictEqual(assistantRejectedSlot('Le créneau est libre, dites-moi si ça vous va.'), false);
  const adj = applyCalendarConfirmationToReply({
    reply: 'Le créneau de lundi à 10h est déjà pris. Voici 9h, 12h.',
    tenant: { business_name: 'garage', id: 'tenant-test' },
    booking: { skipped: 'ai_rejected' },
    userMessage: 'Je voudrais une coupe lundi à 10h',
    offeredSlots: [
      { start: '2026-08-17T13:00:00.000Z', end: '2026-08-17T13:30:00.000Z' },
    ],
  });
  assert.strictEqual(adj.calendarConfirmed, false);
  assert.match(adj.reply, /n'est pas libre/i);
  assert.match(adj.reply, /plages libres/i);
  assert.ok(!/confirmé dans l'agenda/i.test(adj.reply));
  assert.ok(!/déjà pris/i.test(adj.reply));
  assert.ok(!/vous confirmera/i.test(adj.reply));
});

await test('calendrier: seuls les faits backend parlent de l\'agenda', () => {
  assert.ok(!stripCalendarClaims('Le créneau est déjà pris. Bonjour Test.').match(/déjà pris/i));
  const wish = applyCalendarConfirmationToReply({
    reply: 'Bonjour Test NoviaAI! Le créneau de lundi à 10h est déjà pris.\n- Lundi à 9h00\n- Lundi à 12h00',
    tenant: { business_name: 'garage' },
    booking: null,
    userMessage: 'Je voudrais une coupe lundi à 10h',
    bookingAction: { create: true, action: 'create_calendar' },
    offeredSlots: [
      { start: '2026-08-17T13:00:00.000Z', end: '2026-08-17T13:30:00.000Z' },
    ],
  });
  assert.strictEqual(wish.calendarConfirmed, false);
  assert.match(wish.reply, /plages libres/i);
  assert.ok(!/déjà pris/i.test(wish.reply));
  assert.ok(!/confirmé dans l'agenda/i.test(wish.reply));

  const booked = applyCalendarConfirmationToReply({
    reply: 'Je suis désolée, c\'est déjà pris.',
    tenant: { business_name: 'garage' },
    booking: {
      ok: true,
      slot: { start: '2026-08-17T13:00:00.000Z', end: '2026-08-17T13:30:00.000Z' },
    },
    userMessage: 'Oui je prends lundi 9h',
  });
  assert.strictEqual(booked.calendarConfirmed, true);
  assert.match(booked.reply, /confirmé dans l'agenda/i);
  assert.ok(!/déjà pris/i.test(booked.reply));
});

await test('Google Calendar: helpers toujours branchés', () => {
  assert.strictEqual(typeof maybeCreateCalendarEvent, 'function');
  assert.ok(looksLikeScheduling('je veux un rdv demain 14h'));
  assert.ok(!looksLikeScheduling('merci beaucoup'));
});

await test('buildTimeoutFallback: jamais le welcome_sms hors contexte', () => {
  const welcome = 'Bonjour! Comment puis-je vous aider?';
  const mid = buildTimeoutFallback({
    tenant: { agent_name: 'Léa', business_name: 'Spa Sansouci', welcome_sms: welcome },
    userMessage: 'ok merci',
    priorAssistantCount: 2,
  });
  assert.ok(!/comment puis-je vous aider/i.test(mid));
  assert.match(mid, /un instant|revient tout de suite/i);

  const first = buildTimeoutFallback({
    tenant: { agent_name: 'Léa', business_name: 'Spa Sansouci', welcome_sms: welcome },
    userMessage: 'Allo',
    priorAssistantCount: 0,
  });
  assert.ok(!/comment puis-je vous aider/i.test(first));
  assert.ok(!first.includes(welcome));

  const rdv = buildTimeoutFallback({
    tenant: { agent_name: 'Léa', business_name: 'Spa Sansouci', welcome_sms: welcome },
    userMessage: 'Je veux un rdv demain 14h',
    priorAssistantCount: 1,
  });
  assert.match(rdv, /confirmera/i);
  assert.ok(!/comment puis-je vous aider/i.test(rdv));
});

await test('withAiBudget: timeout → null, succès → valeur', async () => {
  const timedOut = await withAiBudget(new Promise((resolve) => setTimeout(() => resolve('late'), 80)), 15);
  assert.strictEqual(timedOut, null);
  const ok = await withAiBudget(Promise.resolve('hello'), 50);
  assert.strictEqual(ok, 'hello');
});

await test('isolation: getConversations sans tenantId → []', async () => {
  assert.deepStrictEqual(await getConversations(null), []);
  assert.deepStrictEqual(await getConversations(''), []);
  const thread = await getThreadMessages(null, '+14185551212');
  assert.deepStrictEqual(thread.messages, []);
  assert.strictEqual(thread.thread, null);
});

const SERVICE_SET = [
  { nom: 'Coiffure', prix: '45$', booking_mode: 'calendar', duration_minutes: 30 },
  { nom: 'Coloration', prix: '120$', booking_mode: 'calendar', duration_minutes: 120 },
  { nom: 'Estimation toiture', booking_mode: 'estimate', duration_minutes: 120 },
  { nom: 'Fresha', booking_mode: 'external_link', booking_url: 'https://fresha.com/salon-demo' },
  { nom: 'Urgence plomberie', booking_mode: 'human' },
];

await test('booking_mode calendar: crée un événement, durée 30', () => {
  const plan = planCalendarBooking({
    services: SERVICE_SET,
    userMessage: 'Je veux une coiffure demain',
    qualificationData: { nom: 'Marie' },
    calendarConnected: true,
    businessName: 'Salon Test',
  });
  assert.strictEqual(plan.create, true);
  assert.strictEqual(plan.action.booking_mode, 'calendar');
  assert.strictEqual(plan.durationMin, 30);
  assert.match(plan.eventSummary, /^RDV — Marie — Coiffure/);
  assert.strictEqual(shouldCreateCalendarEvent('calendar'), true);
});

await test('booking_mode estimate: crée un événement 120 min avec titre Estimation', () => {
  const plan = planCalendarBooking({
    services: SERVICE_SET,
    userMessage: 'Je veux une estimation toiture',
    qualificationData: { nom: 'Jean Tremblay' },
    calendarConnected: true,
  });
  assert.strictEqual(plan.create, true);
  assert.strictEqual(plan.action.booking_mode, 'estimate');
  assert.strictEqual(plan.durationMin, 120);
  assert.strictEqual(plan.eventSummary, 'Estimation — Estimation toiture — Jean Tremblay');
  const payload = buildEventPayload(
    { business_name: 'Toiture QC' },
    '+14185550101',
    { nom: 'Jean Tremblay' },
    { start: '2026-08-18T18:00:00.000Z', end: '2026-08-18T20:00:00.000Z' },
    plan.action,
  );
  assert.strictEqual(payload.summary, 'Estimation — Estimation toiture — Jean Tremblay');
  assert.strictEqual(new Date(payload.end) - new Date(payload.start), 120 * 60 * 1000);
});

await test('booking_mode external_link: aucun événement', async () => {
  const plan = planCalendarBooking({
    services: SERVICE_SET,
    userMessage: 'Je veux réserver sur Fresha',
    calendarConnected: true,
  });
  assert.strictEqual(plan.create, false);
  assert.strictEqual(plan.skipped, 'external_link');
  const gated = await maybeCreateCalendarEvent({
    tenant: { id: 'tenant-a', services: SERVICE_SET, business_name: 'Salon' },
    callerPhone: '+14185550101',
    userMessage: 'Je veux réserver sur Fresha',
  });
  assert.ok(gated);
  assert.strictEqual(gated.skipped, 'external_link');
  assert.ok(!gated.ok);
});

await test('booking_mode human: aucun événement', async () => {
  const plan = planCalendarBooking({
    services: SERVICE_SET,
    userMessage: 'C\'est une urgence plomberie',
    calendarConnected: true,
  });
  assert.strictEqual(plan.create, false);
  assert.strictEqual(plan.skipped, 'human');
  const gated = await maybeCreateCalendarEvent({
    tenant: { id: 'tenant-a', services: SERVICE_SET },
    callerPhone: '+14185550101',
    userMessage: 'Urgence plomberie svp',
  });
  assert.strictEqual(gated.skipped, 'human');
  assert.ok(!gated.ok);
});

await test('durées différentes: 30 vs 120 minutes avec la même action', () => {
  const hours = {
    lundi: { ouvert: true, debut: '9h', fin: '17h' },
    mardi: { ouvert: true, debut: '9h', fin: '17h' },
    mercredi: { ouvert: true, debut: '9h', fin: '17h' },
    jeudi: { ouvert: true, debut: '9h', fin: '17h' },
    vendredi: { ouvert: true, debut: '9h', fin: '17h' },
    samedi: { ouvert: true, debut: '9h', fin: '17h' },
    dimanche: { ouvert: true, debut: '9h', fin: '17h' },
  };
  const from = new Date('2026-08-16T16:00:00.000Z');
  const slots30 = buildOpenSlots(hours, from, 30);
  const slots120 = buildOpenSlots(hours, from, 120);
  assert.ok(slots30.length && slots120.length);
  assert.strictEqual(new Date(slots30[0].end) - new Date(slots30[0].start), 30 * 60 * 1000);
  assert.strictEqual(new Date(slots120[0].end) - new Date(slots120[0].start), 120 * 60 * 1000);
  const color = resolveBookingAction({
    services: SERVICE_SET,
    userMessage: 'Je veux une coloration',
    calendarConnected: true,
  });
  const coupe = resolveBookingAction({
    services: SERVICE_SET,
    userMessage: 'Je veux une coiffure',
    calendarConnected: true,
  });
  assert.strictEqual(color.action, 'create_calendar');
  assert.strictEqual(coupe.action, 'create_calendar');
  assert.strictEqual(color.action, coupe.action);
  assert.strictEqual(color.durationMin, 120);
  assert.strictEqual(coupe.durationMin, 30);
  const parsedColor = parseAcceptedSlot('demain 14h', hours, from, color.durationMin);
  const parsedCoupe = parseAcceptedSlot('demain 14h', hours, from, coupe.durationMin);
  assert.ok(parsedColor && parsedCoupe);
  assert.strictEqual(new Date(parsedColor.end) - new Date(parsedColor.start), 120 * 60 * 1000);
  assert.strictEqual(new Date(parsedCoupe.end) - new Date(parsedCoupe.start), 30 * 60 * 1000);
  const planColor = planCalendarBooking({ bookingAction: color, qualificationData: { nom: 'Marie' } });
  const planCoupe = planCalendarBooking({
    bookingAction: coupe,
    qualificationData: { nom: 'Marie' },
    userMessage: 'Je veux une coloration',
    services: SERVICE_SET,
  });
  assert.strictEqual(planColor.create, true);
  assert.strictEqual(planCoupe.create, true);
  assert.strictEqual(planColor.durationMin, 120);
  assert.strictEqual(planCoupe.durationMin, 30);
  assert.strictEqual(planCoupe.action.service.nom, 'Coiffure');
});

await test('fallback anciens services sans booking_mode', () => {
  const legacy = [{ nom: 'Coupe femme', prix: '45$', description_courte: 'Coupe femme' }];
  const saved = normalizeServices(legacy, { fillDefaults: false })[0];
  assert.strictEqual(saved.booking_mode, undefined);
  assert.ok(!('booking_mode' in saved));
  const withCal = resolveBookingAction({
    services: legacy,
    userMessage: 'Je veux une coupe femme',
    calendarConnected: true,
  });
  assert.strictEqual(withCal.inferred, true);
  assert.strictEqual(withCal.booking_mode, 'calendar');
  assert.strictEqual(withCal.duration_minutes, 30);
  const withLink = resolveBookingAction({
    services: legacy,
    userMessage: 'Allo',
    calendarConnected: false,
    reservationUrl: 'https://calendly.com/salon',
  });
  assert.strictEqual(withLink.booking_mode, 'external_link');
  assert.strictEqual(withLink.booking_url, 'https://calendly.com/salon');
  const humanFb = resolveBookingAction({
    services: legacy,
    userMessage: 'Allo',
    calendarConnected: false,
  });
  assert.strictEqual(humanFb.booking_mode, 'human');
});

await test('confirmation SMS cohérente avec l\'action réellement exécutée', () => {
  const slot = { start: '2026-08-18T18:00:00.000Z', end: '2026-08-18T20:00:00.000Z' };
  const estimateAction = resolveBookingAction({
    services: SERVICE_SET,
    userMessage: 'Je veux une estimation toiture',
    qualificationData: { nom: 'Jean Tremblay' },
    calendarConnected: true,
  });
  const estimateOk = applyCalendarConfirmationToReply({
    reply: 'Le créneau est libre.',
    tenant: { business_name: 'Toiture QC' },
    booking: { ok: true, slot },
    userMessage: 'Oui demain 14h',
    bookingAction: estimateAction,
    durationMin: estimateAction.durationMin,
  });
  assert.strictEqual(estimateAction.action, 'create_calendar');
  assert.strictEqual(estimateOk.calendarConfirmed, true);
  assert.match(estimateOk.reply, /confirmé dans l'agenda/i);

  const linkAction = resolveBookingAction({
    services: SERVICE_SET,
    userMessage: 'Je veux réserver sur Fresha',
    calendarConnected: true,
  });
  const linkSkip = applyCalendarConfirmationToReply({
    reply: "C'est confirmé, je vous ai inscrit à l'agenda.",
    tenant: { business_name: 'Salon' },
    booking: { skipped: linkAction.action, action: linkAction },
    userMessage: 'Je réserve sur Fresha',
    bookingAction: linkAction,
    durationMin: linkAction.durationMin,
  });
  assert.strictEqual(linkAction.action, 'send_link');
  assert.strictEqual(linkSkip.calendarConfirmed, false);
  assert.ok(!/confirmé dans l'agenda/i.test(linkSkip.reply));

  const humanAction = resolveBookingAction({
    services: SERVICE_SET,
    userMessage: 'Urgence plomberie',
    calendarConnected: true,
  });
  const humanSkip = applyCalendarConfirmationToReply({
    reply: "C'est confirmé pour demain.",
    tenant: { business_name: 'Plomberie' },
    booking: { skipped: humanAction.action, action: humanAction },
    userMessage: 'Urgence plomberie',
    bookingAction: humanAction,
    durationMin: humanAction.durationMin,
  });
  assert.strictEqual(humanAction.action, 'human');
  assert.strictEqual(humanSkip.calendarConfirmed, false);
  assert.ok(!/confirmé dans l'agenda/i.test(humanSkip.reply));

  const askAction = resolveBookingAction({
    services: SERVICE_SET,
    userMessage: 'Je veux un rdv demain 14h',
    calendarConnected: true,
  });
  const askSkip = applyCalendarConfirmationToReply({
    reply: "C'est confirmé, je vous ai inscrit à l'agenda demain 14h.",
    tenant: { business_name: 'Salon' },
    booking: { skipped: askAction.action, action: askAction },
    userMessage: 'Je veux un rdv demain 14h',
    bookingAction: askAction,
    durationMin: askAction.durationMin,
  });
  assert.strictEqual(askAction.action, 'ask_service');
  assert.strictEqual(askAction.create, false);
  assert.strictEqual(askSkip.calendarConfirmed, false);
  assert.ok(!/confirmé dans l'agenda/i.test(askSkip.reply));
});

await test('historique listant plusieurs services: le message courant gagne', () => {
  const history = [
    { role: 'assistant', content: 'On offre Coiffure, Coloration, Estimation toiture, Fresha et Urgence plomberie.' },
    { role: 'user', content: 'Coloration ça a l\'air bien' },
  ];
  const action = resolveBookingAction({
    services: SERVICE_SET,
    userMessage: 'Je veux une coiffure demain',
    history,
    aiReply: 'Parfait, coloration à 120 $ ou estimation toiture?',
    qualificationData: { service_souhaite: 'Coloration', probleme: 'Estimation toiture' },
    calendarConnected: true,
  });
  assert.strictEqual(action.matched, true);
  assert.strictEqual(action.service.nom, 'Coiffure');
  assert.strictEqual(action.booking_mode, 'calendar');
  assert.strictEqual(action.durationMin, 30);
  assert.strictEqual(action.action, 'create_calendar');
  const plan = planCalendarBooking({ bookingAction: action, qualificationData: { nom: 'Marie' } });
  assert.strictEqual(plan.durationMin, 30);
  assert.match(plan.eventSummary, /Coiffure/);
});

await test('qualification.service_souhaite sert si le message ne nomme pas le service', () => {
  const action = resolveBookingAction({
    services: SERVICE_SET,
    userMessage: 'Oui demain 14h ça me va',
    qualificationData: { service_souhaite: 'Coloration', nom: 'Marie' },
    calendarConnected: true,
  });
  assert.strictEqual(action.service.nom, 'Coloration');
  assert.strictEqual(action.durationMin, 120);
  assert.strictEqual(action.create, true);
});

await test('demande de rendez-vous sans service: ask_service, aucun événement', async () => {
  const action = resolveBookingAction({
    services: SERVICE_SET,
    userMessage: 'Je veux un rendez-vous demain 14h',
    calendarConnected: true,
  });
  assert.strictEqual(action.matched, false);
  assert.strictEqual(action.action, 'ask_service');
  assert.strictEqual(action.create, false);
  const plan = planCalendarBooking({ bookingAction: action, calendarConnected: true });
  assert.strictEqual(plan.create, false);
  const gated = await maybeCreateCalendarEvent({
    tenant: { id: 'tenant-a', services: SERVICE_SET, business_name: 'Salon' },
    callerPhone: '+14185550101',
    userMessage: 'Je veux un rendez-vous demain 14h',
    bookingAction: action,
  });
  assert.ok(!gated.ok);
  assert.strictEqual(gated.skipped, 'ask_service');
});

await test('Google + Fresha: rdv sans service → pas d\'événement', async () => {
  const mixed = [
    { nom: 'Coiffure', booking_mode: 'calendar', duration_minutes: 30 },
    { nom: 'Réservation en ligne', booking_mode: 'external_link', booking_url: 'https://fresha.com/salon-demo' },
  ];
  const action = resolveBookingAction({
    services: mixed,
    userMessage: 'Je veux un rdv',
    calendarConnected: true,
    reservationUrl: 'https://fresha.com/salon-demo',
  });
  assert.strictEqual(action.create, false);
  assert.strictEqual(action.action, 'ask_service');
  const gated = await maybeCreateCalendarEvent({
    tenant: { id: 'tenant-a', services: mixed, business_name: 'Salon', reservation_url: 'https://fresha.com/salon-demo' },
    callerPhone: '+14185550101',
    userMessage: 'Je veux un rdv',
    bookingAction: action,
  });
  assert.ok(!gated.ok);
  assert.notStrictEqual(gated.skipped, null);
});

await test('service human sans nom exact dans le message: aucun événement', async () => {
  const action = resolveBookingAction({
    services: SERVICE_SET,
    userMessage: 'Ma toilette coule, j\'ai de l\'eau partout',
    calendarConnected: true,
  });
  assert.strictEqual(action.create, false);
  assert.ok(action.action === 'ask_service' || action.action === 'human');
  const gated = await maybeCreateCalendarEvent({
    tenant: { id: 'tenant-a', services: SERVICE_SET },
    callerPhone: '+14185550101',
    userMessage: 'Ma toilette coule, j\'ai de l\'eau partout',
    bookingAction: action,
  });
  assert.ok(!gated.ok);
  assert.ok(['ask_service', 'human'].includes(gated.skipped));
});

await test('external_link sans mentionner Fresha: envoie le lien, pas d\'événement', async () => {
  const services = [
    { nom: 'Coupe', booking_mode: 'external_link', booking_url: 'https://fresha.com/salon-demo' },
    { nom: 'Coloration', booking_mode: 'external_link', booking_url: 'https://fresha.com/salon-demo' },
  ];
  const action = resolveBookingAction({
    services,
    userMessage: 'Je veux un rendez-vous demain',
    calendarConnected: true,
  });
  assert.strictEqual(action.action, 'send_link');
  assert.strictEqual(action.create, false);
  assert.strictEqual(action.booking_url, 'https://fresha.com/salon-demo');
  assert.ok(!/fresha/i.test('Je veux un rendez-vous demain'));
  const gated = await maybeCreateCalendarEvent({
    tenant: { id: 'tenant-a', services, business_name: 'Salon' },
    callerPhone: '+14185550101',
    userMessage: 'Je veux un rendez-vous demain',
    bookingAction: action,
  });
  assert.ok(!gated.ok);
  assert.ok(gated.skipped === 'external_link' || gated.skipped === 'send_link');
});

await test('prompt services: les 4 modes sont décrits', () => {
  const block = formatServicesForPrompt(SERVICE_SET);
  assert.match(block, /Coiffure[\s\S]*ACTION: agenda Google/);
  assert.match(block, /Coloration[\s\S]*120 min/);
  assert.match(block, /Estimation toiture[\s\S]*visite d'estimation/);
  assert.match(block, /Fresha[\s\S]*https:\/\/fresha.com\/salon-demo/);
  assert.match(block, /Urgence plomberie[\s\S]*rappel humain/);
});

await test('sécurité: TWILIO_SKIP_SIGNATURE ignoré en production', () => {
  const prevSkip = process.env.TWILIO_SKIP_SIGNATURE;
  const prevCtx = process.env.CONTEXT;
  const prevNode = process.env.NODE_ENV;
  process.env.TWILIO_SKIP_SIGNATURE = 'true';
  process.env.CONTEXT = 'production';
  assert.strictEqual(isProductionEnv(), true);
  assert.strictEqual(validateTwilioRequest({ headers: {}, body: '' }), false);
  process.env.CONTEXT = 'dev';
  process.env.NODE_ENV = 'development';
  assert.strictEqual(validateTwilioRequest({ headers: {}, body: '' }), true);
  restoreEnv('TWILIO_SKIP_SIGNATURE', prevSkip);
  restoreEnv('CONTEXT', prevCtx);
  restoreEnv('NODE_ENV', prevNode);
});

await test('sécurité: CALENDAR_TOKEN_ENCRYPTION_KEY sans fallback service_role/dev', () => {
  const prevKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  const prevService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-should-not-be-used';
  assert.throws(() => encryptSecret('token'), /CALENDAR_TOKEN_ENCRYPTION_KEY/);
  process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'noviaai-calendar-dev';
  assert.throws(() => encryptSecret('token'), /CALENDAR_TOKEN_ENCRYPTION_KEY/);
  process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'service-role-should-not-be-used';
  assert.throws(() => encryptSecret('token'), /SERVICE_ROLE|service_role/i);
  process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'unit-test-calendar-key-32b';
  assert.ok(encryptSecret('token'));
  restoreEnv('CALENDAR_TOKEN_ENCRYPTION_KEY', prevKey);
  restoreEnv('SUPABASE_SERVICE_ROLE_KEY', prevService);
});

await test('calendrier: déconnexion possible même si les jetons sont illisibles', () => {
  const prevKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'unit-test-calendar-key-32b';
  const enc = encryptSecret('refresh-token');
  assert.strictEqual(decryptSecret(enc), 'refresh-token');
  process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'other-calendar-key-after-rotation';
  assert.throws(() => decryptSecret(enc), /authenticate|unable|bad decrypt|Unsupported/i);
  assert.strictEqual(tryDecryptSecret(enc), null);
  assert.strictEqual(tryDecryptSecret(null), null);
  restoreEnv('CALENDAR_TOKEN_ENCRYPTION_KEY', prevKey);
});

await test('sécurité: import de site bloque localhost, RFC1918, metadata', () => {
  assert.strictEqual(isBlockedHostname('localhost'), true);
  assert.strictEqual(isBlockedHostname('127.0.0.1'), true);
  assert.strictEqual(isBlockedHostname('192.168.1.10'), true);
  assert.strictEqual(isBlockedHostname('10.0.0.5'), true);
  assert.strictEqual(isBlockedHostname('169.254.169.254'), true);
  assert.strictEqual(isBlockedHostname('metadata.google.internal'), true);
  assert.throws(() => parseHttpUrl('http://127.0.0.1/latest'), /interne|refusée/i);
  assert.throws(() => parseHttpUrl('http://192.168.0.1/'), /interne|refusée/i);
  assert.throws(() => parseHttpUrl('http://169.254.169.254/latest/meta-data'), /interne|refusée/i);
  assert.throws(() => parseHttpUrl('http://metadata.google.internal/'), /interne|refusée/i);
  assert.ok(parseHttpUrl('https://noviaai.ca/'));
});

await test('sécurité: crons refusés sans secret', async () => {
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'unit-test-cron-secret';
  const fakeHeaders = { 'x-nf-event': 'schedule', 'user-agent': 'Netlify Clockwork' };
  assert.strictEqual(authorizeCron({ headers: {}, queryStringParameters: {} }), false);
  assert.strictEqual(authorizeCron({ headers: fakeHeaders }), false);
  assert.strictEqual(authorizeCron(withCronSecret({ headers: fakeHeaders })), false);
  assert.strictEqual(authorizeCron({ headers: { 'x-cron-secret': 'unit-test-cron-secret' } }), true);
  assert.strictEqual(authorizeCron(withCronSecret({
    headers: fakeHeaders,
    body: JSON.stringify({ next_run: new Date(Date.now() + 60000).toISOString() }),
  })), true);
  assert.strictEqual(isNetlifySchedulerEvent({ headers: fakeHeaders }), true);
  const review = require('../netlify/functions/review-queue-processor.js');
  const trial = require('../netlify/functions/trial-expiry-processor.js');
  const deniedReview = await review.handler({ httpMethod: 'GET', headers: fakeHeaders });
  const deniedTrial = await trial.handler({ httpMethod: 'GET', headers: fakeHeaders });
  assert.strictEqual(deniedReview.statusCode, 401);
  assert.strictEqual(deniedTrial.statusCode, 401);
  restoreEnv('CRON_SECRET', prev);
});

await test('sécurité: utilisateur normal ne peut pas modifier le plan', () => {
  assert.strictEqual(USER_PATCHABLE_FIELDS.has('plan'), false);
  assert.strictEqual(USER_PATCHABLE_FIELDS.has('subscription_status'), false);
  const patched = pickPatch(
    { plan: 'pro', subscription_status: 'active', business_name: 'Salon Test' },
    USER_PATCHABLE_FIELDS,
  );
  assert.strictEqual(patched.plan, undefined);
  assert.strictEqual(patched.subscription_status, undefined);
  assert.strictEqual(patched.business_name, 'Salon Test');
  const payload = settingsToTenantPayload(
    { settings: true, plan: 'pro', business_name: 'Salon Test' },
    { plan: 'essentiel', business_name: 'Ancien' },
  );
  const safe = pickPatch(payload, USER_PATCHABLE_FIELDS);
  assert.strictEqual(safe.plan, undefined);
  assert.strictEqual(safe.business_name, 'Salon Test');
});

await test('sécurité: checkout abandonné ne change pas le plan', () => {
  const patch = dbPatchAfterCheckoutCreate(
    { id: 't1', plan: 'essentiel', stripe_customer_id: null },
    'cus_new',
  );
  assert.strictEqual(patch.plan, undefined);
  assert.strictEqual(patch.subscription_status, undefined);
  assert.strictEqual(patch.stripe_customer_id, 'cus_new');
});

await test('sécurité: webhook Stripe valide met à jour le plan', () => {
  const patch = tenantPatchFromCheckoutSession({
    customer: 'cus_paid',
    subscription: 'sub_paid',
    metadata: { tenant_id: 't1', plan: 'pro' },
  }, { subscriptionStatus: 'active' });
  assert.strictEqual(patch.plan, 'pro');
  assert.strictEqual(patch.subscription_status, 'active');
  assert.strictEqual(patch.stripe_customer_id, 'cus_paid');
  assert.strictEqual(patch.stripe_subscription_id, 'sub_paid');
});

await test('sécurité: OAuth calendrier lié à la session NoviaAI', async () => {
  const prevKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  const prevGid = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const prevGsec = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const prevMid = process.env.MICROSOFT_CALENDAR_CLIENT_ID;
  const prevMsec = process.env.MICROSOFT_CALENDAR_CLIENT_SECRET;
  process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'unit-test-calendar-key-32b';
  process.env.GOOGLE_CALENDAR_CLIENT_ID = 'test-google-id';
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'test-google-secret';
  process.env.MICROSOFT_CALENDAR_CLIENT_ID = 'test-ms-id';
  process.env.MICROSOFT_CALENDAR_CLIENT_SECRET = 'test-ms-secret';

  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';
  const userA = 'user-a';
  const userB = 'user-b';

  async function checkProvider(provider) {
    const a = await startConnect(tenantA, provider, { userId: userA });
    const b = await startConnect(tenantB, provider, { userId: userB });
    const stateA = new URL(a.url).searchParams.get('state');
    await assertOAuthCallbackSession(stateA, {
      headers: { cookie: `novia_cal_oauth=${a.cookie}` },
    });
    await assert.rejects(
      () => assertOAuthCallbackSession(stateA, {
        headers: { cookie: `novia_cal_oauth=${b.cookie}` },
      }),
      /incompatible|session/i,
    );
    await assert.rejects(
      () => assertOAuthCallbackSession(stateA, { headers: {} }),
      /requise|session/i,
    );
  }

  await checkProvider('google');
  await checkProvider('microsoft');

  restoreEnv('CALENDAR_TOKEN_ENCRYPTION_KEY', prevKey);
  restoreEnv('GOOGLE_CALENDAR_CLIENT_ID', prevGid);
  restoreEnv('GOOGLE_CALENDAR_CLIENT_SECRET', prevGsec);
  restoreEnv('MICROSOFT_CALENDAR_CLIENT_ID', prevMid);
  restoreEnv('MICROSOFT_CALENDAR_CLIENT_SECRET', prevMsec);
});

await test('sécurité: utilisateur normal ne peut pas modifier plan/Stripe/Twilio ni appeler les RPC definer', async () => {
  const fs = require('fs');
  const path = require('path');
  const root = process.cwd();
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    const sql = fs.readFileSync(path.join(root, 'supabase', 'schema-v22-security-hardening.sql'), 'utf8');
    assert.match(sql, /REVOKE UPDATE ON TABLE public\.tenants FROM anon/);
    assert.match(sql, /stripe_customer_id/);
    assert.match(sql, /twilio_number/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.count_conversations_since/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.rls_auto_enable/);
    return;
  }
  const { createClient } = require('@supabase/supabase-js');
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const fakeId = '00000000-0000-4000-8000-000000000099';
  const planUpd = await anon.from('tenants').update({ plan: 'pro' }).eq('id', fakeId);
  const subUpd = await anon.from('tenants').update({ subscription_status: 'active' }).eq('id', fakeId);
  const stripeUpd = await anon.from('tenants').update({ stripe_customer_id: 'cus_hack' }).eq('id', fakeId);
  const twilioUpd = await anon.from('tenants').update({ twilio_number: '+15555550100' }).eq('id', fakeId);
  assert.ok(planUpd.error, planUpd.error ? planUpd.error.message : 'plan update aurait dû échouer');
  assert.ok(subUpd.error, 'subscription_status update aurait dû échouer');
  assert.ok(stripeUpd.error, 'stripe_customer_id update aurait dû échouer');
  assert.ok(twilioUpd.error, 'twilio_number update aurait dû échouer');
  const rpc = await anon.rpc('count_conversations_since', {
    p_tenant_id: fakeId,
    p_since: new Date().toISOString(),
  });
  assert.ok(rpc.error, 'count_conversations_since aurait dû être refusé à anon');
  const rlsRpc = await anon.rpc('rls_auto_enable');
  assert.ok(rlsRpc.error, 'rls_auto_enable aurait dû être refusé à anon');
});

console.log(`\n📊 ${passed} passés, ${failed} échoués\n`);
process.exit(failed ? 1 : 0);
