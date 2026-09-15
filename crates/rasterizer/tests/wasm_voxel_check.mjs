#!/usr/bin/env node
// wasm_voxel_check.mjs — cross-target gate for the voxel primitive
// (FIRST_PERSON_PLAN.md task T1). Mirrors wasm_three_check.mjs.
//
// Replays the golden scenes the Rust unit tests emit against the wasm32 build
// of this crate and asserts the pixel hashes match the native ones byte for
// byte. Native and wasm disagreeing means an f32 op leaked something
// platform-dependent into the ray march — find it, never tolerance it.
//
//   VOXEL_SCENES_OUT=/tmp/voxel.jsonl cargo test --release
//   PATH=~/.cargo/bin:$PATH cargo build --release --target wasm32-unknown-unknown
//   node tests/wasm_voxel_check.mjs /tmp/voxel.jsonl \
//        target/wasm32-unknown-unknown/release/playtrain_rasterizer.wasm
//
// `--ascii <scene>` prints the frame as text instead of gating, which is how
// you check the geometry is right rather than merely stable.
import fs from 'node:fs';

const argv = process.argv.slice(2);
const asciiAt = argv.indexOf('--ascii');
const ascii = asciiAt >= 0 ? argv[asciiAt + 1] : null;
if (asciiAt >= 0) argv.splice(asciiAt, 2);
const [scenesPath, wasmPath] = argv;
if (!scenesPath || !wasmPath) {
  console.error('usage: wasm_voxel_check.mjs [--ascii <scene>] <scenes.jsonl> <rasterizer.wasm>');
  process.exit(2);
}
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
const x = instance.exports;
const mem = () => x.memory.buffer;

// FNV-1a over the RGBA buffer, identical to the Rust test's `fnv`.
function fnv(bytes) {
  let h = 1469598103934665603n;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString();
}

function render(sc) {
  const st = x.rs_state_new();
  x.rs_state_select(st);
  const h = x.rs_new_canvas(64, 64, 64, 64);

  // The staging buffers are how JS gets a pointer into linear memory; re-fetch
  // the view after every call that can grow the heap, and re-fetch the
  // pointers themselves last, once nothing more will resize.
  const atlas = Buffer.from(sc.atlas, 'base64');
  x.rs_voxel_grid_ptr(sc.grid.length);
  x.rs_voxel_atlas_ptr(atlas.length);
  const gp = x.rs_voxel_grid_ptr(sc.grid.length);
  const ap = x.rs_voxel_atlas_ptr(atlas.length);
  new Uint16Array(mem(), gp, sc.grid.length).set(sc.grid);
  new Uint8Array(mem(), ap, atlas.length).set(atlas);

  x.rs_voxel_view(
    h, gp, sc.gw, sc.gh,
    sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view,
    ap, sc.tile_px, sc.n_tiles, sc.sky,
    sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3],
  );
  for (const [sx, sz, tile] of sc.sprites || []) {
    x.rs_voxel_sprite(
      h, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view, sx, sz,
      ap, sc.tile_px, sc.n_tiles, tile, sc.sky,
      sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3],
    );
  }
  if (sc.dusk) {
    const [daylight, k0, k1, useStatic, sleeping] = sc.dusk;
    const noise = Buffer.from(sc.noise, 'base64');
    const n = noise.length / 4;
    x.rs_voxel_noise_ptr(n);
    const np = x.rs_voxel_noise_ptr(n);
    new Uint8Array(mem(), np, noise.length).set(noise);
    x.rs_dusk(h, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3],
      daylight, k0, k1, useStatic, np, sleeping);
  }
  const ptr = x.rs_pixels_ptr(h);
  const len = x.rs_buf_len(h);
  return new Uint8Array(mem(), ptr, len);
}

const scenes = fs.readFileSync(scenesPath, 'utf8').split('\n')
  .filter((l) => l.trim()).map((l) => JSON.parse(l));

if (ascii) {
  const sc = scenes.find((s) => s.name === ascii);
  if (!sc) { console.error(`no scene ${ascii}`); process.exit(2); }
  const px = render(sc);
  const ramp = ' .:-=+*#%@';
  for (let y = 0; y < sc.dst[3]; y += 1) {
    let row = '';
    for (let xx = 0; xx < sc.dst[2]; xx++) {
      const o = ((y + sc.dst[1]) * 64 + xx + sc.dst[0]) * 4;
      const l = (px[o] + px[o + 1] + px[o + 2]) / 3;
      row += ramp[Math.min(9, Math.floor(l / 25.6))];
    }
    console.log(row);
  }
  process.exit(0);
}

let fail = 0;
for (const sc of scenes) {
  const px = render(sc);
  const got = fnv(px);
  const ok = got === sc.hash;
  const c = (24 * 64 + 32) * 4;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${sc.name} native=${sc.hash} wasm=${got} centre=${px[c]},${px[c + 1]},${px[c + 2]}`);
  if (!ok) fail = 1;
}
process.exit(fail);
