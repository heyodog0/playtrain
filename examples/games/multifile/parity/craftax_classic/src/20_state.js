// 20_state.js — the game state, in one ArrayBuffer.
//
// Mirrors `struct Env` (craftax_classic.h lines 162-230), restricted to the
// fields PLAN 1.1 calls state. The observation buffer, the log struct and the
// reward scratch are not state and are not here.
//
// Three things this buys, all of them about parity rather than speed:
//
//   Wrap semantics for free. `health -= 7` on an Int8Array wraps exactly like
//   C's int8_t, so the zombie-hits-a-sleeper case (-7, and the C does not
//   clamp health) needs no hand-written masking.
//
//   One place to serialise. getParityState() walks a single table, and
//   cc_ref_driver.c's cc_serialize walks the same table in the same order.
//
//   Reset is fill(0) plus what generate_world sets.
//
// STORAGE ORDER IS NOT DUMP ORDER. Typed-array views need their natural
// alignment, and the canonical dump is packed with no padding — it puts a
// float32 at offset 6674, which is not 4-aligned. So fields are stored
// grouped by width (4-byte, then 2-byte, then 1-byte) and the serializer
// reorders on the way out. PARITY_ORDER below is the dump order and is the
// one that has to match the C.

// --- storage layout -------------------------------------------------------
// [name, kind, count]. Kind picks both the view type and the C type it
// mirrors. Order within each width group is the struct's order.
const STATE_FIELDS_U32 = [
  ['pcg', 2],            // the 64-bit PCG state as two uint32 words, lo then hi
  ['mobBits', 128],      // 64 rows x 2 words; see common/u64bits.js
  ['zombieBits', 128],
  ['cowBits', 128],
  ['skelBits', 128],
  ['arrowBits', 128],
];
const STATE_FIELDS_F32 = [
  ['recover', 1], ['hunger', 1], ['thirst', 1], ['fatigue', 1],
  ['lightLevel', 1],
];
const STATE_FIELDS_I32 = [
  ['timestep', 1],
];
const STATE_FIELDS_I16 = [
  ['playerR', 1], ['playerC', 1],
  ['zombieR', MAX_ZOMBIES], ['zombieC', MAX_ZOMBIES],
  ['cowR', MAX_COWS], ['cowC', MAX_COWS],
  ['skelR', MAX_SKELETONS], ['skelC', MAX_SKELETONS],
  ['arrowR', MAX_ARROWS], ['arrowC', MAX_ARROWS],
  ['plantR', MAX_PLANTS], ['plantC', MAX_PLANTS], ['plantAge', MAX_PLANTS],
];
const STATE_FIELDS_I8 = [
  ['playerDir', 1],
  ['health', 1], ['food', 1], ['drink', 1], ['energy', 1],
  ['inv', NUM_INVENTORY],
  ['zombieHp', MAX_ZOMBIES], ['zombieCd', MAX_ZOMBIES],
  ['cowHp', MAX_COWS],
  ['skelHp', MAX_SKELETONS], ['skelCd', MAX_SKELETONS],
  ['arrowDr', MAX_ARROWS], ['arrowDc', MAX_ARROWS],
];
const STATE_FIELDS_U8 = [
  ['mapPacked', MAP_PACKED_SIZE],
  ['isSleeping', 1],
  ['zombieMask', MAX_ZOMBIES],
  ['cowMask', MAX_COWS],
  ['skelMask', MAX_SKELETONS],
  ['arrowMask', MAX_ARROWS],
  ['plantMask', MAX_PLANTS],
  ['achievements', NUM_ACHIEVEMENTS],
];

// The canonical dump: [canonicalName, jsName, kind]. This is struct
// declaration order, fixed width, no padding, little-endian, and it must
// match `cc_ref layout` exactly. 'u64pairs' means uint32 words that are
// already lo, hi per row and pass through unchanged.
const PARITY_ORDER = [
  ['pcg', 'pcg', 'u32'],
  ['map_packed', 'mapPacked', 'u8'],
  ['mob_bits', 'mobBits', 'u32'],
  ['zombie_bits', 'zombieBits', 'u32'],
  ['cow_bits', 'cowBits', 'u32'],
  ['skel_bits', 'skelBits', 'u32'],
  ['arrow_bits', 'arrowBits', 'u32'],
  ['player_r', 'playerR', 'i16'],
  ['player_c', 'playerC', 'i16'],
  ['player_dir', 'playerDir', 'i8'],
  ['health', 'health', 'i8'],
  ['food', 'food', 'i8'],
  ['drink', 'drink', 'i8'],
  ['energy', 'energy', 'i8'],
  ['is_sleeping', 'isSleeping', 'u8'],
  ['recover', 'recover', 'f32'],
  ['hunger', 'hunger', 'f32'],
  ['thirst', 'thirst', 'f32'],
  ['fatigue', 'fatigue', 'f32'],
  ['inv', 'inv', 'i8'],
  ['zombie_r', 'zombieR', 'i16'],
  ['zombie_c', 'zombieC', 'i16'],
  ['zombie_hp', 'zombieHp', 'i8'],
  ['zombie_cd', 'zombieCd', 'i8'],
  ['zombie_mask', 'zombieMask', 'u8'],
  ['cow_r', 'cowR', 'i16'],
  ['cow_c', 'cowC', 'i16'],
  ['cow_hp', 'cowHp', 'i8'],
  ['cow_mask', 'cowMask', 'u8'],
  ['skel_r', 'skelR', 'i16'],
  ['skel_c', 'skelC', 'i16'],
  ['skel_hp', 'skelHp', 'i8'],
  ['skel_cd', 'skelCd', 'i8'],
  ['skel_mask', 'skelMask', 'u8'],
  ['arrow_r', 'arrowR', 'i16'],
  ['arrow_c', 'arrowC', 'i16'],
  ['arrow_dr', 'arrowDr', 'i8'],
  ['arrow_dc', 'arrowDc', 'i8'],
  ['arrow_mask', 'arrowMask', 'u8'],
  ['plant_r', 'plantR', 'i16'],
  ['plant_c', 'plantC', 'i16'],
  ['plant_age', 'plantAge', 'i16'],
  ['plant_mask', 'plantMask', 'u8'],
  ['light_level', 'lightLevel', 'f32'],
  ['achievements', 'achievements', 'u8'],
  ['timestep', 'timestep', 'i32'],
  // reward is appended by the serializer; it is the step's value, not a field
];

const PARITY_WIDTH = { u8: 1, i8: 1, i16: 2, i32: 4, u32: 4, f32: 4 };

function parityStateBytes() {
  let n = 0;
  for (let i = 0; i < PARITY_ORDER.length; i++) {
    const [, jsName, kind] = PARITY_ORDER[i];
    n += PARITY_WIDTH[kind] * stateFieldCount(jsName);
  }
  return n + 4;   // + reward
}

// Element counts, built from the tables above so they are known before any
// state exists — parityStateBytes() is used to size the writer.
const _STATE_COUNTS = (function () {
  const out = {};
  const all = [STATE_FIELDS_U32, STATE_FIELDS_F32, STATE_FIELDS_I32,
               STATE_FIELDS_I16, STATE_FIELDS_I8, STATE_FIELDS_U8];
  for (let g = 0; g < all.length; g++) {
    for (let i = 0; i < all[g].length; i++) out[all[g][i][0]] = all[g][i][1];
  }
  return out;
})();

function stateFieldCount(name) {
  return _STATE_COUNTS[name];
}

// Build the buffer. Widest views first so every view is naturally aligned.
function createState() {
  const groups = [
    [STATE_FIELDS_U32, 4], [STATE_FIELDS_F32, 4], [STATE_FIELDS_I32, 4],
    [STATE_FIELDS_I16, 2], [STATE_FIELDS_I8, 1], [STATE_FIELDS_U8, 1],
  ];
  let size = 0;
  for (let g = 0; g < groups.length; g++) {
    const [fields, width] = groups[g];
    for (let i = 0; i < fields.length; i++) size += fields[i][1] * width;
  }
  const buffer = new ArrayBuffer(size);
  const st = { buffer, byteLength: size };

  let off = 0;
  const bind = (fields, width, make) => {
    for (let i = 0; i < fields.length; i++) {
      const [name, count] = fields[i];
      st[name] = make(buffer, off, count);
      off += count * width;
    }
  };
  bind(STATE_FIELDS_U32, 4, (b, o, n) => new Uint32Array(b, o, n));
  bind(STATE_FIELDS_F32, 4, (b, o, n) => new Float32Array(b, o, n));
  bind(STATE_FIELDS_I32, 4, (b, o, n) => new Int32Array(b, o, n));
  bind(STATE_FIELDS_I16, 2, (b, o, n) => new Int16Array(b, o, n));
  bind(STATE_FIELDS_I8, 1, (b, o, n) => new Int8Array(b, o, n));
  bind(STATE_FIELDS_U8, 1, (b, o, n) => new Uint8Array(b, o, n));
  return st;
}

// Zero everything. generate_world sets the rest; the PCG state is NOT reset
// here, because reseeding is resetGame's job (PLAN 3.4).
function clearState(st) {
  new Uint8Array(st.buffer).fill(0);
}

// --- the canonical dump ---------------------------------------------------
// Writes exactly cc_serialize's bytes. Single-element fields are still typed
// arrays, so everything is indexed uniformly.
function getParityState(st, reward) {
  const w = new ParityWriter(parityStateBytes());
  for (let i = 0; i < PARITY_ORDER.length; i++) {
    const [, jsName, kind] = PARITY_ORDER[i];
    const arr = st[jsName];
    for (let k = 0; k < arr.length; k++) {
      switch (kind) {
        case 'u8': w.u8(arr[k]); break;
        case 'i8': w.i8(arr[k]); break;
        case 'i16': w.i16(arr[k]); break;
        case 'i32': w.i32(arr[k]); break;
        case 'u32': w.u32(arr[k]); break;
        case 'f32': w.f32(arr[k]); break;
      }
    }
  }
  w.f32(reward);
  return w.bytes;
}

// --- map accessors, mirroring lines 236-242 -------------------------------
function mapGet(st, r, c) {
  return st.mapPacked[r * MAP_SIZE + c];
}

function mapSet(st, r, c, v) {
  st.mapPacked[r * MAP_SIZE + c] = v;
}

function inBounds(r, c) {
  return (r >>> 0) < MAP_SIZE && (c >>> 0) < MAP_SIZE;
}
