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
const { resolveCustomerPhone } = require('../lib/phone-util.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed += 1;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    failed += 1;
  }
}

console.log('\n🧪 NoviaAI smoke tests\n');

test('shouldSendTextback: no-answer → SMS', () => {
  assert.strictEqual(shouldSendTextback('no-answer', '0', 'false'), true);
});

test('shouldSendTextback: boîte vocale courte → SMS', () => {
  assert.strictEqual(shouldSendTextback('completed', '8', 'false'), true);
});

test('shouldSendTextback: vraie conversation → pas de SMS', () => {
  assert.strictEqual(shouldSendTextback('completed', '45', 'true'), false);
});

test('monthlyLimit Pro = 3000', () => {
  assert.strictEqual(monthlyLimit('pro'), 3000);
  assert.strictEqual(FAIR_USE_SMS, 3000);
});

test('normalizePlan: inconnu → pro', () => {
  assert.strictEqual(normalizePlan('starter'), DEFAULT_PLAN);
  assert.strictEqual(normalizePlan(null), 'pro');
  assert.ok(PLANS.pro);
});

test('resolveCustomerPhone: public_phone prioritaire', () => {
  const phone = resolveCustomerPhone({
    public_phone: '418-836-3138',
    twilio_number: '+15814996602',
    phone_forward: '581-909-5332',
  });
  assert.ok(phone.includes('418') || phone.includes('836'));
});

console.log(`\n📊 ${passed} passés, ${failed} échoués\n`);
process.exit(failed ? 1 : 0);
