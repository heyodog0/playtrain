// 80_render.js — Craftax's frame, reproduced.
//
// The observation is 63x63: a 9-wide by 7-tall map view plus 2 inventory
// rows, every tile 7x7. That is OBS_DIM and BLOCK_PIXEL_SIZE_AGENT from
// craftax_classic/constants.py, and the textures are Craftax's own, baked to
// 7x7 (icons 5x5, digits 4x4) at build time by tools/craftax_atlas.py.
//
// This mirrors Craftax's renderer step for step, including the parts that are
// easy to miss:
//
//   * the dusk pass runs for ANY light_level < 1.0, not just at night — a
//     luminance "enhance", a blue tint, then a blend back toward the lit
//     image. Skipping it left 3087 of 3969 pixels wrong on every frame that
//     was not exactly full daylight;
//   * the player and mobs alpha-blend in float32; the result is NOT integral
//     (13.447, 93.631 ...) because Craftax's observation is float32;
//   * inventory icons are a hard overwrite and the count digits a stencil —
//     neither is ever blended — and the slot order is fixed, with diamond
//     starting the second row.
//
// Composition happens in a JS buffer rather than tile-by-tile blits, because
// the dusk and sleep passes are per-pixel over the whole map region. The
// buffer is uploaded once per region and blitted 1:1.
//
// WHAT THIS BUYS. Our uint8 frame equals Craftax's float32 frame cast to
// uint8 — `render_craftax_pixels(state).astype(uint8)` — whenever
// light_level >= 0.5. Below that Craftax adds per-pixel static drawn from
// state_rng, a JAX key PufferLib's C has no counterpart for, so those frames
// cannot be reproduced by anything with this state. See
// reference/craftax_pixels/README.md.

const RENDER_TILE = 7;              // BLOCK_PIXEL_SIZE_AGENT
const RENDER_COLS = 9;              // OBS_DIM[1]
const RENDER_ROWS = 7;              // OBS_DIM[0]
const RENDER_INV_ROWS = 2;          // INVENTORY_OBS_HEIGHT
const RENDER_W = RENDER_TILE * RENDER_COLS;              // 63
const RENDER_MAP_H = RENDER_TILE * RENDER_ROWS;          // 49
const RENDER_INV_H = RENDER_TILE * RENDER_INV_ROWS;      // 14

// Craftax's night constants.
const NIGHT_TINT = [0, 16, 64];     // night_texture
const SLEEP_TINT = [0, 0, 16];
const ENHANCE = 0.4;

let _atlasRaw = null, _iconRaw = null, _digitRaw = null;
let _mapBmp = -1, _invBmp = -1;
let _mapPx = null, _invPx = null;

function _decodeB64(s) {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lut = new Int16Array(256).fill(-1);
  for (let i = 0; i < 64; i++) lut[B64.charCodeAt(i)] = i;
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

function initRender() {
  _atlasRaw = _decodeB64(ATLAS_B64);
  _iconRaw = _decodeB64(ICONS_B64);
  _digitRaw = _decodeB64(DIGITS_B64);
  // float32 working buffers, one channel triple per pixel
  _mapPx = new Float32Array(RENDER_W * RENDER_MAP_H * 3);
  _invPx = new Float32Array(RENDER_W * RENDER_INV_H * 3);
  _mapBmp = createBitmap(RENDER_W, RENDER_MAP_H);
  _invBmp = createBitmap(RENDER_W, RENDER_INV_H);
}

// --- map composition --------------------------------------------------------

function _putTile(buf, bufW, px, py, spriteIdx) {
  const off = spriteIdx * ATLAS_STRIDE;
  for (let y = 0; y < RENDER_TILE; y++) {
    for (let x = 0; x < RENDER_TILE; x++) {
      const s = off + (y * RENDER_TILE + x) * 4;
      const d = ((py + y) * bufW + (px + x)) * 3;
      buf[d] = _atlasRaw[s];
      buf[d + 1] = _atlasRaw[s + 1];
      buf[d + 2] = _atlasRaw[s + 2];
    }
  }
}

// Craftax: pixels * (1 - alpha) + texture * alpha, float32, alpha = a / 255.
function _overTile(buf, bufW, px, py, spriteIdx) {
  const off = spriteIdx * ATLAS_STRIDE;
  for (let y = 0; y < RENDER_TILE; y++) {
    for (let x = 0; x < RENDER_TILE; x++) {
      const s = off + (y * RENDER_TILE + x) * 4;
      const d = ((py + y) * bufW + (px + x)) * 3;
      const a = F(_atlasRaw[s + 3] / 255);
      const ia = F(1 - a);
      buf[d] = F(F(buf[d] * ia) + F(_atlasRaw[s] * a));
      buf[d + 1] = F(F(buf[d + 1] * ia) + F(_atlasRaw[s + 1] * a));
      buf[d + 2] = F(F(buf[d + 2] * ia) + F(_atlasRaw[s + 2] * a));
    }
  }
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

// --- inventory --------------------------------------------------------------
// left  = (7 - int(0.8 * 7)) // 2 - 1 = 0    icon 5x5 at (0, 0) in the tile
// number_size = int(0.6 * 7) = 4, drawn at offset (7 - 4) - 1 = 2
const INV_LEFT = 0;
const INV_NUM_OFF = 2;

// Craftax's slot coordinates. Row 0 ends at iron and diamond starts row 1 —
// not a left-to-right fill.
const INV_SLOTS = [
  ['health', 0, 0], ['food', 1, 0], ['drink', 2, 0], ['energy', 3, 0],
  ['inv_sapling', 4, 0], ['inv_wood', 5, 0], ['inv_stone', 6, 0],
  ['inv_coal', 7, 0], ['inv_iron', 8, 0],
  ['inv_diamond', 0, 1], ['inv_wpick', 1, 1], ['inv_spick', 2, 1],
  ['inv_ipick', 3, 1], ['inv_wsword', 4, 1], ['inv_ssword', 5, 1],
  ['inv_isword', 6, 1],
];

function _putIcon(key, col, row) {
  const off = ICONS[key] * ICON_STRIDE;
  const px = col * RENDER_TILE + INV_LEFT;
  const py = row * RENDER_TILE + INV_LEFT;
  for (let y = 0; y < ICON_TILE; y++) {
    for (let x = 0; x < ICON_TILE; x++) {
      const s = off + (y * ICON_TILE + x) * 4;
      const d = ((py + y) * RENDER_W + (px + x)) * 3;
      _invPx[d] = _iconRaw[s];
      _invPx[d + 1] = _iconRaw[s + 1];
      _invPx[d + 2] = _iconRaw[s + 2];
    }
  }
}

// Stencil: multiply by (1 - alpha), then add the premultiplied texture. With
// alpha clamped to 0/1 upstream this is a hard replace where the digit is
// opaque and a no-op elsewhere.
function _putDigit(n, col, row) {
  const off = (n - 1) * DIGIT_STRIDE;
  const px = col * RENDER_TILE + INV_NUM_OFF;
  const py = row * RENDER_TILE + INV_NUM_OFF;
  for (let y = 0; y < DIGIT_TILE; y++) {
    for (let x = 0; x < DIGIT_TILE; x++) {
      const s = off + (y * DIGIT_TILE + x) * 4;
      if (_digitRaw[s + 3] !== 255) continue;
      const d = ((py + y) * RENDER_W + (px + x)) * 3;
      _invPx[d] = _digitRaw[s];
      _invPx[d + 1] = _digitRaw[s + 1];
      _invPx[d + 2] = _digitRaw[s + 2];
    }
  }
}

// --- upload -----------------------------------------------------------------
// float32 -> uint8 with truncation, which is what .astype(uint8) does to
// Craftax's float frame.
const _rgba = new Uint8Array(RENDER_W * RENDER_MAP_H * 4);

function _upload(buf, bmp, w, h, x, y) {
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const s = i * 3, d = i * 4;
    _rgba[d] = buf[s] | 0;
    _rgba[d + 1] = buf[s + 1] | 0;
    _rgba[d + 2] = buf[s + 2] | 0;
    _rgba[d + 3] = 255;
  }
  loadBitmap(bmp, _rgba.subarray(0, n * 4));
  image(bmp, x, y, w, h);
}

function renderGame(st) {
  if (_atlasRaw === null) initRender();

  const pr = st.playerR[0];
  const pc = st.playerC[0];
  background(0, 0, 0);

  // --- map ----------------------------------------------------------------
  for (let vr = 0; vr < RENDER_ROWS; vr++) {
    for (let vc = 0; vc < RENDER_COLS; vc++) {
      const r = pr + vr - 3;
      const c = pc + vc - 4;
      const blk = inBounds(r, c) ? mapGet(st, r, c) : BLK_OUT_OF_BOUNDS;
      _putTile(_mapPx, RENDER_W, vc * RENDER_TILE, vr * RENDER_TILE, ATLAS['block_' + blk]);
    }
  }

  // Player first, then mobs, then arrows — Craftax's order.
  _overTile(_mapPx, RENDER_W, 4 * RENDER_TILE, 3 * RENDER_TILE,
            _playerSprite(st.playerDir[0], st.isSleeping[0]));

  const drawMob = (bits, sprite) => {
    for (let vr = 0; vr < RENDER_ROWS; vr++) {
      for (let vc = 0; vc < RENDER_COLS; vc++) {
        const r = pr + vr - 3, c = pc + vc - 4;
        if (!inBounds(r, c) || !mbGet(bits, r, c)) continue;
        _overTile(_mapPx, RENDER_W, vc * RENDER_TILE, vr * RENDER_TILE, sprite);
      }
    }
  };
  drawMob(st.zombieBits, ATLAS.zombie);
  drawMob(st.cowBits, ATLAS.cow);
  drawMob(st.skelBits, ATLAS.skeleton);
  for (let i = 0; i < MAX_ARROWS; i++) {
    if (!st.arrowMask[i]) continue;
    const vr = st.arrowR[i] - pr + 3, vc = st.arrowC[i] - pc + 4;
    if (vr < 0 || vr >= RENDER_ROWS || vc < 0 || vc >= RENDER_COLS) continue;
    _overTile(_mapPx, RENDER_W, vc * RENDER_TILE, vr * RENDER_TILE,
              _arrowSprite(st.arrowDr[i], st.arrowDc[i]));
  }

  // --- dusk ---------------------------------------------------------------
  // Runs for any daylight < 1. The static branch (daylight < 0.5) is NOT
  // implemented: it draws from state_rng, which this state does not have.
  const daylight = st.lightLevel[0];
  if (daylight < 1.0) {
    const inv = F(1 - daylight);
    const n = RENDER_W * RENDER_MAP_H;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const r0 = _mapPx[o], g0 = _mapPx[o + 1], b0 = _mapPx[o + 2];
      const lum = F(F(F(0.299 * r0) + F(0.587 * g0)) + F(0.114 * b0));
      let nr = F(F(r0 * ENHANCE) + F(F(1 - ENHANCE) * lum));
      let ng = F(F(g0 * ENHANCE) + F(F(1 - ENHANCE) * lum));
      let nb = F(F(b0 * ENHANCE) + F(F(1 - ENHANCE) * lum));
      nr = F(F(0.5 * nr) + F(0.5 * NIGHT_TINT[0]));
      ng = F(F(0.5 * ng) + F(0.5 * NIGHT_TINT[1]));
      nb = F(F(0.5 * nb) + F(0.5 * NIGHT_TINT[2]));
      _mapPx[o] = F(F(daylight * r0) + F(inv * nr));
      _mapPx[o + 1] = F(F(daylight * g0) + F(inv * ng));
      _mapPx[o + 2] = F(F(daylight * b0) + F(inv * nb));
    }
  }

  // --- sleep --------------------------------------------------------------
  if (st.isSleeping[0]) {
    const n = RENDER_W * RENDER_MAP_H;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const lum = F(F(F(0.299 * _mapPx[o]) + F(0.587 * _mapPx[o + 1])) + F(0.114 * _mapPx[o + 2]));
      _mapPx[o] = F(F(0.5 * lum) + F(0.5 * SLEEP_TINT[0]));
      _mapPx[o + 1] = F(F(0.5 * lum) + F(0.5 * SLEEP_TINT[1]));
      _mapPx[o + 2] = F(F(0.5 * lum) + F(0.5 * SLEEP_TINT[2]));
    }
  }

  _upload(_mapPx, _mapBmp, RENDER_W, RENDER_MAP_H, 0, 0);

  // --- inventory ----------------------------------------------------------
  _invPx.fill(0);
  const counts = {
    health: st.health[0], food: st.food[0], drink: st.drink[0], energy: st.energy[0],
    inv_wood: st.inv[INV_WOOD], inv_stone: st.inv[INV_STONE], inv_coal: st.inv[INV_COAL],
    inv_iron: st.inv[INV_IRON], inv_diamond: st.inv[INV_DIAMOND],
    inv_sapling: st.inv[INV_SAPLING], inv_wpick: st.inv[INV_WPICK],
    inv_spick: st.inv[INV_SPICK], inv_ipick: st.inv[INV_IPICK],
    inv_wsword: st.inv[INV_WSWORD], inv_ssword: st.inv[INV_SSWORD],
    inv_isword: st.inv[INV_ISWORD],
  };
  for (let i = 0; i < INV_SLOTS.length; i++) {
    const key = INV_SLOTS[i][0], col = INV_SLOTS[i][1], row = INV_SLOTS[i][2];
    const n = counts[key];
    if (n <= 0) continue;              // Craftax draws the empty texture: black
    _putIcon(key, col, row);
    _putDigit(n > 9 ? 9 : n, col, row);
  }
  _upload(_invPx, _invBmp, RENDER_W, RENDER_INV_H, 0, RENDER_MAP_H);
}
