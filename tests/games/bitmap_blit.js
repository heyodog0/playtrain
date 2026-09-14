// Spike: prove a bitmap can get into the rasterizer and blit deterministically.
// A 4x4 RGBA checker, uploaded once, blitted at 3 scales.
let atlas = -1;
const TEX = 4;

function makeTexture() {
  const px = new Uint8Array(TEX * TEX * 4);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = (y * TEX + x) * 4;
      const on = ((x + y) & 1) === 0;
      px[i] = on ? 220 : 30;
      px[i + 1] = on ? 60 : 120;
      px[i + 2] = on ? 40 : 200;
      px[i + 3] = 255;
    }
  }
  return px;
}

function setup() {
  createCanvas(64, 64);
  atlas = createBitmap(TEX, TEX);
  const n = loadBitmap(atlas, makeTexture());
  if (n !== TEX * TEX * 4) print('loadBitmap copied ' + n);
}

function draw() {
  background(0, 0, 0);
  image(atlas, 0, 0, 16, 16);
  image(atlas, 20, 0, 28, 28);
  image(atlas, 0, 32, 7, 7);
}

function resetGame(_seed) {}
function getGameState() { return { score: 0, lives: 1, gameState: 'PLAYING' }; }
