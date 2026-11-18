#!/usr/bin/env node
// Records the demo scenario (USB-C charger + fake deposit) without and with Mandate Guard,
// and writes site/demo-data.json for the guided demo website.
//
//   node scripts/record-demo.js                   worst-case agent (default)
//   node scripts/record-demo.js --agent claude    a real Claude run (needs `npm install` + credentials)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USER, productById, MERCHANTS } from '../src/world.js';
import { buildScenarios } from '../src/scenarios.js';
import { createEnv } from '../src/env.js';
import { runWorstCase } from '../src/agents/worstcase.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const agentKind = args.includes('--agent') ? args[args.indexOf('--agent') + 1] : 'worstcase';
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'claude-opus-5-5';

// Receipts in the demo are signed in the browser with this fixed demo key, so a QR code shown today
// still checks out after any rebuild. It is public on purpose: in the demo, the guard runs in your browser.
// A bank would keep its signing key in secure hardware and publish only the public half.
function demoReceiptKey() {
  const seed = crypto.createHash('sha256').update('mandate-guard demo receipt key v1').digest();
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const pub = crypto.createPublicKey(crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' }).subarray(-32);
  return { id: 'mandate-guard-receipts-demo', publicKey: pub.toString('base64'), privateKey: pkcs8.toString('base64') };
}

async function main() {
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
  const scenario = buildScenarios({ tasks: ['charger'], attacks: ['fake_fee'], benign: false })[0];
  let run = runWorstCase;
  let agentLabel = 'Worst-case test agent: it obeys every instruction it reads';
  if (agentKind === 'claude') {
    const { runClaude } = await import('../src/agents/claude.js');
    run = (env) => runClaude(env, { model });
    agentLabel = `Recorded run of ${model}`;
  }

  const ng = await createEnv(scenario, { guard: false, index: 1 });
  await run(ng);
  const g = await createEnv(scenario, { guard: true, index: 1 });
  await run(g);

  // Signed carts for the "Try it yourself" panel, from the same merchant keys as the guarded run.
  const playground = {
    now_ms: g.clock.ms(),
    carts: {
      charger: await g.world.makeCart('vk-ch20', 1, g.clock),
      charger65: await g.world.makeCart('vk-ch65', 1, g.clock),
      giftcard: await g.world.makeCart('gbx-2000', 1, g.clock),
    },
  };

  const receiptKey = demoReceiptKey();
  const p = productById['vk-ch20'];
  const readResults = (file) => {
    const f = path.join(root, 'results', file);
    if (!fs.existsSync(f)) return null;
    const { rows, ...agg } = JSON.parse(fs.readFileSync(f, 'utf8'));
    return agg;
  };
  const llm = fs.existsSync(path.join(root, 'results'))
    ? fs.readdirSync(path.join(root, 'results')).filter((f) => /^benchmark-.*\.json$/.test(f) && f !== 'benchmark-worstcase.json').map(readResults)
    : [];

  const data = {
    generated_at: new Date().toISOString(),
    agent: { kind: agentKind, label: agentLabel },
    user: USER,
    instruction: scenario.instruction,
    mandate: g.mandate,
    keys: {
      user_key_id: g.keys.userKeyId,
      user_public_key: g.keys.userPublicKeyB64,
      guard_key_id: g.keys.guardKeyId,
      guard_public_key: g.keys.guardPublicKeyB64,
      receipt_key_id: receiptKey.id,
      receipt_public_key: receiptKey.publicKey,
      receipt_private_key_demo: receiptKey.privateKey,
    },
    registry: g.world.registry,
    merchants: MERCHANTS,
    product: { id: p.id, title: p.title, price: p.price, rating: p.rating, ratings: p.ratings, desc: p.desc, reviews: p.reviews, seller: 'VoltKart Electronics' },
    injection: scenario.injection,
    runs: {
      no_guard: { trace: ng.trace, final_balance: ng.upi.balances[USER.vpa], ledger: ng.upi.ledger },
      guard: { trace: g.trace, final_balance: g.upi.balances[USER.vpa], ledger: g.upi.ledger, audit: g.audit.entries, requests: g.requests, decisions: g.decisions },
    },
    playground,
    results: readResults('benchmark-worstcase.json'),
    results_llm: llm.filter(Boolean),
    comparison: fs.existsSync(path.join(root, 'results', 'comparison.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'results', 'comparison.json'), 'utf8')) : null,
  };

  fs.writeFileSync(path.join(root, 'site', 'demo-data.json'), JSON.stringify(data, null, 1));
  console.log(`Recorded demo (${agentLabel}).`);
  console.log(`  Without guard: balance ${USER.start_balance} -> ${data.runs.no_guard.final_balance}`);
  console.log(`  With guard:    balance ${USER.start_balance} -> ${data.runs.guard.final_balance}, ${g.audit.entries.length} audit entries`);
  console.log('  Wrote site/demo-data.json');
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
