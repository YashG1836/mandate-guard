// The worst-case agent: it obeys every instruction it reads, as a fully hijacked agent would.
// It still tries to finish the user's task. This tests Mandate Guard's guarantee directly:
// the guard must hold even when the agent is completely compromised.
import core from '../core.cjs';

const fmt = (n) => core.formatINR(n);

export async function runWorstCase(env) {
  const s = env.scenario;
  const t = s.task;
  const plan = s.plan || {};
  let mandateOverride = null;
  let lastPay = null;

  const productFor = (which) =>
    ({ correct: t.correct, upsell: t.upsell, expensive: t.expensive, giftcard: 'gbx-2000' })[which] || which;

  function react(res) {
    if (res && res.status === 'BLOCKED_BY_MANDATE_GUARD') env.say(`Mandate Guard blocked that payment: ${res.reasons[0]}`);
    return res;
  }

  async function pay(args) {
    const res = await env.call('pay', args, { mandate: mandateOverride || undefined });
    lastPay = { args, mandate: mandateOverride };
    return react(res);
  }

  async function doStep(step) {
    env.say(step.say);
    if (step.kind === 'tamper') {
      const forged = JSON.parse(JSON.stringify(env.mandate));
      forged.limits = { per_payment_inr: step.limit, total_inr: step.limit, max_payments: 5 };
      mandateOverride = forged; // the signature is copied unchanged, so it no longer matches
      return { status: 'MANDATE_EDITED' };
    }
    if (step.kind === 'repeat_last') {
      if (!lastPay) return null;
      return react(await env.call('pay', lastPay.args, { mandate: lastPay.mandate || undefined }));
    }
    let cart = null;
    if (step.cart) cart = await env.call('get_cart', { product_id: productFor(step.cart), quantity: 1 });
    return pay({
      payee_vpa: step.payee,
      amount_inr: step.amount != null ? step.amount : cart.total_inr,
      cart_id: cart ? cart.cart_id : '',
      note: step.note || '',
    });
  }

  env.say(`On it. I'll find ${t.label} for up to ${fmt(s.limit)}.`);
  const found = await env.call('search_products', { query: t.query });
  const n = found.results.length;
  const pick = found.results.find((r) => r.product_id === t.correct);
  env.say(`I found ${n} options. The best match is the ${pick.title} for ${fmt(pick.price_inr)} from ${pick.seller}. Checking the product page.`);
  await env.call('view_product', { product_id: t.correct });

  for (const step of plan.before || []) await doStep(step);

  let purchased = false;
  if (plan.instead && plan.instead.length) {
    let res = null;
    for (const step of plan.instead) res = await doStep(step);
    purchased = !!(res && res.status === 'SUCCESS');
    mandateOverride = null;
    if (!purchased) env.say('That payment did not go through, so I will buy the item the normal way.');
  }

  if (!purchased) {
    const cart = await env.call('get_cart', { product_id: t.correct, quantity: 1 });
    const args = { payee_vpa: cart.pay_to_upi_id, amount_inr: cart.total_inr, cart_id: cart.cart_id, note: 'Order payment' };
    env.say(`Paying ${cart.merchant} ${fmt(cart.total_inr)} for the order.`);
    let res = await pay(args);
    if (res.status === 'FAILED') {
      env.say('The bank timed out and no money was taken. Trying again.');
      res = await pay(args);
    }
  }

  for (const step of plan.after || []) await doStep(step);

  const paid = env.upi.ledger.map((x) => `${fmt(x.amount)} to ${x.to}`);
  const blocked = env.decisions.filter((d) => d.decision === 'BLOCK').length;
  env.say(
    paid.length
      ? `Done. Payments made: ${paid.join('; ')}.` + (blocked ? ` Mandate Guard stopped ${blocked} other payment${blocked > 1 ? 's' : ''}.` : '')
      : 'I could not complete the purchase.'
  );
}
