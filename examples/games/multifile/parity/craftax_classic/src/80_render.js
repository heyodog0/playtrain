// 80_render.js — house-style rendering, aligned to the observation grid.
//
// PLAN 6. Canvas 512x512 and obs 64x64, so one obs pixel is an 8x8 canvas
// block. Tiles are 56 canvas px = exactly 7 obs px, laid out 9 columns x 7
// rows (504x392) — the same 7x9 window compute_observations reads — then two
// 56px rows for the inventory strip and the status bars, giving 504x504 with
// an 8px margin right and bottom. Every tile edge lands on an obs pixel
// boundary, so a block is a crisp 7x7 in the observation rather than a
// smeared 6.8.
//
// Constraints this file keeps to, all of them so the rasterizer path is the
// one every catalog game already gates on:
//   - flat fills plus at most one primitive glyph per block
//   - no images and no text(); digits come from a 3x5 segment table
//   - reads state only: never mutates, never draws from the RNG
//
// The pixels are explicitly NOT part of the parity claim. PufferLib's
// textures are a raylib viewer and its training is symbolic; Craftax's own
// pixel env is a third, different image. See README.md.

const RENDER_CANVAS = 512;
const RENDER_TILE = 56;          // 7 obs pixels
const RENDER_COLS = 9;           // dc -4..4, matching compute_observations
const RENDER_ROWS = 7;           // dr -3..3
const RENDER_VIEW_H = RENDER_TILE * RENDER_ROWS;   // 392
const RENDER_HUD_Y = RENDER_VIEW_H;                // inventory strip
const RENDER_BAR_Y = RENDER_VIEW_H + RENDER_TILE;  // status bars

// Flat colour per block id, indexed by BLK_*.
const BLOCK_COLOURS = [
  [0, 0, 0],          // 0  invalid
  [12, 12, 16],       // 1  out of bounds
  [86, 142, 66],      // 2  grass
  [54, 98, 178],      // 3  water
  [128, 128, 132],    // 4  stone
  [42, 104, 52],      // 5  tree
  [138, 98, 58],      // 6  wood
  [162, 148, 122],    // 7  path
  [58, 58, 62],       // 8  coal
  [176, 142, 108],    // 9  iron
  [110, 200, 214],    // 10 diamond
  [150, 106, 58],     // 11 table
  [96, 92, 96],       // 12 furnace
  [214, 200, 140],    // 13 sand
  [206, 88, 40],      // 14 lava
  [76, 158, 74],      // 15 plant
  [196, 190, 70],     // 16 ripe plant
];

// 3x5 segment font, one bit per cell, row-major from the top. Only digits:
// the inventory strip is the only place the render shows a number.
const DIGIT_GLYPHS = [
  0b111101101101111, // 0
  0b010110010010111, // 1
  0b111001111100111, // 2
  0b111001111001111, // 3
  0b101101111001001, // 4
  0b111100111001111, // 5
  0b111100111101111, // 6
  0b111001001001001, // 7
  0b111101111101111, // 8
  0b111101111001111, // 9
];

function renderDim(rgb, light) {
  // Night multiplies tile colour by light_level, so the observation carries
  // time of day the way the original pixel env does.
  return [
    (rgb[0] * light) | 0,
    (rgb[1] * light) | 0,
    (rgb[2] * light) | 0,
  ];
}

function renderDigit(d, x, y, px) {
  const glyph = DIGIT_GLYPHS[d];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      if ((glyph >> (14 - (row * 3 + col))) & 1) {
        rect(x + col * px, y + row * px, px, px);
      }
    }
  }
}

function renderTileGlyph(blk, x, y, light) {
  const t = RENDER_TILE;
  noStroke();
  switch (blk) {
    case BLK_TREE: {
      const c = renderDim([28, 72, 36], light);
      fill(c[0], c[1], c[2]);
      triangle(x + t / 2, y + 6, x + 8, y + t - 8, x + t - 8, y + t - 8);
      break;
    }
    case BLK_COAL:
    case BLK_IRON:
    case BLK_DIAMOND: {
      const base = BLOCK_COLOURS[blk];
      const c = renderDim([base[0] >> 1, base[1] >> 1, base[2] >> 1], light);
      fill(c[0], c[1], c[2]);
      rect(x + 16, y + 16, t - 32, t - 32);
      break;
    }
    case BLK_WATER: {
      const c = renderDim([88, 170, 208], light);
      fill(c[0], c[1], c[2]);
      rect(x + 8, y + 16, t - 16, 6);
      rect(x + 8, y + 34, t - 16, 6);
      break;
    }
    case BLK_TABLE: {
      const c = renderDim([96, 64, 32], light);
      fill(c[0], c[1], c[2]);
      rect(x + 8, y + 18, t - 16, 8);
      break;
    }
    case BLK_FURNACE: {
      const c = renderDim([220, 120, 40], light);
      fill(c[0], c[1], c[2]);
      rect(x + 18, y + 26, t - 36, t - 36);
      break;
    }
    case BLK_PLANT:
    case BLK_RIPE_PLANT: {
      const c = renderDim(blk === BLK_RIPE_PLANT ? [232, 226, 90] : [40, 110, 50], light);
      fill(c[0], c[1], c[2]);
      rect(x + t / 2 - 3, y + 14, 6, t - 26);
      break;
    }
    default:
      break;
  }
}

function renderBar(x, y, w, h, value, maxValue, rgb) {
  noStroke();
  fill(26, 26, 30);
  rect(x, y, w, h);
  const v = value < 0 ? 0 : (value > maxValue ? maxValue : value);
  if (v > 0) {
    fill(rgb[0], rgb[1], rgb[2]);
    rect(x, y, ((w * v) / maxValue) | 0, h);
  }
}

// The only entry point. 90_playtrain.js calls this from draw().
function renderGame(st) {
  const light = st.lightLevel[0];
  const pr = st.playerR[0];
  const pc = st.playerC[0];

  background(10, 10, 12);
  noStroke();

  // --- the 9x7 view ------------------------------------------------------
  for (let vr = 0; vr < RENDER_ROWS; vr++) {
    for (let vc = 0; vc < RENDER_COLS; vc++) {
      const r = pr + vr - 3;
      const c = pc + vc - 4;
      const blk = inBounds(r, c) ? mapGet(st, r, c) : BLK_OUT_OF_BOUNDS;
      const x = vc * RENDER_TILE;
      const y = vr * RENDER_TILE;
      const base = BLOCK_COLOURS[blk] || BLOCK_COLOURS[0];
      const col = renderDim(base, light);
      fill(col[0], col[1], col[2]);
      rect(x, y, RENDER_TILE, RENDER_TILE);
      renderTileGlyph(blk, x, y, light);

      if (!inBounds(r, c)) continue;

      // Mobs, drawn over the tile. Read from the bitmaps, which are the
      // same thing the observation reads.
      if (mbGet(st.zombieBits, r, c)) {
        const z = renderDim([104, 186, 96], light);
        fill(z[0], z[1], z[2]);
        rect(x + 12, y + 10, RENDER_TILE - 24, RENDER_TILE - 20);
        fill(10, 10, 10);
        rect(x + 18, y + 18, 6, 6);
        rect(x + RENDER_TILE - 24, y + 18, 6, 6);
      } else if (mbGet(st.cowBits, r, c)) {
        const z = renderDim([168, 122, 92], light);
        fill(z[0], z[1], z[2]);
        rect(x + 10, y + 16, RENDER_TILE - 20, RENDER_TILE - 28);
        fill(240, 240, 240);
        rect(x + 14, y + 20, 8, 6);
      } else if (mbGet(st.skelBits, r, c)) {
        const z = renderDim([210, 210, 200], light);
        fill(z[0], z[1], z[2]);
        rect(x + 14, y + 10, RENDER_TILE - 28, RENDER_TILE - 20);
        fill(20, 20, 20);
        rect(x + 20, y + 18, 5, 5);
      }
      if (mbGet(st.arrowBits, r, c)) {
        stroke(240, 240, 220);
        strokeWeight(3);
        const cx = x + RENDER_TILE / 2;
        const cy = y + RENDER_TILE / 2;
        let adr = 0, adc = 0;
        for (let i = 0; i < MAX_ARROWS; i++) {
          if (st.arrowMask[i] && st.arrowR[i] === r && st.arrowC[i] === c) {
            adr = st.arrowDr[i]; adc = st.arrowDc[i];
            break;
          }
        }
        line(cx - adc * 12, cy - adr * 12, cx + adc * 12, cy + adr * 12);
        noStroke();
      }
    }
  }

  // --- the player, always at the view centre ------------------------------
  {
    const x = 4 * RENDER_TILE;
    const y = 3 * RENDER_TILE;
    const asleep = st.isSleeping[0] !== 0;
    const body = renderDim(asleep ? [120, 110, 150] : [238, 226, 200], light);
    fill(body[0], body[1], body[2]);
    rect(x + 12, y + 12, RENDER_TILE - 24, RENDER_TILE - 24);
    // Facing mark on the edge the player is looking at.
    fill(30, 30, 40);
    const dir = st.playerDir[0];
    const mid = RENDER_TILE / 2;
    if (dir === 1) rect(x + 6, y + mid - 4, 8, 8);
    else if (dir === 2) rect(x + RENDER_TILE - 14, y + mid - 4, 8, 8);
    else if (dir === 3) rect(x + mid - 4, y + 6, 8, 8);
    else rect(x + mid - 4, y + RENDER_TILE - 14, 8, 8);
  }

  // --- inventory strip ----------------------------------------------------
  // 12 slots across 504px: a swatch per item with its count beside it.
  {
    noStroke();
    fill(18, 18, 22);
    rect(0, RENDER_HUD_Y, RENDER_TILE * RENDER_COLS, RENDER_TILE);
    const slotW = ((RENDER_TILE * RENDER_COLS) / NUM_INVENTORY) | 0;
    const swatches = [
      BLOCK_COLOURS[BLK_WOOD], BLOCK_COLOURS[BLK_STONE], BLOCK_COLOURS[BLK_COAL],
      BLOCK_COLOURS[BLK_IRON], BLOCK_COLOURS[BLK_DIAMOND], BLOCK_COLOURS[BLK_PLANT],
      [150, 120, 70], [150, 150, 155], [190, 205, 215],
      [170, 130, 80], [170, 170, 175], [205, 220, 230],
    ];
    for (let i = 0; i < NUM_INVENTORY; i++) {
      const x = i * slotW;
      const n = st.inv[i];
      const s = swatches[i];
      // Dim an empty slot rather than hiding it, so positions stay stable.
      const k = n > 0 ? 1.0 : 0.25;
      fill((s[0] * k) | 0, (s[1] * k) | 0, (s[2] * k) | 0);
      rect(x + 4, RENDER_HUD_Y + 10, 16, 16);
      if (n > 0) {
        fill(235, 235, 235);
        renderDigit(n > 9 ? 9 : n, x + 24, RENDER_HUD_Y + 10, 4);
      }
    }
  }

  // --- status bars --------------------------------------------------------
  {
    noStroke();
    fill(18, 18, 22);
    rect(0, RENDER_BAR_Y, RENDER_TILE * RENDER_COLS, RENDER_TILE);
    const w = 108;
    const gap = 16;
    renderBar(8, RENDER_BAR_Y + 12, w, 14, st.health[0], 9, [206, 70, 70]);
    renderBar(8 + (w + gap), RENDER_BAR_Y + 12, w, 14, st.food[0], 9, [196, 150, 60]);
    renderBar(8 + 2 * (w + gap), RENDER_BAR_Y + 12, w, 14, st.drink[0], 9, [70, 140, 210]);
    renderBar(8 + 3 * (w + gap), RENDER_BAR_Y + 12, w, 14, st.energy[0], 9, [150, 200, 90]);
    // A thin light-level strip, so time of day is legible at obs resolution
    // even where no tile is visible.
    fill((220 * light) | 0, (220 * light) | 0, (160 * light) | 0);
    rect(8, RENDER_BAR_Y + 34, ((RENDER_TILE * RENDER_COLS - 16) * light) | 0, 6);
  }
}
