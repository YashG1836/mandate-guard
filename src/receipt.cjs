/*
 * Mandate Guard - receipts
 * ------------------------
 * A short receipt for one guard decision, signed by Mandate Guard and small enough for a QR code.
 * Anyone can check it on any phone, with no app: the browser verifies the Ed25519 signature with
 * Mandate Guard's public key. Change one character and the check fails.
 *
 *   build({ no, at, decision, request, failed, mandate })  -> receipt (plain object)
 *   sign(receipt, privateKey)                              -> token, the text that goes in a link or QR code
 *   verify(token, publicKeyB64)                            -> { ok: true | false | null, receipt, reason }
 *   link(pageUrl, token)                                   -> pageUrl#r=token
 *
 * A receipt says what the account holder approved (the mandate they signed), what the agent asked
 * to pay, what Mandate Guard decided and which checks failed. It is the evidence for a dispute.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./core.cjs') : root.MandateGuardCore);
  if (isNode) module.exports = api;
  else root.MandateGuardReceipt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';

  const VERSION = 'MG1';
  const CODE = { ALLOW: 'A', BLOCK: 'B', ASK_USER: 'Q' };
  const DECISION = { A: 'ALLOW', B: 'BLOCK', Q: 'ASK_USER' };
  const CHECK_IDS = C.CHECKS.map((c) => c.id);
  const enc = new TextEncoder();
  const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;

  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bytesToB64 = (bytes) => {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  };
  const toUrl64 = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromUrl64 = (s) => {
    const b = String(s).replace(/-/g, '+').replace(/_/g, '/');
    return b + '='.repeat((4 - (b.length % 4)) % 4);
  };

  // Field values never contain the separators "~" or ",".
  const safeId = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const safeVpa = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9._@-]/g, '').slice(0, 80);
  const money = (n) => {
    const x = Math.round(Number(n) * 100) / 100;
    return Number.isFinite(x) ? x : 0;
  };

  /**
   * A receipt for one decision. `mandate` is the mandate the account holder actually signed;
   * it defaults to the one in the request (an agent may present an altered copy, which fails the signature check).
   */
  function build(input) {
    const request = input.request || {};
    const m = input.mandate || request.mandate || {};
    const l = m.limits || {};
    const cart = request.cart || null;
    const failed = input.failed || [];
    return {
      v: 1,
      no: Math.max(1, Math.floor(Number(input.no) || 1)),
      at: Math.max(0, Math.floor(Number(input.at) || 0)),
      decision: CODE[input.decision] ? input.decision : 'BLOCK',
      amount: money(request.amount_inr),
      payee: safeVpa(request.payee_vpa),
      cart: cart ? { id: safeId(cart.cart_id), total: money(cart.total_inr), shop: safeVpa(cart.merchant_vpa) } : null,
      failed: CHECK_IDS.filter((id) => failed.indexOf(id) >= 0),
      mandate: {
        id: safeId(m.mandate_id),
        total: money(l.total_inr),
        payments: Math.max(0, Math.floor(Number(l.max_payments) || 0)),
        categories: (m.allowed_categories || []).map(safeId).filter(Boolean),
        until: Date.parse(m.valid_until) || 0,
      },
      user: String(input.user || (m.user && m.user.name) || '').slice(0, 40),
    };
  }

  /** The exact text that is signed. */
  function message(r) {
    const cart = r.cart ? [r.cart.id, r.cart.total, r.cart.shop].join(',') : '-';
    const mask = r.failed.reduce((acc, id) => acc | (1 << CHECK_IDS.indexOf(id)), 0);
    const mandate = [r.mandate.id, r.mandate.total, r.mandate.payments, r.mandate.categories.join('+'), r.mandate.until.toString(36)].join(',');
    return [VERSION, r.no, r.at.toString(36), CODE[r.decision], r.amount, r.payee, cart, mask, mandate, encodeURIComponent(r.user)].join('~');
  }

  /** Reads a token back into a receipt. Returns null if it is not a well-formed receipt. */
  function parse(token) {
    const parts = String(token || '').trim().split('~');
    if (parts.length !== 11 || parts[0] !== VERSION || !DECISION[parts[3]]) return null;
    const cart = parts[6] === '-' ? null : parts[6].split(',');
    const md = parts[8].split(',');
    if ((cart && cart.length !== 3) || md.length !== 5) return null;
    let user;
    try {
      user = decodeURIComponent(parts[9]);
    } catch (e) {
      return null;
    }
    const mask = Number(parts[7]);
    const r = {
      v: 1,
      no: Number(parts[1]),
      at: parseInt(parts[2], 36),
      decision: DECISION[parts[3]],
      amount: Number(parts[4]),
      payee: parts[5],
      cart: cart ? { id: cart[0], total: Number(cart[1]), shop: cart[2] } : null,
      failed: CHECK_IDS.filter((id, i) => (mask >> i) & 1),
      mandate: { id: md[0], total: Number(md[1]), payments: Number(md[2]), categories: md[3] ? md[3].split('+') : [], until: parseInt(md[4], 36) },
      user,
    };
    const nums = [r.no, r.at, r.amount, mask, r.mandate.total, r.mandate.payments, r.mandate.until].concat(cart ? [r.cart.total] : []);
    if (!nums.every(Number.isFinite)) return null;
    return { receipt: r, signed: parts.slice(0, 10).join('~'), sig: parts[10] };
  }

  async function importPrivateKey(pkcs8B64) {
    return subtle().importKey('pkcs8', b64ToBytes(pkcs8B64), { name: 'Ed25519' }, false, ['sign']);
  }

  /** Signs a receipt. Returns the token: the signed text, then "~" and the signature. */
  async function sign(r, privateKey) {
    const text = message(r);
    const sig = new Uint8Array(await subtle().sign({ name: 'Ed25519' }, privateKey, enc.encode(text)));
    return text + '~' + toUrl64(bytesToB64(sig));
  }

  /** ok: true = genuine, false = changed or not signed by this key, null = this browser cannot check Ed25519. */
  async function verify(token, publicKeyB64) {
    const p = parse(token);
    if (!p) return { ok: false, receipt: null, reason: 'This is not a Mandate Guard receipt, or part of it is missing.' };
    if (!(await C.ed25519Available())) return { ok: null, receipt: p.receipt, reason: 'This browser cannot check Ed25519 signatures.' };
    try {
      const key = await subtle().importKey('raw', b64ToBytes(publicKeyB64), { name: 'Ed25519' }, false, ['verify']);
      const ok = await subtle().verify({ name: 'Ed25519' }, key, b64ToBytes(fromUrl64(p.sig)), enc.encode(p.signed));
      return { ok, receipt: p.receipt, reason: ok ? null : 'The signature does not match. This receipt was changed after Mandate Guard signed it.' };
    } catch (e) {
      return { ok: false, receipt: p.receipt, reason: 'The signature could not be read. This receipt was changed or damaged.' };
    }
  }

  /** The receipt as a link to the demo page, which checks it when opened. */
  function link(pageUrl, token) {
    return String(pageUrl).replace(/#.*$/, '') + '#r=' + token;
  }

  /** The same receipt with the decision and amount changed: for showing that a fake is caught. */
  function forge(token, amount) {
    const parts = String(token).split('~');
    if (parts.length !== 11) return token;
    parts[3] = parts[3] === 'A' ? 'B' : 'A';
    parts[4] = String(amount == null ? 49 : amount);
    return parts.join('~');
  }

  return { VERSION, build, message, parse, sign, verify, link, forge, importPrivateKey };
});
