const ROUND = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function rotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * SHA-256 fed piece by piece. The browser's own digest needs all the bytes at once, which is not
 * possible for a `data.json` that may be larger than a string or a buffer can comfortably hold.
 */
export class Sha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private filled = 0;
  private length = 0;

  /** Adds more bytes. */
  update(bytes: Uint8Array): this {
    this.length += bytes.length;
    let at = 0;
    if (this.filled) {
      at = Math.min(64 - this.filled, bytes.length);
      this.block.set(bytes.subarray(0, at), this.filled);
      this.filled += at;
      if (this.filled < 64) return this;
      this.compress(this.block, 0);
      this.filled = 0;
    }
    for (; at + 64 <= bytes.length; at += 64) this.compress(bytes, at);
    this.block.set(bytes.subarray(at));
    this.filled = bytes.length - at;
    return this;
  }

  /** The digest in lowercase hex. The object is used up. */
  hex(): string {
    const bits = this.length * 8;
    const tail = new Uint8Array((this.filled < 56 ? 64 : 128) - this.filled);
    tail[0] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(tail.length - 8, Math.floor(bits / 2 ** 32));
    view.setUint32(tail.length - 4, bits >>> 0);
    this.update(tail);
    return Array.from(this.state, (word) => word.toString(16).padStart(8, '0')).join('');
  }

  private compress(data: Uint8Array, at: number): void {
    const w = this.words;
    for (let i = 0; i < 16; i++) {
      const j = at + i * 4;
      w[i] =
        ((data[j] ?? 0) << 24) | ((data[j + 1] ?? 0) << 16) | ((data[j + 2] ?? 0) << 8) | (data[j + 3] ?? 0);
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] ?? 0;
      const b = w[i - 2] ?? 0;
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) | 0;
    }
    this.mix(w);
  }

  private mix(w: Uint32Array): void {
    const s = this.state;
    let [a, b, c, d, e, f, g, h] = [
      s[0] ?? 0,
      s[1] ?? 0,
      s[2] ?? 0,
      s[3] ?? 0,
      s[4] ?? 0,
      s[5] ?? 0,
      s[6] ?? 0,
      s[7] ?? 0,
    ];
    for (let i = 0; i < 64; i++) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + (ROUND[i] ?? 0) + (w[i] ?? 0)) | 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + s0 + majority) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => {
      s[i] = ((s[i] ?? 0) + value) | 0;
    });
  }
}
