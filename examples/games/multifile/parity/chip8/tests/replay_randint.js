// Recompute tests/vectors/randint_10k.json on the JS threefry. Concatenated after the sources by conftest.run_js.
const fs = require('fs'), crypto = require('crypto');
const ref = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const root = threefryPRNGKey(ref.root_seed);
const tmp = new Uint32Array(4), splitWords = new Uint32Array(ref.n * 4);
let hex = '';
const firstKeys = [];
for (let j = 0; j < ref.n; j++) {
  _threefry2x32(root[0], root[1], 0, j);              // split(root, n)[j] under the foldlike layout
  const k0 = _tfOut[0], k1 = _tfOut[1];
  if (j < 4) firstKeys.push([k0, k1]);
  const r = c8Randint8(k0, k1);
  hex += (r < 16 ? '0' : '') + r.toString(16);
  threefrySplit(k0, k1, tmp);
  splitWords.set(tmp, j * 4);
}
const sha = crypto.createHash('sha1').update(Buffer.from(splitWords.buffer)).digest('hex');
const okKeys = JSON.stringify(firstKeys) === JSON.stringify(ref.first_keys);
const okR = hex === ref.randint_hex, okS = sha === ref.split_sha1;
if (!okR) { let i = 0; while (hex.substr(2 * i, 2) === ref.randint_hex.substr(2 * i, 2)) i++; console.log(`randint diverges at key ${i}: jax ${ref.randint_hex.substr(2 * i, 2)} js ${hex.substr(2 * i, 2)}`); }
console.log(`keys ${okKeys ? 'ok' : 'MISMATCH'}; randint ${okR ? ref.n + '/' + ref.n : 'MISMATCH'}; split sha1 ${okS ? 'ok' : 'MISMATCH'}`);
process.exit(okKeys && okR && okS ? 0 : 1);
