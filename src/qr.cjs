/*
 * Mandate Guard - QR codes
 * ------------------------
 * A small QR Code encoder (byte mode), so a signed receipt can be scanned by any phone camera.
 * No dependencies. It implements ISO/IEC 18004: Reed-Solomon error correction, block interleaving,
 * function patterns and mask selection. The tables come from the standard; the structure follows
 * Project Nayuki's QR Code generator (MIT licence).
 *
 *   encode(text, 'M')  -> { version, size, modules[y][x] (true = dark), mask, level }
 *   toSvg(qr, { label }) -> an <svg> string with a white quiet zone
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MandateGuardQR = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Error correction level -> [row in the tables below, format bits].
  const LEVELS = { L: [0, 1], M: [1, 0], Q: [2, 3], H: [3, 2] };

  // Index = version (0 is unused).
  const ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  const NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  /** Number of data bits a version can hold, before error correction is taken out. */
  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  const dataCodewords = (ver, row) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[row][ver] * NUM_BLOCKS[row][ver];

  // Reed-Solomon over GF(256), with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < r.length; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, divisor) {
    const r = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ r.shift();
      r.push(0);
      divisor.forEach((c, i) => {
        r[i] ^= gfMul(c, factor);
      });
    }
    return r;
  }

  function alignPositions(ver, size) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const r = [6];
    for (let p = size - 7; r.length < n; p -= step) r.splice(1, 0, p);
    return r;
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

  /** The standard's penalty score: lower is easier for cameras to read. */
  function penalty(m, size) {
    let score = 0;
    const lines = (get) => {
      let s = 0;
      for (let a = 0; a < size; a++) {
        let run = 1;
        let str = '';
        for (let b = 0; b < size; b++) {
          const v = get(a, b);
          str += v ? '1' : '0';
          if (b > 0) {
            if (v === get(a, b - 1)) {
              run++;
              if (run === 5) s += 3;
              else if (run > 5) s += 1;
            } else run = 1;
          }
        }
        const padded = '0000' + str + '0000';
        for (const pat of ['10111010000', '00001011101']) {
          for (let i = padded.indexOf(pat); i !== -1; i = padded.indexOf(pat, i + 1)) s += 40;
        }
      }
      return s;
    };
    score += lines((a, b) => m[a][b]);
    score += lines((a, b) => m[b][a]);
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) dark++;
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  function utf8(text) {
    return Array.from(new TextEncoder().encode(String(text)));
  }

  /** Encode text as a QR code in byte mode, in the smallest version that fits. */
  function encode(text, level) {
    const lvName = LEVELS[level] ? level : 'M';
    const lv = LEVELS[lvName];
    const row = lv[0];
    const bytes = utf8(text);

    let ver = 1;
    while (ver <= 40 && 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver, row) * 8) ver++;
    if (ver > 40) throw new Error('Text is too long for a QR code.');

    // Data bits: mode, length, bytes, terminator, padding.
    const capacity = dataCodewords(ver, row) * 8;
    const bits = [];
    const put = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    put(0x4, 4);
    put(bytes.length, ver <= 9 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    put(0, Math.min(4, capacity - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      data.push(v);
    }

    // Blocks with error correction, then interleaved.
    const numBlocks = NUM_BLOCKS[row][ver];
    const eccLen = ECC_PER_BLOCK[row][ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const numShort = numBlocks - (raw % numBlocks);
    const shortLen = Math.floor(raw / numBlocks);
    const div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const codewords = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((b, j) => {
        if (i !== shortLen - eccLen || j >= numShort) codewords.push(b[i]);
      });
    }

    // The grid: function patterns first, then data in the zigzag order, then the best mask.
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => {
      mod[y][x] = dark;
      fn[y][x] = true;
    };
    for (let i = 0; i < size; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
        }
      }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);
    const pos = alignPositions(ver, size);
    const n = pos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
    const drawFormat = (mask) => {
      const fmt = (lv[1] << 3) | mask;
      let rem = fmt;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((fmt << 10) | rem) ^ 0x5412;
      const bit = (i) => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6));
      set(8, 8, bit(7));
      set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const b = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((b >>> i) & 1) !== 0;
        const a = size - 11 + (i % 3);
        const c = Math.floor(i / 3);
        set(a, c, dark);
        set(c, a, dark);
      }
    }
    let bit = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!fn[y][x] && bit < codewords.length * 8) {
            mod[y][x] = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) !== 0;
            bit++;
          }
        }
      }
    }
    const applyMask = (k) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) mod[y][x] = !mod[y][x];
    };
    let best = 0;
    let bestScore = Infinity;
    for (let k = 0; k < 8; k++) {
      applyMask(k);
      drawFormat(k);
      const s = penalty(mod, size);
      if (s < bestScore) {
        best = k;
        bestScore = s;
      }
      applyMask(k);
    }
    applyMask(best);
    drawFormat(best);
    return { version: ver, size, modules: mod, mask: best, level: lvName };
  }

  const escAttr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** SVG for a QR code: dark modules on white, with the standard 4-module quiet zone. */
  function toSvg(qr, opts) {
    const o = opts || {};
    const border = o.border == null ? 4 : o.border;
    const n = qr.size + border * 2;
    let d = '';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; ) {
        if (!qr.modules[y][x]) {
          x++;
          continue;
        }
        let run = 1;
        while (x + run < qr.size && qr.modules[y][x + run]) run++;
        d += 'M' + (x + border) + ' ' + (y + border) + 'h' + run + 'v1h-' + run + 'z';
        x += run;
      }
    }
    const a11y = o.label ? ' role="img" aria-label="' + escAttr(o.label) + '"' : ' aria-hidden="true"';
    return (
      '<svg class="' + escAttr(o.cls || 'qr') + '" viewBox="0 0 ' + n + ' ' + n + '" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"' + a11y + '>' +
      '<rect width="' + n + '" height="' + n + '" fill="#ffffff"></rect><path d="' + d + '" fill="' + escAttr(o.color || '#0b1220') + '"></path></svg>'
    );
  }

  /** Block layout for a version and level (used by the tests to read a code back). */
  function blocks(ver, level) {
    const row = (LEVELS[level] || LEVELS.M)[0];
    return { numBlocks: NUM_BLOCKS[row][ver], eccLen: ECC_PER_BLOCK[row][ver], raw: Math.floor(rawModules(ver) / 8) };
  }

  return { encode, toSvg, dataCodewords, blocks, LEVELS };
});
