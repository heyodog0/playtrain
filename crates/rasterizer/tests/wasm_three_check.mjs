#!/usr/bin/env node
// wasm_three_check.mjs — cross-target gate for the 3D pipeline (plan task 3).
//
// Replays the golden scenes the Rust unit tests emit (THREE_SCENES_OUT=<file>
// cargo test --release) against the wasm32 build of this crate and asserts the
// pixel hashes match the native ones byte for byte.
//
//   THREE_SCENES_OUT=/tmp/scenes.jsonl cargo test --release
//   PATH=~/.cargo/bin:$PATH cargo build --release --target wasm32-unknown-unknown
//   node tests/wasm_three_check.mjs /tmp/scenes.jsonl \
//        target/wasm32-unknown-unknown/release/playtrain_rasterizer.wasm
import fs from 'node:fs';

const [scenesPath, wasmPath] = process.argv.slice(2);
if (!scenesPath || !wasmPath) {
  console.error('usage: wasm_three_check.mjs <scenes.jsonl> <rasterizer.wasm>');
  process.exit(2);
}
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
const x = instance.exports;

// FNV-1a over the RGBA buffer, identical to the Rust test's `fnv`.
function fnv(bytes) {
  let h = 1469598103934665603n;  // the crate's (non-standard) FNV basis, see rs_frame_end
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString();
}

function run(h, ops) {
  for (const op of ops) {
    const [k, ...a] = op;
    switch (k) {
      case 'bg':
        x.rs_save(h); x.rs_reset_transform(h); x.rs_set_fill(h, a[0], a[1], a[2], 255);
        x.rs_fill_rect(h, 0, 0, 400, 400); x.rs_restore(h); x.rs_3d_clear_depth();
        break;
      case 'push': x.rs_3d_push(); break;
      case 'pop': x.rs_3d_pop(); break;
      case 'tr': x.rs_3d_translate(...a); break;
      case 'rx': x.rs_3d_rotate_x(a[0]); break;
      case 'ry': x.rs_3d_rotate_y(a[0]); break;
      case 'rz': x.rs_3d_rotate_z(a[0]); break;
      case 'fill': x.rs_3d_fill(...a); break;
      case 'amb': x.rs_3d_ambient_material(...a); break;
      case 'spec': x.rs_3d_specular_material(...a); break;
      case 'shin': x.rs_3d_shininess(a[0]); break;
      case 'al': x.rs_3d_ambient_light(...a); break;
      case 'dl': x.rs_3d_directional_light(...a); break;
      case 'pl': x.rs_3d_point_light(...a); break;
      case 'box': x.rs_3d_box(...a); break;
      case 'sph': x.rs_3d_sphere(a[0]); break;
      case 'ell': x.rs_3d_ellipsoid(...a); break;
      case 'cyl': x.rs_3d_cylinder(...a); break;
      case 'cone': x.rs_3d_cone(...a); break;
      default: throw new Error(`unknown op ${k}`);
    }
  }
}

let fail = 0;
for (const line of fs.readFileSync(scenesPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const sc = JSON.parse(line);
  const st = x.rs_state_new();
  x.rs_state_select(st);
  const h = x.rs_new_canvas(400, 400, 64, 64);
  x.rs_3d_begin(h, 400, 400);
  x.rs_3d_frame_begin();
  run(h, sc.ops);
  const ptr = x.rs_pixels_ptr(h);
  const len = x.rs_buf_len(h);
  const px = new Uint8Array(x.memory.buffer, ptr, len);
  const got = fnv(px);
  const ok = got === sc.hash;
  let lit = 0; for (let i = 0; i < 64 * 64; i++) if (px[i * 4] | px[i * 4 + 1] | px[i * 4 + 2]) lit++;
  const c = (32 * 64 + 32) * 4;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${sc.name} native=${sc.hash} wasm=${got} lit=${lit} centre=${px[c]},${px[c + 1]},${px[c + 2]}`);
  if (!ok) fail = 1;
}
process.exit(fail);
