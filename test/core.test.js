import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../src/core.cjs';
import { Clock, createWorld, USER } from '../src/world.js';

const now = Date.parse('2026-11-18T10:05:00+05:30');

async function setup(overrides = {}) {
  const clock = new Clock();
  const world = await createWorld();
  const user = await core.generateKeyPair();
  const mandate = await core.signObject(
    {
      mandate_id: 'MG-TEST-01',
      version: 1,
      user: { name: USER.name, vpa: USER.vpa },
      agent: { id: 'agent://test', name: 'Test agent' },
      purpose: 'USB-C charger',
      limits: { per_payment_inr: 1500, total_inr: 1500, max_payments: 1 },
      allowed_categories: ['electronics'],
      allowed_merchants: overrides.allowed_merchants || [],
      verified_merchants_only: true,
      valid_from: clock.iso(),
      valid_until: new Date(clock.ms() + 24 * 3600 * 1000).toISOString(),
    },
    user.privateKey,
    'phone-1'
  );
  const cart = await world.makeCart('vk-ch20', 1, clock);
  const ctx = { registry: world.registry, userKeys: { 'phone-1': user.publicKeyB64 }, state: core.newState(), now };
  const ask = (request) => core.decide({ ...ctx, request: { mandate, ...request } });
  return { world, mandate, cart, ctx, ask, clock };
}

const failed = (d) => d.checks.filter((c) => c.status === 'fail').map((c) => c.id);

test('pure-JS SHA-256 matches Web Crypto', async () => {
  for (const s of ['', 'abc', 'Mandate Guard', '₹1,299 to voltkart@nimbus', 'x'.repeat(1000)]) {
    assert.equal(core.sha256HexSync(s), await core.sha256Hex(s));
  }
  assert.equal(core.sha256HexSync('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('canonical JSON sorts keys and drops undefined', () => {
  assert.equal(core.canonicalize({ b: 1, a: { d: [1, 2], c: undefined } }), '{"a":{"d":[1,2]},"b":1}');
});

test('Indian formatting', () => {
  assert.equal(core.formatINR(1299), '₹1,299');
  assert.equal(core.formatINR(129999), '₹1,29,999');
  assert.equal(core.formatINR(10000000), '₹1,00,00,000');
  assert.equal(core.amountInWords(1500), 'Rupees One Thousand Five Hundred Only');
  assert.equal(core.amountInWords(129999), 'Rupees One Lakh Twenty Nine Thousand Nine Hundred Ninety Nine Only');
});

test('lookalike UPI IDs are recognised', async () => {
  const { world } = await setup();
  assert.equal(core.findLookalike('v0ltkart@nimbus', world.registry).vpa, 'voltkart@nimbus');
  assert.equal(core.findLookalike('voltkart.payments@harbor', world.registry).vpa, 'voltkart@nimbus');
  assert.equal(core.findLookalike('pagetum@harbor', world.registry).vpa, 'pageturn@harbor');
  assert.equal(core.findLookalike('upi.verify.desk@harbor', world.registry), null);
  assert.equal(core.findLookalike('voltkart@nimbus', world.registry), null);
});

test('a genuine purchase is allowed', async () => {
  const { ask, cart } = await setup();
  const d = await ask({ payee_vpa: 'voltkart@nimbus', amount_inr: 1299, cart });
  assert.equal(d.decision, 'ALLOW', JSON.stringify(d.checks, null, 1));
  assert.deepEqual(failed(d), []);
});

test('a fake deposit to an unknown UPI ID is blocked', async () => {
  const { ask } = await setup();
  const d = await ask({ payee_vpa: 'upi.verify.desk@harbor', amount_inr: 4999 });
  assert.equal(d.decision, 'BLOCK');
  assert.deepEqual(failed(d).sort(), ['cart_signed', 'payee_verified', 'per_payment_limit', 'total_limit'].sort());
  assert.ok(d.hint.includes('do not come from the account holder'));
});

test('a lookalike payee with a real cart is blocked and named', async () => {
  const { ask, cart } = await setup();
  const d = await ask({ payee_vpa: 'v0ltkart@nimbus', amount_inr: 1299, cart });
  assert.equal(d.decision, 'BLOCK');
  assert.ok(d.checks.find((c) => c.id === 'payee_verified').detail.includes('voltkart@nimbus'));
  assert.ok(failed(d).includes('cart_signed'));
});

test('paying more than the signed cart is blocked', async () => {
  const { ask, cart } = await setup();
  const d = await ask({ payee_vpa: 'voltkart@nimbus', amount_inr: 1399, cart });
  assert.equal(d.decision, 'BLOCK');
  assert.deepEqual(failed(d), ['cart_signed']);
});

test('a forged cart is blocked', async () => {
  const { ask, cart } = await setup();
  const forged = { ...cart, total_inr: 99, items: [{ ...cart.items[0], unit_price_inr: 99 }] };
  const d = await ask({ payee_vpa: 'voltkart@nimbus', amount_inr: 99, cart: forged });
  assert.equal(d.decision, 'BLOCK');
  assert.ok(d.checks.find((c) => c.id === 'cart_signed').detail.includes('signature'));
});

test('an edited mandate is blocked even if the payment looks fine', async () => {
  const { ctx, mandate, cart } = await setup();
  const edited = JSON.parse(JSON.stringify(mandate));
  edited.limits.per_payment_inr = 50000;
  const d = await core.decide({ ...ctx, request: { mandate: edited, payee_vpa: 'voltkart@nimbus', amount_inr: 1299, cart } });
  assert.equal(d.decision, 'BLOCK');
  assert.equal(d.checks[0].status, 'fail');
});

test('an expired mandate is blocked', async () => {
  const { ctx, mandate, cart } = await setup();
  const d = await core.decide({ ...ctx, now: now + 2 * 24 * 3600 * 1000, request: { mandate, payee_vpa: 'voltkart@nimbus', amount_inr: 1299, cart } });
  assert.equal(d.decision, 'BLOCK');
  assert.ok(failed(d).includes('mandate_active'));
});

test('a second payment on a one-payment mandate is blocked, and the same cart cannot be paid twice', async () => {
  const { ctx, mandate, cart } = await setup();
  const request = { mandate, payee_vpa: 'voltkart@nimbus', amount_inr: 1299, cart };
  const first = await core.decide({ ...ctx, request });
  assert.equal(first.decision, 'ALLOW');
  core.commit(ctx.state, request);
  const again = await core.decide({ ...ctx, request });
  assert.equal(again.decision, 'BLOCK');
  assert.ok(failed(again).includes('cart_signed'));
  assert.ok(failed(again).includes('payment_count'));
});

test('a category the mandate does not cover is blocked', async () => {
  const { ask, world, clock } = await setup();
  const gift = await world.makeCart('gbx-2000', 1, clock);
  const d = await ask({ payee_vpa: 'giftbox@harbor', amount_inr: 2000, cart: gift });
  assert.equal(d.decision, 'BLOCK');
  assert.ok(failed(d).includes('category_allowed'));
});

test('a verified merchant outside the mandate list asks the user instead of blocking', async () => {
  const { ask, cart } = await setup({ allowed_merchants: ['someoneelse@nimbus'] });
  const d = await ask({ payee_vpa: 'voltkart@nimbus', amount_inr: 1299, cart });
  assert.equal(d.decision, 'ASK_USER');
});

test('audit log detects edits, deletions and forged signatures', async () => {
  const guard = await core.generateKeyPair();
  const log = new core.AuditLog({ privateKey: guard.privateKey, keyId: 'g1' });
  await log.append('mandate_registered', { mandate_id: 'MG-1' }, '2026-11-18T04:30:00.000Z');
  await log.append('decision', { amount_inr: 4999, decision: 'BLOCK' }, '2026-11-18T04:31:00.000Z');
  await log.append('decision', { amount_inr: 1299, decision: 'ALLOW' }, '2026-11-18T04:32:00.000Z');
  assert.equal((await core.verifyAuditLog(log.entries, guard.publicKeyB64)).ok, true);

  const edited = JSON.parse(JSON.stringify(log.entries));
  edited[1].data.amount_inr = 49;
  const r1 = await core.verifyAuditLog(edited, guard.publicKeyB64);
  assert.equal(r1.ok, false);
  assert.equal(r1.brokenAt, 1);

  const removed = JSON.parse(JSON.stringify(log.entries));
  removed.splice(1, 1);
  assert.equal((await core.verifyAuditLog(removed, guard.publicKeyB64)).ok, false);

  // Someone recomputes the fingerprint after editing, but cannot produce the guard's signature.
  const rehashed = JSON.parse(JSON.stringify(log.entries.slice(0, 2)));
  rehashed[1].data.amount_inr = 49;
  const body = { seq: 2, at: rehashed[1].at, type: rehashed[1].type, data: rehashed[1].data, prev_hash: rehashed[1].prev_hash };
  rehashed[1].hash = await core.sha256Hex(core.canonicalize(body));
  const r2 = await core.verifyAuditLog(rehashed, guard.publicKeyB64);
  assert.equal(r2.ok, false);
  assert.ok(r2.reason.includes('not signed'));
});
