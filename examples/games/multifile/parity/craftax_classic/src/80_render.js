// 80_render.js — Craftax's own textures, at Craftax's own geometry.
//
// The observation is 63x63: a 9-wide by 7-tall map view plus 2 inventory
// rows, every tile 7x7. That is BLOCK_PIXEL_SIZE_AGENT and OBS_DIM from
// craftax_classic/constants.py, not a layout of ours.
//
// The textures are Craftax's, baked to 7x7 at build time by
// tools/craftax_atlas.py and carried in 15_atlas.js. They are uploaded once
// at setup into rasterizer bitmaps, and every tile is then a 1:1 blit — no
// resampling at runtime, so the image is identical on every backend.
//
// WHAT IS AND IS NOT VERIFIED. The geometry, the textures and the tile
// placement follow Craftax. Whether the finished frame is byte-identical to
// Craftax-Classic-Pixels has NOT been checked — that needs a comparison run
// against the JAX environment, which nothing here can do. In particular the
// overlay compositing below uses integer arithmetic, while Craftax blends in
// float; those can differ by a unit on edge pixels. See README.
//
// The dynamics parity claim (G0-G2) is unaffected either way: it compares
// state, never pixels.

const RENDER_TILE = 7;              // BLOCK_PIXEL_SIZE_AGENT
const RENDER_COLS = 9;              // OBS_DIM[1]
const RENDER_ROWS = 7;              // OBS_DIM[0]
const RENDER_INV_ROWS = 2;          // INVENTORY_OBS_HEIGHT
const RENDER_W = RENDER_TILE * RENDER_COLS;                        // 63
const RENDER_H = RENDER_TILE * (RENDER_ROWS + RENDER_INV_ROWS);    // 63

// One rasterizer bitmap per sprite, filled at setup from the baked atlas.
let _atlasBmp = null;
// A 7x7 scratch bitmap for a sprite composited over its background tile.
let _scratchBmp = -1;
const _scratchPx = new Uint8Array(RENDER_TILE * RENDER_TILE * 4);
let _atlasRaw = null;

function _decodeAtlas() {
  // base64 -> bytes, without atob (QuickJS has no DOM) and without BigInt.
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lut = new Int16Array(256).fill(-1);
  for (let i = 0; i < 64; i++) lut[B64.charCodeAt(i)] = i;
  const s = ATLAS_B64;
  let pad = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === '='; i--) pad++;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = lut[s.charCodeAt(i)], b = lut[s.charCodeAt(i + 1)];
    const c = lut[s.charCodeAt(i + 2)], d = lut[s.charCodeAt(i + 3)];
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

function _spriteBytes(index) {
  const off = index * ATLAS_STRIDE;
  return _atlasRaw.subarray(off, off + ATLAS_STRIDE);
}

function initRender() {
  _atlasRaw = _decodeAtlas();
  _atlasBmp = new Int32Array(ATLAS_COUNT);
  for (let i = 0; i < ATLAS_COUNT; i++) {
    const h = createBitmap(RENDER_TILE, RENDER_TILE);
    loadBitmap(h, _spriteBytes(i));
    _atlasBmp[i] = h;
  }
  _scratchBmp = createBitmap(RENDER_TILE, RENDER_TILE);
}

// Draw sprite `idx` at tile (col, row) of the grid, 1:1.
function _blit(idx, col, row) {
  image(_atlasBmp[idx], col * RENDER_TILE, row * RENDER_TILE, RENDER_TILE, RENDER_TILE);
}

// Composite an alpha sprite over a background sprite and blit the result.
//
// rs_draw_image is a straight byte copy with no blending — deliberately, so
// that blits stay integer-only and bit-exact — so anything with an alpha
// edge has to be composited before it is uploaded. Integer arithmetic with
// round-half-up; see the honesty note at the top of this file.
function _blitOver(bgIdx, fgIdx, col, row) {
  const bg = _spriteBytes(bgIdx);
  const fg = _spriteBytes(fgIdx);
  for (let i = 0; i < ATLAS_STRIDE; i += 4) {
    const a = fg[i + 3];
    if (a === 255) {
      _scratchPx[i] = fg[i]; _scratchPx[i + 1] = fg[i + 1];
      _scratchPx[i + 2] = fg[i + 2];
    } else if (a === 0) {
      _scratchPx[i] = bg[i]; _scratchPx[i + 1] = bg[i + 1];
      _scratchPx[i + 2] = bg[i + 2];
    } else {
      const ia = 255 - a;
      _scratchPx[i] = ((fg[i] * a + bg[i] * ia + 127) / 255) | 0;
      _scratchPx[i + 1] = ((fg[i + 1] * a + bg[i + 1] * ia + 127) / 255) | 0;
      _scratchPx[i + 2] = ((fg[i + 2] * a + bg[i + 2] * ia + 127) / 255) | 0;
    }
    _scratchPx[i + 3] = 255;
  }
  loadBitmap(_scratchBmp, _scratchPx);
  image(_scratchBmp, col * RENDER_TILE, row * RENDER_TILE, RENDER_TILE, RENDER_TILE);
}

function _playerSprite(dir, asleep) {
  if (asleep) return ATLAS.player_sleep;
  if (dir === 1) return ATLAS.player_left;
  if (dir === 2) return ATLAS.player_right;
  if (dir === 3) return ATLAS.player_up;
  return ATLAS.player_down;
}

function _arrowSprite(dr, dc) {
  if (dr < 0) return ATLAS.arrow_up;
  if (dr > 0) return ATLAS.arrow_down;
  if (dc < 0) return ATLAS.arrow_left;
  return ATLAS.arrow_right;
}

// Inventory rows. Craftax shows the four intrinsics then the items and
// tools, each with its count as a digit. The exact slot order here is ours,
// not verified against Craftax's renderer — see the note at the top.
const _INV_ROW_A = ['health', 'food', 'drink', 'energy',
                    'inv_wood', 'inv_stone', 'inv_coal', 'inv_iron', 'inv_diamond'];
const _INV_ROW_B = ['inv_sapling', 'inv_wpick', 'inv_spick', 'inv_ipick',
                    'inv_wsword', 'inv_ssword', 'inv_isword'];

function renderGame(st) {
  if (_atlasBmp === null) initRender();

  const pr = st.playerR[0];
  const pc = st.playerC[0];

  background(0, 0, 0);

  // --- the 9x7 map view --------------------------------------------------
  for (let vr = 0; vr < RENDER_ROWS; vr++) {
    for (let vc = 0; vc < RENDER_COLS; vc++) {
      const r = pr + vr - 3;
      const c = pc + vc - 4;
      const blk = inBounds(r, c) ? mapGet(st, r, c) : BLK_OUT_OF_BOUNDS;
      const bgIdx = ATLAS['block_' + blk];

      if (!inBounds(r, c)) { _blit(bgIdx, vc, vr); continue; }

      let fg = -1;
      if (mbGet(st.zombieBits, r, c)) fg = ATLAS.zombie;
      else if (mbGet(st.cowBits, r, c)) fg = ATLAS.cow;
      else if (mbGet(st.skelBits, r, c)) fg = ATLAS.skeleton;
      if (fg < 0 && mbGet(st.arrowBits, r, c)) {
        for (let i = 0; i < MAX_ARROWS; i++) {
          if (st.arrowMask[i] && st.arrowR[i] === r && st.arrowC[i] === c) {
            fg = _arrowSprite(st.arrowDr[i], st.arrowDc[i]);
            break;
          }
        }
      }
      if (vr === 3 && vc === 4) fg = _playerSprite(st.playerDir[0], st.isSleeping[0]);

      if (fg < 0) _blit(bgIdx, vc, vr);
      else _blitOver(bgIdx, fg, vc, vr);
    }
  }

  // --- the two inventory rows --------------------------------------------
  const counts = {
    health: st.health[0], food: st.food[0], drink: st.drink[0], energy: st.energy[0],
    inv_wood: st.inv[INV_WOOD], inv_stone: st.inv[INV_STONE], inv_coal: st.inv[INV_COAL],
    inv_iron: st.inv[INV_IRON], inv_diamond: st.inv[INV_DIAMOND],
    inv_sapling: st.inv[INV_SAPLING], inv_wpick: st.inv[INV_WPICK],
    inv_spick: st.inv[INV_SPICK], inv_ipick: st.inv[INV_IPICK],
    inv_wsword: st.inv[INV_WSWORD], inv_ssword: st.inv[INV_SSWORD],
    inv_isword: st.inv[INV_ISWORD],
  };

  const drawSlot = (key, col, row) => {
    const n = counts[key];
    if (!n || n <= 0) return;              // empty slots stay black, as in Craftax
    const icon = ATLAS[key];
    const d = n > 9 ? 9 : n;
    _blitOver(icon, ATLAS['digit_' + d], col, row);
  };

  for (let i = 0; i < _INV_ROW_A.length; i++) drawSlot(_INV_ROW_A[i], i, RENDER_ROWS);
  for (let i = 0; i < _INV_ROW_B.length; i++) drawSlot(_INV_ROW_B[i], i, RENDER_ROWS + 1);
}
