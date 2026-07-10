// dict_diff.mjs — V8 reference for the js::Object differential test. Runs a
// seeded op stream (insert numeric-key, insert string-key, delete) mirroring
// cavequest's persistentDrops usage, and prints an ORDER-SENSITIVE checksum of
// the object after each op. The C++ side (dict_diff.cpp) must match byte-for-byte.
//   node dict_diff.mjs <seed> <nsteps>
const seed = (process.argv[2] !== undefined ? Number(process.argv[2]) : 1) >>> 0;
const nsteps = process.argv[3] !== undefined ? Number(process.argv[3]) : 5000;

function mulberry32(s) {
  let t = s >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);

function fold(h, x) { return (Math.imul(h ^ (x >>> 0), 16777619) >>> 0); }
let obj = {};
function checksum() {
  let h = 2166136261 >>> 0, pos = 0;
  for (const k in obj) {                     // ES for..in order
    h = fold(h, pos);
    for (let i = 0; i < k.length; i++) h = fold(h, k.charCodeAt(i));
    h = fold(h, obj[k] | 0);                 // value (int32)
    pos++;
  }
  return h >>> 0;
}

for (let step = 0; step < nsteps; step++) {
  const roll = rng();
  if (roll < 0.4) {                          // numeric subscript -> string key
    const k = Math.floor(rng() * 25);
    obj[k] = Math.floor(rng() * 1000);
  } else if (roll < 0.7) {                   // template-literal string key
    const a = Math.floor(rng() * 8), b = Math.floor(rng() * 8);
    obj[`${a},${b}`] = Math.floor(rng() * 1000);
  } else if (roll < 0.85) {                  // delete numeric key
    const k = Math.floor(rng() * 25);
    delete obj[k];
  } else {                                   // delete string key
    const a = Math.floor(rng() * 8), b = Math.floor(rng() * 8);
    delete obj[`${a},${b}`];
  }
  console.log(`${step} n=${Object.keys(obj).length} h=${checksum()}`);
}
