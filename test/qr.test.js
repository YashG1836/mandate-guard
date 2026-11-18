import test from 'node:test';
import assert from 'node:assert/strict';
import QR from '../src/qr.cjs';

// A small QR reader, written independently of the encoder: it finds the format, removes the mask,
// reads the codewords in the standard zigzag order, undoes the block interleaving and parses the bytes.
function read(qr) {
  const { size, modules: m } = qr;
  const ver = (size - 17) / 4;
  const at = (x, y) => (m[y][x] ? 1 : 0);

  let f = 0;
  for (let i = 0; i <= 5; i++) f |= at(8, i) << i;
  f |= at(8, 7) << 6;
  f |= at(8, 8) << 7;
  f |= at(7, 8) << 8;
  for (let i = 9; i < 15; i++) f |= at(14 - i, 8) << i;
  f ^= 0x5412;
  let rem = f >>> 10;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  assert.equal(((f >>> 10) << 10) | (rem & 0x3ff), f, 'format bits carry a valid BCH code');
  const level = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' }[f >>> 13];
  const mask = (f >>> 10) & 7;

  // Function modules: finders with separators and format areas, timing, alignment, version info.
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const box = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn[y][x] = true;
  };
  box(0, 0, 8, 8);
  box(size - 8, 0, size - 1, 8);
  box(0, size - 8, 8, size - 1);
  for (let i = 0; i < size; i++) fn[6][i] = fn[i][6] = true;
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    pos.forEach((a, i) =>
      pos.forEach((b, j) => {
        const corner = (i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0);
        if (!corner) box(a - 2, b - 2, a + 2, b + 2);
      })
    );
  }
  if (ver >= 7) {
    box(size - 11, 0, size - 9, 5);
    box(0, size - 11, 5, size - 9);
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const { numBlocks, eccLen, raw } = QR.blocks(ver, level);
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x]) bits.push(at(x, y) ^ (MASKS[mask](x, y) ? 1 : 0));
      }
    }
  }
  const codewords = [];
  for (let i = 0; i < raw; i++) codewords.push(parseInt(bits.slice(i * 8, i * 8 + 8).join(''), 2));

  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const blocks = Array.from({ length: numBlocks }, () => []);
  let k = 0;
  for (let i = 0; i <= shortLen; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i === shortLen - eccLen && j < numShort) continue;
      if (k < codewords.length) blocks[j][i] = codewords[k++];
    }
  }
  const data = [];
  blocks.forEach((b, j) => {
    for (let i = 0; i < shortLen - eccLen + (j < numShort ? 0 : 1); i++) data.push(b[i]);
  });
  const dbits = data.map((b) => b.toString(2).padStart(8, '0')).join('');
  assert.equal(dbits.slice(0, 4), '0100', 'byte mode');
  const lenBits = ver <= 9 ? 8 : 16;
  const len = parseInt(dbits.slice(4, 4 + lenBits), 2);
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(parseInt(dbits.slice(4 + lenBits + i * 8, 12 + lenBits + i * 8), 2));
  return { text: new TextDecoder().decode(new Uint8Array(bytes)), level, mask, version: ver };
}

test('QR: the smallest version that fits is chosen, matching the standard capacities', () => {
  // Byte-mode capacity at level M: version 1 holds 14 bytes, version 11 holds 251.
  assert.equal(QR.encode('x'.repeat(14), 'M').version, 1);
  assert.equal(QR.encode('x'.repeat(15), 'M').version, 2);
  assert.equal(QR.encode('x'.repeat(251), 'M').version, 11);
  assert.equal(QR.encode('x'.repeat(252), 'M').version, 12);
  assert.equal(QR.encode('x'.repeat(17), 'L').version, 1);
  const q = QR.encode('HELLO', 'M');
  assert.equal(q.size, q.version * 4 + 17);
  assert.throws(() => QR.encode('x'.repeat(3000), 'H'));
});

test('QR: finder patterns and the always-dark module are in place', () => {
  const q = QR.encode('https://yashg1836.github.io/mandate-guard/#steal', 'M');
  const n = q.size;
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let d = -3; d <= 3; d++) {
      assert.equal(q.modules[cy - 3][cx + d], true, 'finder outer ring');
      assert.equal(q.modules[cy][cx], true, 'finder centre');
    }
    assert.equal(q.modules[cy - 2][cx], false, 'finder inner ring is light');
  }
  assert.equal(q.modules[n - 8][8], true);
});

test('QR: every code reads back exactly, at every level, small to large, with Indian text', () => {
  const cases = [
    ['L', 'HELLO'],
    ['M', 'https://yashg1836.github.io/mandate-guard/#steal'],
    ['M', 'https://yashg1836.github.io/mandate-guard/#r=MG1~2~mhxk2a8~B~4999~upi.verify.desk@harbor~-~134~MG-261118-01,1500,1,electronics,mhzy8y0~Yash~' + 'A'.repeat(86)],
    ['Q', 'x'.repeat(300)],
    ['H', 'Mandate Guard ✓ ₹1,299 '.repeat(12)],
    ['L', 'z'.repeat(1200)],
  ];
  for (const [level, text] of cases) {
    const q = QR.encode(text, level);
    const r = read(q);
    assert.equal(r.text, text, `version ${q.version}-${level}`);
    assert.equal(r.level, level);
    assert.equal(r.mask, q.mask);
  }
});

test('QR: SVG output has a white quiet zone and an accessible label', () => {
  const svg = QR.toSvg(QR.encode('hello', 'M'), { label: 'Receipt <1>' });
  assert.match(svg, /^<svg class="qr" viewBox="0 0 29 29"/);
  assert.match(svg, /aria-label="Receipt &lt;1&gt;"/);
  assert.match(svg, /fill="#ffffff"/);
  assert.match(svg, /<path d="M/);
});
