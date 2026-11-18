import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import RC from '../src/receipt.cjs';
import QR from '../src/qr.cjs';
import { buildScenarios } from '../src/scenarios.js';
import { createEnv } from '../src/env.js';
import { runWorstCase } from '../src/agents/worstcase.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://yashg1836.github.io/mandate-guard/';

async function newKey() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64');
  return { privateKey: kp.privateKey, pub };
}

// The demo story, with Mandate Guard: the fake ₹4,999 deposit is blocked, the ₹1,299 charger is allowed.
async function demoDecisions() {
  const scenario = buildScenarios({ tasks: ['charger'], attacks: ['fake_fee'], benign: false })[0];
  const env = await createEnv(scenario, { guard: true, index: 1 });
  await runWorstCase(env);
  const pick = (decision) => {
    const ev = env.trace.find((e) => e.kind === 'guard' && e.decision === decision);
    const req = env.requests[ev.request.request_id];
    return RC.build({ no: decision === 'BLOCK' ? 2 : 3, at: req.at_ms, decision, request: req.request, failed: ev.checks.filter((c) => c.status === 'fail').map((c) => c.id) });
  };
  return { block: pick('BLOCK'), allow: pick('ALLOW'), env };
}

test('Receipt: a signed receipt checks out, and reads back with every field', async () => {
  const { block, allow, env } = await demoDecisions();
  const key = await newKey();
  for (const r of [block, allow]) {
    const token = await RC.sign(r, key.privateKey);
    const v = await RC.verify(token, key.pub);
    assert.equal(v.ok, true, v.reason);
    assert.deepEqual(v.receipt, r);
  }
  assert.equal(block.decision, 'BLOCK');
  assert.equal(block.amount, 4999);
  assert.equal(block.payee, 'upi.verify.desk@harbor');
  assert.equal(block.cart, null);
  assert.ok(block.failed.includes('payee_verified') && block.failed.includes('cart_signed'));
  assert.equal(block.mandate.total, 1500);
  assert.equal(block.mandate.payments, 1);
  assert.deepEqual(block.mandate.categories, ['electronics']);
  assert.equal(block.user, env.mandate.user.name);
  assert.equal(allow.decision, 'ALLOW');
  assert.deepEqual(allow.failed, []);
  assert.equal(allow.cart.total, 1299);
  assert.equal(allow.cart.shop, 'voltkart@nimbus');
});

test('Receipt: changing any part of it, or checking with another key, fails', async () => {
  const { block } = await demoDecisions();
  const key = await newKey();
  const other = await newKey();
  const token = await RC.sign(block, key.privateKey);
  const parts = token.split('~');
  const edit = (i, value) => parts.map((p, j) => (j === i ? value : p)).join('~');
  const fakes = [
    RC.forge(token, 49), // "Allowed, ₹49"
    edit(4, '49'), // amount
    edit(5, 'voltkart@nimbus'), // payee
    edit(7, '0'), // no failed checks
    edit(8, parts[8].replace(',1500,', ',50000,')), // the limit Yash approved
    edit(9, 'Somebody'), // the account holder
    edit(10, parts[10].slice(0, 20) + (parts[10][20] === 'A' ? 'B' : 'A') + parts[10].slice(21)), // one character of the signature
  ];
  for (const f of fakes) {
    const v = await RC.verify(f, key.pub);
    assert.equal(v.ok, false, f);
  }
  assert.equal((await RC.verify(token, other.pub)).ok, false, 'signed by a different key');
  for (const junk of ['', 'hello', 'MG1~1~2', token.replace('MG1', 'MG2'), token + '~extra']) {
    const v = await RC.verify(junk, key.pub);
    assert.equal(v.ok, false);
    assert.equal(v.receipt, null);
  }
});

test('Receipt: the link fits in a QR code a phone camera reads easily', async () => {
  const { block, allow } = await demoDecisions();
  const key = await newKey();
  for (const r of [block, allow]) {
    const url = RC.link(SITE + '#steal', await RC.sign(r, key.privateKey));
    assert.ok(url.startsWith(SITE + '#r=MG1~'), url);
    assert.ok(url.length < 300, `link is ${url.length} characters`);
    assert.ok(QR.encode(url, 'M').version <= 12, 'at most 65 x 65 modules');
  }
});

test('Receipt: the demo signing key in the site data is a matching pair', async () => {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'site', 'demo-data.json'), 'utf8'));
  const { block } = await demoDecisions();
  const priv = await RC.importPrivateKey(data.keys.receipt_private_key_demo);
  const token = await RC.sign(block, priv);
  assert.equal((await RC.verify(token, data.keys.receipt_public_key)).ok, true);
});
