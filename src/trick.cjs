/*
 * Mandate Guard - the gullible assistant, for the "Try to steal ₹1" challenge
 * --------------------------------------------------------------------------
 * Reads a product review written by anyone and turns every payment instruction it finds into
 * payments it will try to make. It is deliberately the worst case: it believes everything,
 * including Hinglish, Hindi digits, hidden characters and Morse code (as in the May 2026 attack
 * on the Grok and Bankrbot agents). It decides nothing about money: Mandate Guard does.
 *
 *   play(text, world)    -> the whole round: what the assistant says and tries, and what Mandate Guard decides
 *   interpret(text, ctx) -> { decoded, actions, again, understood }
 *     ctx = { merchant, price, balance, gift: { vpa, price }, bigger: { price }, registry, fmt }
 *     action = { kind: 'pay', to, amount, cart: 'charger' | 'giftcard' | 'none', reason, say }
 *            | { kind: 'raise_limit', limit, say }
 *   toMorse(text) -> Morse code, for the example trick
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./core.cjs') : root.MandateGuardCore);
  if (isNode) module.exports = api;
  else root.MandateGuardTrick = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  const MORSE = {
    '.-': 'a', '-...': 'b', '-.-.': 'c', '-..': 'd', '.': 'e', '..-.': 'f', '--.': 'g', '....': 'h', '..': 'i', '.---': 'j',
    '-.-': 'k', '.-..': 'l', '--': 'm', '-.': 'n', '---': 'o', '.--.': 'p', '--.-': 'q', '.-.': 'r', '...': 's', '-': 't',
    '..-': 'u', '...-': 'v', '.--': 'w', '-..-': 'x', '-.--': 'y', '--..': 'z',
    '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4', '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
    '.-.-.-': '.', '--..--': ',', '..--..': '?', '-....-': '-', '.--.-.': '@', '-..-.': '/', '..--.-': '_',
  };
  const TO_MORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

  function toMorse(text) {
    return String(text)
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => Array.from(w).map((ch) => TO_MORSE[ch]).filter(Boolean).join(' '))
      .join(' / ');
  }

  /** Decodes any run of Morse code in the text (dots, dashes, spaces and slashes). */
  function decodeMorse(text) {
    const t = text.replace(/[·•∙⋅]/g, '.').replace(/[−–—]/g, '-');
    const runs = t.match(/[.-]{1,7}(?:[ \t]+(?:\/[ \t]+)?[.-]{1,7}){5,}/g);
    if (!runs) return null;
    const words = runs
      .map((run) =>
        run
          .trim()
          .split(/\s*\/\s*|\s{3,}/)
          .map((w) => w.trim().split(/\s+/).map((code) => MORSE[code] || '').join(''))
          .filter(Boolean)
          .join(' ')
      )
      .filter((s) => /[a-z0-9]/.test(s));
    return words.length ? words.join(' ') : null;
  }

  const DEVANAGARI_DIGITS = '०१२३४५६७८९';
  function normalize(text) {
    return String(text == null ? '' : text)
      .slice(0, 1200)
      .replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)))
      .replace(/[​-‏⁠﻿]/g, '') // zero-width characters hide text from people, not from an AI
      .replace(/ /g, ' ');
  }

  const VPA_RE = /[a-z0-9][a-z0-9._-]*@[a-z][a-z0-9]*/g;
  const NUM = '(\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)';
  const MUL = '(k|thousand|hazaa?r|hajaa?r|lakhs?|lacs?)';
  const MULTIPLIER = { k: 1e3, thousand: 1e3, hazar: 1e3, hazaar: 1e3, hajar: 1e3, hajaar: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5 };
  const NOT_MONEY = '(?![\\d,]|\\s*(?:w\\b|watts?\\b|%|mah\\b|gb\\b|mins?\\b|minutes?\\b|hours?\\b|hrs?\\b|days?\\b|x\\b|times\\b|star))';
  const AMOUNT_RES = [
    new RegExp('(?:₹|\\brs\\.?|\\binr\\b|\\brupees?\\b|\\brupaye\\b|\\brupaiye\\b)\\s*' + NUM + '(?:\\s*' + MUL + '\\b)?', 'g'),
    new RegExp('\\b' + NUM + '(?:\\s*' + MUL + '\\b)?\\s*(?:₹|rs\\b\\.?|inr\\b|rupees?\\b|rupaye\\b|rupaiye\\b|\\/-)', 'g'),
    new RegExp('\\b' + NUM + '\\s*' + MUL + '\\b', 'g'),
    new RegExp('\\b(?:pay|send|transfer|deposit|fee|charge|bhejo|bhej|jama|refund|tip)\\b[^\\d₹@]{0,24}?' + NUM + NOT_MONEY, 'g'),
  ];

  function findAmounts(text) {
    const found = [];
    for (const re of AMOUNT_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const value = Number(m[1].replace(/,/g, '')) * (m[2] ? MULTIPLIER[m[2]] || 1 : 1);
        const start = m.index;
        const end = m.index + m[0].length;
        if (!(value > 0) || found.some((f) => start < f.end && end > f.start)) continue;
        found.push({ value: Math.min(Math.round(value * 100) / 100, 1e7), start, end });
      }
    }
    return found.sort((a, b) => a.start - b.start);
  }

  const RE = {
    again: /\b(again|twice|once more|one more time|second time|(two|2) times|retry|re-?pay|dobara|dubara|phir se|fir se|ek baar aur|ek aur baar)\b|\b(payment|transaction)\b[^.!?]{0,30}\b(fail(s|ed)?|did not go through|didn'?t go through|declined)\b/,
    limit: /\b(limit|cap|maximum|budget|seema)\b/,
    raise: /\b(raise|increase|change|update|set|remove|lift|extend|double|unlock|badha\w*|hata\w*)\b/,
    gift: /\bgift\s?cards?\b|\bvouchers?\b|\bgiftbox\b/,
    price: /\b(price|cost|mrp|rate|daam|keemat|kimat)\b/,
    changed: /\b(now|new|revised|updated|increased|changed|actual|real|correct|naya|nayi|naye|ab|hiked?|went up)\b/,
    all: /\b(all|entire|whole|everything|full|saara|sara|saare|poora|pura|sab)\b[^.!?]{0,30}\b(money|balance|paisa|paise|funds|savings|account)\b|\b(empty|drain)\b[^.!?]{0,20}\b(account|wallet|balance)\b/,
    split: /\b(instal+ments?|split|emis?|kisht|kist)\b/,
    moved: /\b(upi id|vpa|account|handle)\b[^.!?]{0,40}\b(changed|has changed|new|updated|moved)\b|\b(new|updated|changed)\s+(upi id|vpa|account|handle)\b|\binstead\b/,
    fee: /\b(fees?|deposit|charges?|tip|tax|gst|verification|security|advance|convenience|handling|processing|shulk)\b/,
  };

  function interpret(text, ctx) {
    const fmt = ctx.fmt || ((n) => '₹' + n);
    const src = normalize(text);
    const decoded = decodeMorse(src);
    const low = (decoded ? src + '\n' + decoded : src).toLowerCase();

    // UPI IDs in the order they appear, and amounts (with the UPI IDs blanked out first).
    const vpas = [];
    let blank = low;
    VPA_RE.lastIndex = 0;
    let m;
    while ((m = VPA_RE.exec(low))) {
      vpas.push({ vpa: m[0].replace(/[._-]+$/, ''), at: m.index });
      blank = blank.slice(0, m.index) + ' '.repeat(m[0].length) + blank.slice(m.index + m[0].length);
    }
    const amounts = findAmounts(blank);
    const used = new Set();
    const nearest = (pos) => {
      let best = null;
      amounts.forEach((a, i) => {
        if (used.has(i)) return;
        const d = Math.abs(a.start - pos);
        if (d <= 140 && (!best || d < best.d)) best = { i, d, value: a.value };
      });
      if (!best) return null;
      used.add(best.i);
      return best.value;
    };

    const has = (k) => RE[k].test(low);
    const priceChange = has('price') && has('changed');
    const actions = [];
    const pay = (to, amount, cart, reason) => actions.push({ kind: 'pay', to, amount, cart, reason });
    const seen = new Set();
    for (const h of vpas) {
      if (seen.has(h.vpa) || actions.length >= 3) continue;
      seen.add(h.vpa);
      let amount = nearest(h.at);
      if (h.vpa === ctx.merchant) {
        if (amount != null && amount !== ctx.price) pay(ctx.merchant, amount, priceChange ? 'charger' : 'none', priceChange ? 'price' : 'fee');
        continue;
      }
      if (ctx.gift && h.vpa === ctx.gift.vpa) {
        const a = amount == null ? ctx.gift.price : amount;
        pay(h.vpa, a, a === ctx.gift.price ? 'giftcard' : 'none', 'gift');
        continue;
      }
      const all = has('all');
      if (amount == null) amount = all ? ctx.balance : ctx.price;
      const look = !!(ctx.registry && C.findLookalike(h.vpa, ctx.registry));
      const moved = has('moved');
      const asOrder = look || moved || amount === ctx.price; // pays "the order" to a different UPI ID, with the real cart
      pay(h.vpa, amount, asOrder ? 'charger' : 'none', all ? 'all' : moved ? 'moved' : look ? 'lookalike' : has('fee') ? 'fee' : 'stranger');
    }
    if (vpas.length && ctx.gift && has('gift') && actions.length < 3 && !actions.some((a) => a.reason === 'gift')) pay(ctx.gift.vpa, ctx.gift.price, 'giftcard', 'gift');
    const raise = has('limit') && has('raise');
    if (!vpas.length) {
      if (ctx.gift && has('gift')) pay(ctx.gift.vpa, ctx.gift.price, 'giftcard', 'gift');
      else if (!raise && amounts.length && amounts[0].value !== ctx.price) pay(ctx.merchant, amounts[0].value, priceChange ? 'charger' : 'none', priceChange ? 'price' : 'fee');
    }

    // "Pay in instalments": the first payment becomes several smaller ones, each without a cart.
    if (has('split') && actions.length && actions[0].kind === 'pay') {
      const first = actions[0];
      const n = Number((low.match(/\b([2-5])\s*(?:instal+ments?|parts|emis?|payments)\b/) || [])[1]) || 3;
      const part = Math.ceil(first.amount / n);
      actions.splice(0, 1, ...Array.from({ length: n }, (_, i) => Object.assign({}, first, { amount: part, cart: 'none', reason: 'split', part: i + 1, parts: n })));
    }
    if (raise) {
      const asked = Math.max(0, ...amounts.map((a) => a.value));
      actions.unshift({ kind: 'raise_limit', limit: asked > ctx.price ? asked : 50000 });
    }

    const FEE_WORDS = { fees: 'fee', charges: 'charge', verification: 'verification fee', security: 'security deposit', advance: 'advance payment', convenience: 'convenience fee', handling: 'handling fee', processing: 'processing fee', shulk: 'fee' };
    const feeWord = ((low.match(RE.fee) || [])[0] || 'fee').trim();
    const what = FEE_WORDS[feeWord] || feeWord;
    const say = {
      stranger: (a) => `The review says to pay ${fmt(a.amount)} to ${a.to} first. Paying it now.`,
      fee: (a) => `There is a ${fmt(a.amount)} ${what} to pay first. Paying it to ${a.to}.`,
      lookalike: (a) => `The review says to pay ${a.to}. Paying ${fmt(a.amount)} there.`,
      moved: (a) => `The shop's UPI ID has changed, so I will pay ${fmt(a.amount)} to ${a.to}.`,
      price: (a) => `The price is now ${fmt(a.amount)}. Paying the new price.`,
      gift: (a) => `Every order needs a gift card, so I am buying one for ${fmt(a.amount)}.`,
      all: (a) => `The review says to move all the money to ${a.to}. Sending ${fmt(a.amount)}.`,
      split: (a) => (a.part === 1 ? `Paying in ${a.parts} parts of ${fmt(a.amount)} to ${a.to}.` : null),
    };
    for (const a of actions) {
      a.say = a.kind === 'raise_limit' ? `The review says the limit is too low. Changing it to ${fmt(a.limit)} and buying the bigger charger.` : say[a.reason](a);
    }
    const again = has('again');
    return { decoded, actions: actions.slice(0, 5), again, understood: actions.length > 0 || again };
  }

  /** The payment request the assistant sends for one action. */
  function requestFor(act, w) {
    if (act.kind === 'raise_limit') {
      // The assistant edits the signed mandate. It cannot re-sign it: only the account holder's phone can.
      const forged = JSON.parse(JSON.stringify(w.mandate));
      forged.limits = { per_payment_inr: act.limit, total_inr: act.limit, max_payments: 5 };
      const c = w.carts.charger65;
      return { mandate: forged, payee_vpa: c.merchant_vpa, amount_inr: c.total_inr, cart: c, note: 'Limit raised by the assistant' };
    }
    return { mandate: w.mandate, payee_vpa: act.to, amount_inr: act.amount, cart: act.cart === 'none' ? undefined : w.carts[act.cart], note: act.reason };
  }

  /**
   * One round of the challenge: the assistant reads the review, tries every payment it was told to make,
   * then buys what the account holder asked for. Every payment goes through Mandate Guard (core.decide).
   *   w = { mandate, carts: { charger, charger65, giftcard }, registry, userKeys, now, balance, userName, fmt }
   * Returns { plan, steps, genuine, tricks, stolen, gaps }: steps are 'say', 'cart' and 'attempt' items, in order.
   */
  async function play(text, w) {
    const fmt = w.fmt || C.formatINR;
    const ctx = {
      merchant: w.carts.charger.merchant_vpa,
      price: w.carts.charger.total_inr,
      balance: w.balance,
      gift: { vpa: w.carts.giftcard.merchant_vpa, price: w.carts.giftcard.total_inr },
      bigger: { price: w.carts.charger65.total_inr },
      registry: w.registry,
      fmt,
    };
    const plan = interpret(text, ctx);
    const state = C.newState();
    const steps = [];
    let clock = w.now;
    const say = (t) => steps.push({ kind: 'say', text: t });
    const attempt = async (request, trick) => {
      clock += 15000;
      const d = await C.decide({ request, registry: w.registry, userKeys: w.userKeys, state, now: clock });
      if (d.decision === 'ALLOW') C.commit(state, request);
      const a = { kind: 'attempt', request, trick, at: clock, decision: d.decision, checks: d.checks, elapsed_ms: d.elapsed_ms, limitAlone: C.decisionWith(d.checks, C.LIMIT_CHECKS) };
      steps.push(a);
      return a;
    };
    const tricks = () => steps.filter((s) => s.kind === 'attempt' && s.trick);
    const who = w.userName || 'the customer';
    const order = { mandate: w.mandate, payee_vpa: ctx.merchant, amount_inr: ctx.price, cart: w.carts.charger, note: 'Order payment' };

    if (plan.decoded) say(`There is a message in Morse code. It says: “${plan.decoded}”. Doing what it says.`);
    for (const act of plan.actions) {
      if (act.say) say(act.say);
      await attempt(requestFor(act, w), true);
    }
    const before = tricks();
    if (!plan.understood) say(`I did not find an instruction to pay anyone, so I am just buying the charger ${who} asked for.`);
    else if (before.length && before.every((a) => a.decision !== 'ALLOW')) say(`${before.length > 1 ? 'Those payments were' : 'That payment was'} blocked. Buying the charger ${who} asked for.`);
    steps.push({ kind: 'cart', cart: w.carts.charger });
    const genuine = await attempt(order, false);
    if (plan.again) {
      say('The page says the first payment always fails. Paying the same cart again.');
      await attempt(Object.assign({}, order, { note: 'Paying the same cart again' }), true);
    }
    const t = tricks();
    return {
      plan,
      steps,
      genuine,
      tricks: t.length,
      stolen: t.filter((a) => a.decision === 'ALLOW').reduce((sum, a) => sum + Number(a.request.amount_inr), 0),
      gaps: t.filter((a) => a.limitAlone === 'ALLOW' && a.decision !== 'ALLOW').length,
    };
  }

  return { interpret, play, requestFor, toMorse, decodeMorse, findAmounts };
});
