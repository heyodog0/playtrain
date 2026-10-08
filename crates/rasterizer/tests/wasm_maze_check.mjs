#!/usr/bin/env node
// wasm_maze_check.mjs — cross-target gate for the DMLab maze primitive
// (dmlab PLAN.md §3.3, G1). Mirrors wasm_voxel_check.mjs.
//
// Replays the golden scenes the Rust unit tests in src/maze.rs emit against
// the wasm32 build and asserts the pixel hashes match native byte for byte.
// With --js <raster.mjs> it replays them through the pure-JS port as well.
//
//   MAZE_SCENES_OUT=/tmp/maze.jsonl cargo test --release maze
//   PATH=~/.cargo/bin:$PATH cargo build --release --target wasm32-unknown-unknown
//   node tests/wasm_maze_check.mjs /tmp/maze.jsonl \
//        target/wasm32-unknown-unknown/release/playtrain_rasterizer.wasm [--js ../../runtime/p5/raster.mjs]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const jsAt = argv.indexOf('--js');
const jsPath = jsAt >= 0 ? argv[jsAt + 1] : null;
if (jsAt >= 0) argv.splice(jsAt, 2);
const [scenesPath, wasmPath] = argv;
if (!scenesPath || !wasmPath) {
  console.error('usage: wasm_maze_check.mjs <scenes.jsonl> <rasterizer.wasm> [--js raster.mjs]');
  process.exit(2);
}
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
const x = instance.exports;
const mem = () => x.memory.buffer;

function fnv(bytes) {
  let h = 1469598103934665603n;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString();
}

function renderWasmBoxes(sc) {
  const st = x.rs_state_new();
  x.rs_state_select(st);
  const h = x.rs_new_canvas(64, 64, 64, 64);
  const atlas = Buffer.from(sc.atlas, 'base64');
  // Box records are staged through the voxel f32 (noise) buffer.
  x.rs_voxel_noise_ptr(sc.boxes.length);
  x.rs_voxel_atlas_ptr(atlas.length);
  const bp = x.rs_voxel_noise_ptr(sc.boxes.length);
  const ap = x.rs_voxel_atlas_ptr(atlas.length);
  new Float32Array(mem(), bp, sc.boxes.length).set(sc.boxes);
  new Uint8Array(mem(), ap, atlas.length).set(atlas);
  x.rs_maze_boxes(h, bp, sc.boxes.length / 60, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view,
    ap, sc.tile_px, sc.n_tiles, sc.sky, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
  for (const [sx, sz, by, sw, sh, t] of sc.sprites) {
    x.rs_maze_sprite(h, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view, sx, sz, by, sw, sh,
      ap, sc.tile_px, sc.n_tiles, t, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
  }
  return new Uint8Array(mem(), x.rs_pixels_ptr(h), x.rs_buf_len(h)).slice();
}

// Boxes, then quads over them; both staged in turn through the noise buffer
// (each call copies its records before the next is staged).
function renderWasmQuads(sc) {
  const st = x.rs_state_new();
  x.rs_state_select(st);
  const h = x.rs_new_canvas(64, 64, 64, 64);
  const atlas = Buffer.from(sc.atlas, 'base64');
  const big = Math.max(sc.boxes.length, sc.quads.length);
  x.rs_voxel_noise_ptr(big);
  x.rs_voxel_atlas_ptr(atlas.length);
  const bp = x.rs_voxel_noise_ptr(big);
  const ap = x.rs_voxel_atlas_ptr(atlas.length);
  new Uint8Array(mem(), ap, atlas.length).set(atlas);
  new Float32Array(mem(), bp, sc.boxes.length).set(sc.boxes);
  x.rs_maze_boxes(h, bp, sc.boxes.length / 60, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view,
    ap, sc.tile_px, sc.n_tiles, sc.sky, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
  new Float32Array(mem(), bp, sc.quads.length).set(sc.quads);
  x.rs_maze_quads(h, bp, sc.quads.length / 12, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view,
    ap, sc.tile_px, sc.n_tiles, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
  return new Uint8Array(mem(), x.rs_pixels_ptr(h), x.rs_buf_len(h)).slice();
}

// Boxes, then the sky cube over the sky; the boxes and then the cube's bytes
// are staged in turn through the noise buffer.
function renderWasmSky(sc) {
  const st = x.rs_state_new();
  x.rs_state_select(st);
  const h = x.rs_new_canvas(64, 64, 64, 64);
  const atlas = Buffer.from(sc.atlas, 'base64');
  const sky = Buffer.from(sc.sky_faces, 'base64');
  const big = Math.max(sc.boxes.length, sky.length / 4);
  x.rs_voxel_noise_ptr(big);
  x.rs_voxel_atlas_ptr(atlas.length);
  const bp = x.rs_voxel_noise_ptr(big);
  const ap = x.rs_voxel_atlas_ptr(atlas.length);
  new Uint8Array(mem(), ap, atlas.length).set(atlas);
  new Float32Array(mem(), bp, sc.boxes.length).set(sc.boxes);
  x.rs_maze_boxes(h, bp, sc.boxes.length / 60, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view,
    ap, sc.tile_px, sc.n_tiles, sc.sky, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
  new Uint8Array(mem(), bp, sky.length).set(sky);
  x.rs_maze_sky(h, sc.yaw, bp, sc.sky_px, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
  return new Uint8Array(mem(), x.rs_pixels_ptr(h), x.rs_buf_len(h)).slice();
}

// The pitched view: panorama bytes through the atlas buffer, quads through
// the noise (f32) buffer.
function renderWasmPview(sc) {
  const st = x.rs_state_new();
  x.rs_state_select(st);
  const h = x.rs_new_canvas(64, 64, 64, 64);
  const pano = Buffer.from(sc.pano, 'base64');
  x.rs_voxel_noise_ptr(sc.quads.length);
  x.rs_voxel_atlas_ptr(pano.length);
  const qp = x.rs_voxel_noise_ptr(sc.quads.length);
  const pp = x.rs_voxel_atlas_ptr(pano.length);
  new Float32Array(mem(), qp, sc.quads.length).set(sc.quads);
  new Uint8Array(mem(), pp, pano.length).set(pano);
  x.rs_maze_pview(h, sc.yaw, sc.pitch, sc.view, pp, sc.pano_px, qp, sc.quads.length / 12,
    sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
  return new Uint8Array(mem(), x.rs_pixels_ptr(h), x.rs_buf_len(h)).slice();
}

function renderWasm(sc) {
  // the maze pitch is per thread in Rust and outlives a scene: set it every time
  x.rs_maze_pitch(0, sc.pitch || 0);
  if (sc.kind === 'pview') return renderWasmPview(sc);
  if (sc.kind === 'boxes') return renderWasmBoxes(sc);
  if (sc.kind === 'sky') return renderWasmSky(sc);
  if (sc.kind === 'quads') return renderWasmQuads(sc);
  const st = x.rs_state_new();
  x.rs_state_select(st);
  const h = x.rs_new_canvas(64, 64, 64, 64);
  const atlas = Buffer.from(sc.atlas, 'base64');
  // The maze planes are staged through the voxel grid buffer (maze.rs).
  x.rs_voxel_grid_ptr(sc.cells.length);
  x.rs_voxel_atlas_ptr(atlas.length);
  const gp = x.rs_voxel_grid_ptr(sc.cells.length);
  const ap = x.rs_voxel_atlas_ptr(atlas.length);
  new Uint16Array(mem(), gp, sc.cells.length).set(sc.cells);
  new Uint8Array(mem(), ap, atlas.length).set(atlas);
  x.rs_maze_view(h, gp, sc.w, sc.h, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view,
    ap, sc.tile_px, sc.n_tiles, sc.sky, sc.decal[0], sc.decal[1],
    sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
  for (const [sx, sz, by, sw, sh, t] of sc.sprites) {
    x.rs_maze_sprite(h, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view, sx, sz, by, sw, sh,
      ap, sc.tile_px, sc.n_tiles, t, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
  }
  for (const [sx, sz, by, sw, sh, t, c1, c2] of sc.sprites2 || []) {
    x.rs_maze_sprite2(h, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view, sx, sz, by, sw, sh,
      ap, sc.tile_px, sc.n_tiles, t, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3], c1, c2);
  }
  return new Uint8Array(mem(), x.rs_pixels_ptr(h), x.rs_buf_len(h)).slice();
}

let JsCanvas = null;
if (jsPath) {
  const mod = await import(pathToFileURL(path.resolve(jsPath)).href);
  JsCanvas = mod.createCanvas;
}

function renderJs(sc) {
  const c = JsCanvas(64, 64, 64, 64).getContext('2d');
  c.mazePitch(sc.pitch || 0);
  if (sc.kind === 'pview') {
    const qs = Float32Array.from(sc.quads);
    c.mazePview(sc.yaw, sc.pitch, sc.view, new Uint8Array(Buffer.from(sc.pano, 'base64')), sc.pano_px,
      qs, qs.length / 12, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
    return c.px;
  }
  const atlas = new Uint8Array(Buffer.from(sc.atlas, 'base64'));
  if (sc.kind === 'sky') {
    const bx = Float32Array.from(sc.boxes);
    c.mazeBoxes(bx, bx.length / 60, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view,
      atlas, sc.tile_px, sc.n_tiles, sc.sky, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
    c.mazeSky(sc.yaw, new Uint8Array(Buffer.from(sc.sky_faces, 'base64')), sc.sky_px,
      sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
    return c.px;
  }
  if (sc.kind === 'quads') {
    const bx = Float32Array.from(sc.boxes), qs = Float32Array.from(sc.quads);
    c.mazeBoxes(bx, bx.length / 60, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view,
      atlas, sc.tile_px, sc.n_tiles, sc.sky, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
    c.mazeQuads(qs, qs.length / 12, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view,
      atlas, sc.tile_px, sc.n_tiles, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
    return c.px;
  }
  if (sc.kind === 'boxes') {
    const bx = Float32Array.from(sc.boxes);
    c.mazeBoxes(bx, bx.length / 60, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view,
      atlas, sc.tile_px, sc.n_tiles, sc.sky, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
    for (const [sx, sz, by, sw, sh, t] of sc.sprites) {
      c.mazeSprite(sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view, sx, sz, by, sw, sh,
        atlas, sc.tile_px, sc.n_tiles, t, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
    }
    return c.px;
  }
  const cells = Uint16Array.from(sc.cells);
  c.mazeView(cells, sc.w, sc.h, sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view,
    atlas, sc.tile_px, sc.n_tiles, sc.sky, sc.decal[0], sc.decal[1],
    sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
  for (const [sx, sz, by, sw, sh, t] of sc.sprites) {
    c.mazeSprite(sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view, sx, sz, by, sw, sh,
      atlas, sc.tile_px, sc.n_tiles, t, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3]);
  }
  for (const [sx, sz, by, sw, sh, t, c1, c2] of sc.sprites2 || []) {
    c.mazeSprite2(sc.eye[0], sc.eye[1], sc.eye[2], sc.yaw, sc.view, sx, sz, by, sw, sh,
      atlas, sc.tile_px, sc.n_tiles, t, sc.dst[0], sc.dst[1], sc.dst[2], sc.dst[3], c1, c2);
  }
  return c.px;
}

const scenes = fs.readFileSync(scenesPath, 'utf8').split('\n')
  .filter((l) => l.trim()).map((l) => JSON.parse(l));
let fail = 0;
for (const sc of scenes) {
  const w = fnv(renderWasm(sc));
  let line = `${w === sc.hash ? 'PASS' : 'FAIL'} ${sc.name} native=${sc.hash} wasm=${w}`;
  if (w !== sc.hash) fail = 1;
  if (JsCanvas) {
    const j = fnv(renderJs(sc));
    line += ` js=${j}${j === sc.hash ? '' : ' JS-FAIL'}`;
    if (j !== sc.hash) fail = 1;
  }
  console.log(line);
}
process.exit(fail);
