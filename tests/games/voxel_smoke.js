// Spike: prove the voxel primitive reaches every backend and agrees byte for
// byte. A 16x16 grid with a differently textured wall on each side of a room,
// the eye off-centre inside it, rendered into the top 49 rows of a 64x64
// canvas — the frame layout craftax_fp will use (FIRST_PERSON_PLAN.md §4.5).
//
// The atlas is procedural and asymmetric on purpose: a mirrored or transposed
// UV changes the picture instead of hiding in a tidy tile.
const GW = 16, GH = 16, TILE_PX = 16, N_TILES = 4;
const SKY = 0x87CEEB;
const VIEW = 9.0;
const VIEW_H = 49;

let grid = null;
let atlas = null;
let yaw = 0;
let tick = 0;

function makeAtlas() {
  const a = new Uint8Array(N_TILES * TILE_PX * TILE_PX * 4);
  for (let t = 0; t < N_TILES; t++) {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const o = (t * TILE_PX * TILE_PX + y * TILE_PX + x) * 4;
        a[o] = (t * 61 + x * 13 + y * 7) & 255;
        a[o + 1] = (t * 97 + x * 5 + y * 29) & 255;
        a[o + 2] = (t * 131 + x * 23 + y * 3) & 255;
        a[o + 3] = 255;
      }
    }
  }
  return a;
}

function makeGrid() {
  const g = new Uint16Array(GW * GH);
  for (let i = 0; i < g.length; i++) g[i] = 0 << 1;        // floor, tile 0
  for (let c = 5; c < 12; c++) {
    g[5 * GW + c] = (0 << 1) | 1;                          // north wall
    g[11 * GW + c] = (2 << 1) | 1;                         // south wall
  }
  for (let r = 5; r < 12; r++) {
    g[r * GW + 11] = (1 << 1) | 1;                         // east wall
    g[r * GW + 5] = (3 << 1) | 1;                          // west wall
  }
  return g;
}

function setup() {
  createCanvas(64, 64);
  grid = makeGrid();
  atlas = makeAtlas();
}

function draw() {
  background(0, 0, 0);
  // Turn one quarter every 8 frames, so a run of any length exercises all four
  // yaws and a camera that ignored yaw would not survive the differential gate.
  yaw = ((tick / 8) | 0) & 3;
  tick++;
  voxelView(grid, GW, GH, 8.5, 0.5, 9.5, yaw, VIEW,
    atlas, TILE_PX, N_TILES, SKY, 0, 0, 64, VIEW_H);
  // Billboards: one two cells ahead of the eye at yaw 0, one to the side, and
  // one beyond the north wall that the depth test must hide. Drawn every
  // frame so the differential gate covers the sprite pass as well.
  for (const [sx, sz, tile] of [[8.5, 7.5, 1], [10.5, 8.5, 2], [8.5, 3.5, 3]]) {
    voxelSprite(8.5, 0.5, 9.5, yaw, VIEW, sx, sz,
      atlas, TILE_PX, N_TILES, tile, 0, 0, 64, VIEW_H);
  }
}

function resetGame(_seed) { yaw = 0; tick = 0; }
function getGameState() { return { score: 0, lives: 1, gameState: 'PLAYING' }; }
