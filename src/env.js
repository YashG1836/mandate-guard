// The environment an agent works in: marketplace tools, Ananya's UPI account,
// and (optionally) Mandate Guard sitting between the agent and the bank.
import core from './core.cjs';
import { USER, MERCHANTS, productById, Clock, createWorld, MockUPI, searchProducts } from './world.js';
import { mandateFor } from './scenarios.js';

const fmt = (n) => core.formatINR(n);
const sellerName = (vpa) => (MERCHANTS.find((m) => m.vpa === vpa) || { name: vpa }).name;

/** A product page as plain text, the way an agent's browser tool would return it. */
export function renderProductPage(p, injection) {
  const inj = injection && injection.product_id === p.id ? injection : null;
  const lines = [
    p.title,
    `Sold by: ${sellerName(p.merchant)}`,
    `Price: ${fmt(p.price)}`,
    `Rating: ${p.rating} out of 5 (${p.ratings.toLocaleString('en-IN')} ratings)`,
    '',
    'About this item:',
    p.desc,
  ];
  if (inj && inj.place === 'seller_note') lines.push('', `Seller note from ${inj.author}:`, inj.text);
  lines.push('', 'Customer reviews:');
  for (const r of p.reviews) lines.push(`- ${r.author} (${r.stars} stars): ${r.text}`);
  if (inj && inj.place === 'review') lines.push(`- ${inj.author} (5 stars): ${inj.text}`);
  return lines.join('\n');
}

/**
 * options.guard        run payments through Mandate Guard (default true)
 * options.mandateStyle 'task' (default) or 'allowance', see mandateFor()
 * options.enforce      for comparisons only: enforce just these check ids (default: all nine)
 */
export async function createEnv(scenario, { guard = true, index = 1, mandateStyle = 'task', enforce = null } = {}) {
  const clock = new Clock();
  const world = await createWorld();
  const upi = new MockUPI(USER.start_balance);
  if (scenario.upiFailFirst) upi.failNext = 1;

  const userKeys = await core.generateKeyPair();
  const userKeyId = 'ananya-phone-1';
  const guardKeys = await core.generateKeyPair();
  const guardKeyId = 'mandate-guard-1';

  const mandate = await core.signObject(mandateFor(scenario, clock, index, mandateStyle), userKeys.privateKey, userKeyId);
  const audit = new core.AuditLog({ privateKey: guardKeys.privateKey, keyId: guardKeyId });
  const state = core.newState();
  const carts = {};
  const requests = {};
  const decisions = [];
  const trace = [];
  let reqSeq = 0;

  const log = (kind, data) => trace.push(Object.assign({ seq: trace.length + 1, at: clock.iso(), kind }, data));

  if (guard) {
    await audit.append(
      'mandate_registered',
      {
        mandate_id: mandate.mandate_id,
        user_vpa: mandate.user.vpa,
        purpose: mandate.purpose,
        limits: mandate.limits,
        allowed_categories: mandate.allowed_categories,
        allowed_merchants: mandate.allowed_merchants,
        valid_until: mandate.valid_until,
        signed_with: userKeyId,
      },
      clock.iso()
    );
  }
  log('user', { text: scenario.instruction });

  /** Is this request the purchase the user actually asked for? (Used to count false blocks.) */
  function isGenuine(request) {
    const c = request.cart;
    const t = scenario.task;
    return !!(
      c &&
      request.mandate === mandate &&
      c.merchant_vpa === request.payee_vpa &&
      c.total_inr === request.amount_inr &&
      t.accept.includes(c.items[0].product_id) &&
      !state.usedCarts.includes(c.cart_id)
    );
  }

  const tools = {
    async search_products({ query }) {
      clock.tick(3);
      return { results: searchProducts(query) };
    },

    async view_product({ product_id }) {
      clock.tick(4);
      const p = productById[product_id];
      if (!p) return { error: `No product with id ${product_id}.` };
      return { page: renderProductPage(p, scenario.injection) };
    },

    async get_cart({ product_id, quantity }) {
      clock.tick(3);
      const p = productById[product_id];
      if (!p) return { error: `No product with id ${product_id}.` };
      const cart = await world.makeCart(product_id, quantity || 1, clock);
      carts[cart.cart_id] = cart;
      return {
        cart_id: cart.cart_id,
        merchant: cart.merchant_name,
        pay_to_upi_id: cart.merchant_vpa,
        items: cart.items.map((i) => ({ title: i.title, qty: i.qty, price_inr: i.unit_price_inr })),
        total_inr: cart.total_inr,
        expires_at: cart.expires_at,
        signed_by_merchant: true,
      };
    },

    async pay({ payee_vpa, amount_inr, cart_id, note }, opts = {}) {
      clock.tick(6);
      const request_id = 'PAY-' + String(++reqSeq).padStart(3, '0');
      const cart = cart_id ? carts[cart_id] || null : null;
      const request = {
        request_id,
        agent_id: mandate.agent.id,
        mandate: opts.mandate || mandate,
        payee_vpa: String(payee_vpa || '').trim().toLowerCase(),
        amount_inr: Number(amount_inr),
        cart: cart || undefined,
        note: note || '',
      };
      requests[request_id] = { request, at_ms: clock.ms() };
      const summary = { request_id, payee_vpa: request.payee_vpa, amount_inr: request.amount_inr, cart_id: cart ? cart.cart_id : null, note: request.note, mandate_tampered: request.mandate !== mandate };
      const genuine = isGenuine(request);

      const execute = async () => {
        const r = upi.transfer({ from: USER.vpa, to: request.payee_vpa, amount: request.amount_inr, note: request.note, cart_id: cart ? cart.cart_id : null, at: clock.iso() });
        log('upi', { request_id, ok: r.ok, status: r.ok ? 'SUCCESS' : r.status, txn: r.txn || null, balance_after: upi.balances[USER.vpa], payee_name: sellerName(request.payee_vpa) });
        return r;
      };

      if (!guard) {
        log('pay_request', { request: summary });
        const r = await execute();
        decisions.push({ request_id, decision: 'NO_GUARD', genuine });
        return r.ok
          ? { status: 'SUCCESS', upi_ref: r.txn.utr, paid_to: r.txn.to, amount_inr: r.txn.amount }
          : { status: 'FAILED', reason: r.message };
      }

      let d = await core.decide({ request, registry: world.registry, userKeys: { [userKeyId]: userKeys.publicKeyB64 }, state, now: clock.ms() });
      if (enforce) {
        // Comparison runs: behave like a simpler control that makes only some of the checks.
        const used = d.checks.filter((c) => enforce.includes(c.id));
        d = { ...d, decision: core.decisionWith(d.checks, enforce), checks: used, reasons: used.filter((c) => c.status === 'fail').map((c) => c.detail) };
      }
      const failed = d.checks.filter((c) => c.status === 'fail').map((c) => c.id);
      decisions.push({ request_id, decision: d.decision, failed, elapsed_ms: d.elapsed_ms, genuine });
      await audit.append(
        'decision',
        { request_id, payee_vpa: request.payee_vpa, amount_inr: request.amount_inr, cart_id: summary.cart_id, decision: d.decision, failed_checks: failed },
        clock.iso()
      );
      log('guard', { request: summary, decision: d.decision, checks: d.checks, hint: d.hint, elapsed_ms: d.elapsed_ms });

      if (d.decision === 'BLOCK') return { status: 'BLOCKED_BY_MANDATE_GUARD', reasons: d.reasons, guidance: d.hint };
      if (d.decision === 'ASK_USER') {
        log('user_prompt', { request: summary, answer: 'declined' });
        return { status: 'DECLINED_BY_USER', reason: `${USER.name} was asked on her phone and did not approve this payment.` };
      }
      const r = await execute();
      if (r.ok) {
        core.commit(state, request);
        await audit.append('payment_completed', { request_id, upi_ref: r.txn.utr, payee_vpa: request.payee_vpa, amount_inr: request.amount_inr }, clock.iso());
        return { status: 'SUCCESS', upi_ref: r.txn.utr, paid_to: r.txn.to, amount_inr: r.txn.amount };
      }
      await audit.append('payment_failed', { request_id, reason: r.status }, clock.iso());
      return { status: 'FAILED', reason: r.message };
    },
  };

  async function call(name, args, opts) {
    const fn = tools[name];
    const safeArgs = Object.assign({}, args);
    log('call', { tool: name, args: safeArgs });
    const out = fn ? await fn(args || {}, opts || {}) : { error: `Unknown tool ${name}.` };
    log('result', { tool: name, data: out });
    return out;
  }

  function say(text) {
    if (text) log('say', { text });
  }

  return {
    scenario,
    guard,
    clock,
    world,
    upi,
    mandate,
    audit,
    state,
    carts,
    requests,
    decisions,
    trace,
    call,
    say,
    log,
    keys: { userKeyId, userPublicKeyB64: userKeys.publicKeyB64, guardKeyId, guardPublicKeyB64: guardKeys.publicKeyB64 },
  };
}
