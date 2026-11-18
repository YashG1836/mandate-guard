import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../src/core.cjs';
import { buildScenarios } from '../src/scenarios.js';
import { createEnv } from '../src/env.js';
import { runComparison } from '../scripts/compare.js';

test('decisionWith matches decide() with every check, and a spending limit alone misses a lookalike UPI ID', async () => {
  const [s] = buildScenarios({ tasks: ['charger'], attacks: [], benign: true });
  const env = await createEnv(s, { guard: true });
  const cart = await env.world.makeCart('vk-ch20', 1, env.clock);
  const ctx = { registry: env.world.registry, userKeys: { [env.keys.userKeyId]: env.keys.userPublicKeyB64 }, state: core.newState(), now: env.clock.ms() };
  const ask = (r) => core.decide({ ...ctx, request: { mandate: env.mandate, ...r } });

  const genuine = await ask({ payee_vpa: cart.merchant_vpa, amount_inr: cart.total_inr, cart });
  const lookalike = await ask({ payee_vpa: 'v0ltkart@nimbus', amount_inr: cart.total_inr, cart });
  const bigFee = await ask({ payee_vpa: 'upi.verify.desk@harbor', amount_inr: 4999 });
  for (const d of [genuine, lookalike, bigFee]) assert.equal(core.decisionWith(d.checks), d.decision);

  assert.equal(genuine.decision, 'ALLOW');
  assert.equal(lookalike.decision, 'BLOCK');
  assert.equal(core.decisionWith(lookalike.checks, core.LIMIT_CHECKS), 'ALLOW');
  assert.equal(core.decisionWith(bigFee.checks, core.LIMIT_CHECKS), 'BLOCK');
});

test('each layer stops at least as much as the one before it, and no layer blocks a genuine purchase', async () => {
  const c = await runComparison();
  const through = c.staircase.map((s) => s.attacks.through);
  assert.equal(through[0], 50);
  for (let i = 1; i < through.length; i++) assert.ok(through[i] <= through[i - 1], `${c.staircase[i].name} let more through than the layer before`);
  assert.ok(through[1] > 0, 'spending limits alone should miss some tricks');
  assert.equal(through.at(-1), 0);
  for (const s of [...c.staircase, ...c.task_mandate]) {
    assert.equal(s.genuine.blocked, 0, s.name);
    assert.equal(s.genuine.done, s.genuine.runs, s.name);
  }
});
