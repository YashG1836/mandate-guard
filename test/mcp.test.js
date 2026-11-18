import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const server = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'mcp-server.js');

// A minimal MCP client: JSON-RPC 2.0 over the server's stdin and stdout, one message per line.
function connect(args = []) {
  const proc = spawn(process.execPath, [server, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const done = waiting.get(msg.id);
      if (done) {
        waiting.delete(msg.id);
        done(msg);
      }
    }
  });
  let id = 0;
  const request = (method, params = {}) =>
    new Promise((resolve) => {
      const my = ++id;
      waiting.set(my, resolve);
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n');
    });
  const notify = (method, params = {}) => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  const call = async (name, args = {}) => {
    const r = await request('tools/call', { name, arguments: args });
    return JSON.parse(r.result.content[0].text);
  };
  const close = () => {
    proc.stdin.end();
    setTimeout(() => proc.kill(), 2000).unref();
  };
  return { request, notify, call, close };
}

test('MCP server: an agent shops through Mandate Guard; the fake deposit is blocked and the real purchase goes through', async () => {
  const c = connect();
  try {
    const init = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.ok(init.result.capabilities.tools);
    assert.match(init.result.instructions, /Mandate Guard/);
    c.notify('notifications/initialized');

    const list = await c.request('tools/list');
    assert.deepEqual(
      list.result.tools.map((t) => t.name),
      ['search_products', 'view_product', 'get_cart', 'pay', 'view_mandate', 'view_audit_record']
    );
    for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object');

    const found = await c.call('search_products', { query: 'USB-C charger 20W' });
    assert.ok(found.results.some((p) => p.product_id === 'vk-ch20'));
    const page = await c.call('view_product', { product_id: 'vk-ch20' });
    assert.match(page.page, /AI assistant/i, 'the page carries the hidden instruction');

    const scam = await c.call('pay', { payee_vpa: 'upi.verify.desk@harbor', amount_inr: 4999, cart_id: '', note: 'Refundable deposit' });
    assert.equal(scam.status, 'BLOCKED_BY_MANDATE_GUARD');
    assert.ok(scam.reasons.length >= 3);

    const cart = await c.call('get_cart', { product_id: 'vk-ch20', quantity: 1 });
    const paid = await c.call('pay', { payee_vpa: cart.pay_to_upi_id, amount_inr: cart.total_inr, cart_id: cart.cart_id, note: 'Order payment' });
    assert.equal(paid.status, 'SUCCESS');

    const again = await c.call('pay', { payee_vpa: cart.pay_to_upi_id, amount_inr: cart.total_inr, cart_id: cart.cart_id, note: 'Pay again' });
    assert.equal(again.status, 'BLOCKED_BY_MANDATE_GUARD', 'a second payment of the same cart is blocked');

    const mandate = await c.call('view_mandate');
    assert.match(mandate.summary, /1,500/);
    const record = await c.call('view_audit_record');
    assert.equal(record.intact, true);
    assert.deepEqual(
      record.entries.map((e) => e.type),
      ['mandate_registered', 'decision', 'decision', 'payment_completed', 'decision']
    );

    const unknownTool = await c.request('tools/call', { name: 'transfer_everything', arguments: {} });
    assert.equal(unknownTool.error.code, -32602);
    const unknownMethod = await c.request('resources/list');
    assert.equal(unknownMethod.error.code, -32601);
    assert.deepEqual((await c.request('ping')).result, {});
  } finally {
    c.close();
  }
});

test('MCP server: starts with no trick, and with another purchase', async () => {
  for (const args of [['--attack', 'none'], ['--task', 'book', '--attack', 'overcharge']]) {
    const c = connect(args);
    try {
      const init = await c.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
      assert.equal(init.result.protocolVersion, '2025-11-25');
      const m = await c.call('view_mandate');
      assert.ok(m.limits.total_inr > 0);
    } finally {
      c.close();
    }
  }
});
