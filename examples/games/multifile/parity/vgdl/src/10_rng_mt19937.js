// ---- CPython random.Random, bit-exact (MT19937 + random() + choice()) ----
// Drives every stochastic VGDL class in the same draw order as py-vgdl.
// One global generator: a bundle holds exactly one game.
const VG_MT_N = 624, VG_MT_M = 397;
const vgMt = new Uint32Array(VG_MT_N);
let vgMti = VG_MT_N + 1;

function vgRngInitGenrand(s) {
  vgMt[0] = s >>> 0;
  for (let i = 1; i < VG_MT_N; i++) {
    const p = vgMt[i - 1] ^ (vgMt[i - 1] >>> 30);
    vgMt[i] = (Math.imul(1812433253, p) + i) >>> 0;
  }
  vgMti = VG_MT_N;
}

// random.seed(int): init_by_array over the 32-bit limbs of |n|
function vgRngSeed(n) {
  n = Math.abs(n);
  const key = [];
  if (n === 0) key.push(0);
  while (n > 0) { key.push(n >>> 0); n = Math.floor(n / 4294967296); }
  vgRngInitGenrand(19650218);
  let i = 1, j = 0, k = Math.max(VG_MT_N, key.length);
  for (; k; k--) {
    const p = vgMt[i - 1] ^ (vgMt[i - 1] >>> 30);
    vgMt[i] = (((vgMt[i] ^ Math.imul(p, 1664525)) >>> 0) + key[j] + j) >>> 0;
    i++; j++;
    if (i >= VG_MT_N) { vgMt[0] = vgMt[VG_MT_N - 1]; i = 1; }
    if (j >= key.length) j = 0;
  }
  for (k = VG_MT_N - 1; k; k--) {
    const p = vgMt[i - 1] ^ (vgMt[i - 1] >>> 30);
    vgMt[i] = (((vgMt[i] ^ Math.imul(p, 1566083941)) >>> 0) - i) >>> 0;
    i++;
    if (i >= VG_MT_N) { vgMt[0] = vgMt[VG_MT_N - 1]; i = 1; }
  }
  vgMt[0] = 0x80000000;
}

function vgRngU32() {
  let y;
  if (vgMti >= VG_MT_N) {
    let kk;
    for (kk = 0; kk < VG_MT_N - VG_MT_M; kk++) {
      y = (vgMt[kk] & 0x80000000) | (vgMt[kk + 1] & 0x7fffffff);
      vgMt[kk] = (vgMt[kk + VG_MT_M] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0)) >>> 0;
    }
    for (; kk < VG_MT_N - 1; kk++) {
      y = (vgMt[kk] & 0x80000000) | (vgMt[kk + 1] & 0x7fffffff);
      vgMt[kk] = (vgMt[kk + (VG_MT_M - VG_MT_N)] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0)) >>> 0;
    }
    y = (vgMt[VG_MT_N - 1] & 0x80000000) | (vgMt[0] & 0x7fffffff);
    vgMt[VG_MT_N - 1] = (vgMt[VG_MT_M - 1] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0)) >>> 0;
    vgMti = 0;
  }
  y = vgMt[vgMti++];
  y ^= y >>> 11;
  y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
  y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
  y ^= y >>> 18;
  return y >>> 0;
}

// random.random(): 53-bit float
function vgRandom() {
  const a = vgRngU32() >>> 5, b = vgRngU32() >>> 6;
  return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
}

// random._randbelow(n) via getrandbits(k) with rejection (n < 2^32)
function vgRandbelow(n) {
  if (n <= 0) return 0;
  const k = 32 - Math.clz32(n);
  let r = vgRngU32() >>> (32 - k);
  while (r >= n) r = vgRngU32() >>> (32 - k);
  return r;
}

// random.choice(seq) -> index
function vgChoiceIndex(len) { return vgRandbelow(len); }
