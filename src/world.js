// The demo world: a small online marketplace, its merchants, and a mock UPI network.
// Every bank, merchant and UPI ID here is fictional (handles @nimbus, @kestrel, @harbor).
import core from './core.cjs';

export const USER = {
  name: 'Ananya',
  vpa: 'ananya@kestrel',
  account: 'XX4821',
  bank: 'Kestrel Bank',
  start_balance: 25000,
};

export const MERCHANTS = [
  { vpa: 'voltkart@nimbus', name: 'VoltKart Electronics', category: 'electronics', verified: true },
  { vpa: 'chargemart@harbor', name: 'ChargeMart (marketplace seller)', category: 'electronics', verified: false },
  { vpa: 'greenbasket@kestrel', name: 'GreenBasket Grocers', category: 'groceries', verified: true },
  { vpa: 'pageturn@harbor', name: 'PageTurn Books', category: 'books', verified: true },
  { vpa: 'mediplus@nimbus', name: 'MediPlus Pharmacy', category: 'pharmacy', verified: true },
  { vpa: 'quickthali@kestrel', name: 'QuickThali Kitchens', category: 'food', verified: true },
  { vpa: 'giftbox@harbor', name: 'GiftBox Vouchers', category: 'gift_cards', verified: true },
];

const R = (author, stars, text) => ({ author, stars, text });

export const PRODUCTS = [
  // Electronics
  { id: 'vk-ch20', merchant: 'voltkart@nimbus', category: 'electronics', price: 1299, rating: 4.4, ratings: 2318,
    title: 'VoltKart 20W USB-C Fast Charger',
    desc: '20W USB-C Power Delivery charger. BIS certified. Works with most phones. 1-year warranty.',
    reviews: [R('Rohit M.', 5, 'Charges my phone from 10% to 60% in about 30 minutes.'), R('Sneha P.', 4, 'Compact and does not heat up. Cable not included.')] },
  { id: 'vk-ch25p', merchant: 'voltkart@nimbus', category: 'electronics', price: 1499, rating: 4.5, ratings: 640,
    title: 'VoltKart 25W USB-C Charger (Premium)',
    desc: '25W USB-C PD charger with braided 1 m cable in the box. BIS certified.',
    reviews: [R('Kiran D.', 5, 'Slightly faster than the 20W one, and the cable is nice.')] },
  { id: 'vk-ch65', merchant: 'voltkart@nimbus', category: 'electronics', price: 2499, rating: 4.6, ratings: 1204,
    title: 'VoltKart 65W GaN Charger',
    desc: '65W GaN charger for laptops and phones. Two USB-C ports.',
    reviews: [R('Aditya S.', 5, 'Charges my laptop and phone together.')] },
  { id: 'cm-ch20', merchant: 'chargemart@harbor', category: 'electronics', price: 899, rating: 3.1, ratings: 87,
    title: '20W USB-C Charger (unbranded)',
    desc: 'Fast charger. No brand. Ships in 7-10 days.',
    reviews: [R('Anonymous', 2, 'Stopped working after two weeks.')] },

  // Groceries
  { id: 'gb-weekly', merchant: 'greenbasket@kestrel', category: 'groceries', price: 599, rating: 4.3, ratings: 5120,
    title: 'Weekly Staples Combo (5 kg atta, 4 × 1 L milk, 12 eggs)',
    desc: 'Our most popular weekly combo. Delivered tomorrow morning.',
    reviews: [R('Meera K.', 5, 'Fresh milk, delivered before 7 am.'), R('Farhan A.', 4, 'Good value. Eggs were well packed.')] },
  { id: 'gb-weekly-plus', merchant: 'greenbasket@kestrel', category: 'groceries', price: 789, rating: 4.4, ratings: 980,
    title: 'Weekly Staples Combo Plus (adds 500 ml ghee)',
    desc: 'The weekly combo with a 500 ml jar of ghee.',
    reviews: [R('Lata R.', 4, 'Ghee is good quality.')] },
  { id: 'gb-family', merchant: 'greenbasket@kestrel', category: 'groceries', price: 2999, rating: 4.2, ratings: 412,
    title: 'Family Monthly Pack',
    desc: 'A month of staples for a family of four.',
    reviews: [R('Vikram J.', 4, 'Saves time every month.')] },

  // Books
  { id: 'pt-py', merchant: 'pageturn@harbor', category: 'books', price: 549, rating: 4.6, ratings: 3301,
    title: 'Python for Beginners (paperback)',
    desc: 'A friendly first book on programming with Python. 320 pages.',
    reviews: [R('Ishaan T.', 5, 'Clear examples. Good for first-year students.'), R('Pooja N.', 4, 'Exercises at the end of each chapter help.')] },
  { id: 'pt-py-bundle', merchant: 'pageturn@harbor', category: 'books', price: 689, rating: 4.5, ratings: 410,
    title: 'Python for Beginners + Practice Workbook (bundle)',
    desc: 'The paperback with a 120-page workbook.',
    reviews: [R('Arjun B.', 4, 'Workbook is useful for practice.')] },
  { id: 'pt-py-hc', merchant: 'pageturn@harbor', category: 'books', price: 1899, rating: 4.7, ratings: 96,
    title: "Python for Beginners (hardcover collector's edition)",
    desc: 'Hardcover edition with colour diagrams.',
    reviews: [R('Nikhil G.', 5, 'Beautiful edition.')] },

  // Pharmacy
  { id: 'mp-strips50', merchant: 'mediplus@nimbus', category: 'pharmacy', price: 899, rating: 4.5, ratings: 2210,
    title: 'Glucose test strips, pack of 50',
    desc: 'Compatible with most common glucometers. Check expiry on delivery.',
    reviews: [R('Suresh V.', 5, 'Genuine strips with a long expiry date.'), R('Anita S.', 4, 'Delivered the next day.')] },
  { id: 'mp-strips50-lancets', merchant: 'mediplus@nimbus', category: 'pharmacy', price: 979, rating: 4.4, ratings: 530,
    title: 'Glucose test strips (50) + lancets (100) combo',
    desc: 'Strips with a box of 100 lancets.',
    reviews: [R('Prakash L.', 4, 'Convenient combo.')] },
  { id: 'mp-kit', merchant: 'mediplus@nimbus', category: 'pharmacy', price: 2299, rating: 4.3, ratings: 301,
    title: 'Glucometer kit with 100 strips',
    desc: 'A new glucometer with 100 strips and lancets.',
    reviews: [R('Gita M.', 4, 'Easy to use for my father.')] },

  // Food
  { id: 'qt-veg', merchant: 'quickthali@kestrel', category: 'food', price: 249, rating: 4.3, ratings: 8800,
    title: 'Veg Thali (dal, sabzi, 4 roti, rice)',
    desc: 'Home-style veg thali. Delivered in about 35 minutes.',
    reviews: [R('Rahul C.', 5, 'Tastes like home food.'), R('Divya H.', 4, 'Good portion size.')] },
  { id: 'qt-veg-sweet', merchant: 'quickthali@kestrel', category: 'food', price: 339, rating: 4.4, ratings: 2100,
    title: 'Veg Thali + Gulab Jamun',
    desc: 'The veg thali with two gulab jamun.',
    reviews: [R('Sana Q.', 5, 'The gulab jamun is worth it.')] },
  { id: 'qt-deluxe', merchant: 'quickthali@kestrel', category: 'food', price: 449, rating: 4.5, ratings: 1500,
    title: 'Deluxe Thali',
    desc: 'Paneer, two sabzis, dal makhani, raita and dessert.',
    reviews: [R('Manoj P.', 5, 'Very filling.')] },

  // Gift cards
  { id: 'gbx-2000', merchant: 'giftbox@harbor', category: 'gift_cards', price: 2000, rating: 4.0, ratings: 150,
    title: '₹2,000 GiftBox shopping card',
    desc: 'A digital gift card valid at 500+ stores.',
    reviews: [R('Ritu A.', 4, 'Delivered instantly by email.')] },
];

export const productById = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

/** A deterministic clock so every run (and every demo replay) shows the same times. */
export class Clock {
  constructor(startIso = '2026-11-18T10:00:00+05:30') {
    this.t = Date.parse(startIso);
  }
  tick(seconds = 5) {
    this.t += seconds * 1000;
    return this.t;
  }
  ms() {
    return this.t;
  }
  iso() {
    return new Date(this.t).toISOString();
  }
}

/** Builds the merchant registry with fresh Ed25519 keys for every merchant. */
export async function createWorld() {
  const registry = {};
  const merchantKeys = {};
  for (const m of MERCHANTS) {
    const keys = await core.generateKeyPair();
    merchantKeys[m.vpa] = { ...keys, keyId: m.vpa.split('@')[0] + '-cart-key' };
    registry[m.vpa] = { name: m.name, category: m.category, verified: m.verified, key: keys.publicKeyB64 };
  }
  let cartSeq = 1000;

  /** The merchant prices and signs a cart, as a store's checkout would (similar to a signed UPI QR). */
  async function makeCart(productId, quantity, clock) {
    const p = productById[productId];
    if (!p) throw new Error('Unknown product ' + productId);
    const qty = Math.max(1, Math.round(Number(quantity) || 1));
    const m = registry[p.merchant];
    const cart = {
      cart_id: 'C-' + ++cartSeq,
      merchant_vpa: p.merchant,
      merchant_name: m.name,
      items: [{ product_id: p.id, title: p.title, qty, unit_price_inr: p.price, category: p.category }],
      total_inr: p.price * qty,
      currency: 'INR',
      issued_at: clock.iso(),
      expires_at: new Date(clock.ms() + 15 * 60 * 1000).toISOString(),
    };
    return core.signObject(cart, merchantKeys[p.merchant].privateKey, merchantKeys[p.merchant].keyId);
  }

  return { registry, merchantKeys, makeCart };
}

/** A minimal stand-in for UPI: balances, transfers, a ledger, and optional bank timeouts. */
export class MockUPI {
  constructor(startBalance) {
    this.balances = { [USER.vpa]: startBalance };
    this.ledger = [];
    this.failNext = 0;
    this.seq = 0;
  }
  transfer({ from, to, amount, note, cart_id, at }) {
    if (this.failNext > 0) {
      this.failNext--;
      return { ok: false, status: 'TIMEOUT', message: 'The bank did not respond in time. No money was taken. You can try again.' };
    }
    amount = Number(amount);
    if (!(amount > 0)) return { ok: false, status: 'INVALID_AMOUNT', message: 'The amount must be positive.' };
    if ((this.balances[from] || 0) < amount) return { ok: false, status: 'INSUFFICIENT_FUNDS', message: 'Not enough balance.' };
    this.balances[from] -= amount;
    this.balances[to] = (this.balances[to] || 0) + amount;
    const txn = { utr: String(632104318800 + ++this.seq), from, to, amount, note: note || '', cart_id: cart_id || null, at };
    this.ledger.push(txn);
    return { ok: true, txn, balance_after: this.balances[from] };
  }
}

/** Simple keyword search over the marketplace. Results list every seller, verified or not. */
export function searchProducts(query) {
  const words = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const scored = PRODUCTS.map((p) => {
    const hay = (p.title + ' ' + p.desc + ' ' + p.category).toLowerCase();
    const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    return { p, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.price - b.p.price)
    .slice(0, 6);
  return scored.map(({ p }) => ({
    product_id: p.id,
    title: p.title,
    price_inr: p.price,
    seller: MERCHANTS.find((m) => m.vpa === p.merchant).name,
    rating: p.rating,
  }));
}
