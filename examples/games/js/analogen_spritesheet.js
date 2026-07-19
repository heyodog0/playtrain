// Sprite-sheet preview: renders the 36 spritepool item sprites in a 6x6 grid.
// Not a trainable game — a canvas to review the sprite art. Load via
// PlayTrainEnv(game="analogen_spritesheet", obs_size=360) and read the reset obs.
let gameState = 'PLAYING', score = 0, lives = 3;
function resetGame(seed) { gameState = 'PLAYING'; score = 0; lives = 3; }
function getGameState() { return { score, lives, gameState }; }

const BR = () => fill(120, 72, 30);
const BRD = () => fill(80, 48, 20);
const GR = () => fill(170, 175, 185);
const GRD = () => fill(90, 95, 105);
const WT = () => fill(255);
const DK = () => fill(28, 28, 32);

// 36 distinct, colourful base hues (gem/potion/etc. are real item colours).
const COLORS = [
 [210,60,60],[230,120,40],[230,200,50],[120,200,50],[50,190,90],[40,200,170],   // 40-45
 [40,180,230],[60,110,235],[120,90,235],[190,70,220],[235,80,180],[235,90,120], // 46-51
 [150,110,70],[150,155,170],[90,200,200],[210,170,70],[140,220,120],[90,150,235],// 52-57 (52 glove=leather)
 [235,90,150],[40,200,120],[240,180,60],[70,180,110],[245,150,40],[150,90,235],  // 58-63 (59 gem=emerald)
 [215,45,60],[45,120,240],[205,180,130],[160,70,235],[70,70,82],[220,50,50],     // 64-69
 [245,175,55],[250,225,70],[140,152,182],[150,215,60],[205,235,245],[225,175,60] // 70-75
];
function getItemColor(vid) { const c = COLORS[vid - 40] || [200,200,200]; return color(c[0], c[1], c[2]); }
function lite(vid) { const c = COLORS[vid-40]||[200,200,200]; return color(Math.min(255,c[0]+65),Math.min(255,c[1]+65),Math.min(255,c[2]+65)); }

function drawSprite(id, x, y) {
  const c = getItemColor(id);
  switch (id) {
    case 40: push(); translate(x,y); rotate(PI/4); GR(); rect(-2,-12,4,16); WT(); rect(-2,-12,1,16); BR(); rect(-6,4,12,3); rect(-1,7,2,4); pop(); break; // sword
    case 41: BR(); rect(x-1,y-12,3,24); GR(); triangle(x+1,y-11,x+12,y-6,x+1,y+2); triangle(x-1,y-11,x-12,y-6,x-1,y+2); WT(); triangle(x+1,y-11,x+4,y-10,x+1,y-5); break; // axe
    case 42: GR(); triangle(x-3,y+6,x+3,y+6,x,y-10); WT(); triangle(x-1,y+6,x,y+6,x,y-10); GRD(); rect(x-5,y+5,10,2); BR(); rect(x-1,y+7,2,6); break; // dagger
    case 43: BR(); rect(x-1,y-6,2,18); GR(); triangle(x-4,y-4,x+4,y-4,x,y-13); GRD(); rect(x-4,y-4,8,2); break; // spear
    case 44: BR(); rect(x-2,y-4,4,15); GR(); rect(x-8,y-11,16,7,1); GRD(); rect(x-8,y-11,3,7); WT(); rect(x+4,y-10,3,2); break; // hammer
    case 45: BR(); rect(x-11,y-1,20,2); GR(); triangle(x+7,y-5,x+7,y+5,x+13,y); fill(c); triangle(x-11,y-5,x-7,y-1,x-11,y+5); triangle(x-8,y-5,x-4,y-1,x-8,y+5); break; // arrow
    case 46: BR(); rect(x-1,y-4,2,15); fill(c); ellipse(x,y-8,11); fill(lite(id)); ellipse(x-2,y-10,4); break; // staff
    case 47: BRD(); rect(x-1,y-2,2,13); fill(c); quad(x,y-11,x+2,y-6,x+7,y-6,x+3,y-3); quad(x,y-11,x-2,y-6,x-7,y-6,x-3,y-3); quad(x-3,y-3,x-4,y+2,x,y-1); quad(x+3,y-3,x+4,y+2,x,y-1); WT(); ellipse(x,y-5,2); break; // wand
    case 48: fill(c); triangle(x-7,y+3,x+7,y+3,x,y-12); rect(x-11,y+3,22,4,2); DK(); rect(x-6,y+1,12,2); WT(); triangle(x-1,y-10,x+1,y-10,x,y-12); break; // hat
    case 49: fill(c); ellipse(x,y-2,20,17); rect(x-10,y-2,20,6,1); DK(); rect(x-8,y+1,16,3); WT(); ellipse(x-6,y-5,2); break; // helmet
    case 50: fill(c); rect(x-9,y+2,18,6,1); triangle(x-9,y+3,x-4,y+3,x-6,y-8); triangle(x-2,y+3,x+2,y+3,x,y-11); triangle(x+4,y+3,x+9,y+3,x+6,y-8); fill(255,60,60); ellipse(x,y-8,4); WT(); ellipse(x-6,y-7,2); ellipse(x+6,y-7,2); break; // crown
    case 51: fill(c); rect(x-9,y-5,6,10,1); rect(x-9,y+3,9,4,1); rect(x+2,y-5,6,10,1); rect(x+2,y+3,9,4,1); DK(); rect(x-9,y+6,9,2); rect(x+2,y+6,9,2); break; // boots
    case 52: fill(c); rect(x-5,y-4,11,9,2); ellipse(x-4,y-6,5); ellipse(x,y-7,5); ellipse(x+4,y-6,5); rect(x-8,y-2,4,6,2); DK(); rect(x-6,y+4,13,4,1); WT(); rect(x-4,y-5,1,7); rect(x,y-6,1,8); rect(x+4,y-5,1,7); break; // glove: palm + 3 fingers + thumb + cuff
    case 53: GRD(); rect(x-9,y-11,18,9,4); triangle(x-9,y-3,x+9,y-3,x,y+13); GR(); rect(x-7,y-9,14,7,3); triangle(x-7,y-3,x+7,y-3,x,y+10); DK(); rect(x-1,y-8,2,13); GRD(); ellipse(x,y-1,5); WT(); ellipse(x-1,y-2,2); break; // shield (steel gray)
    case 54: fill(c); rect(x-7,y-4,14,13,4); DK(); triangle(x-4,y-4,x+4,y-4,x,y+1); fill(c); rect(x-11,y-6,6,5,2); rect(x+5,y-6,6,5,2); WT(); rect(x-5,y+3,2,4); break; // breastplate
    case 55: fill(c); quad(x-6,y-9,x+6,y-9,x+9,y+10,x-9,y+10); DK(); triangle(x-9,y+10,x-3,y+10,x-6,y+6); triangle(x+3,y+10,x+9,y+10,x+6,y+6); fill(230,200,50); ellipse(x,y-8,4); break; // cape
    case 56: fill(c); ellipse(x,y+3,15); DK(); ellipse(x,y+3,9); fill(90,180,255); quad(x,y-10,x+4,y-6,x,y-2,x-4,y-6); WT(); ellipse(x-1,y-7,2); break; // ring
    case 57: fill(200,170,60); for (let i=0;i<7;i++){ rect(x-7+i-1, y-11+i*1.15, 2,2); rect(x+7-i-1, y-11+i*1.15, 2,2); } fill(c); quad(x,y-4,x+6,y+2,x,y+11,x-6,y+2); WT(); ellipse(x-2,y,2); break; // amulet: chain converging to pendant
    case 58: fill(c); ellipse(x,y+4,17); rect(x-3,y-8,6,10); BR(); rect(x-4,y-12,8,4); WT(); ellipse(x-4,y+2,4); break; // potion
    case 59: fill(c); triangle(x-9,y-4,x+9,y-4,x,y-12); rect(x-9,y-4,18,4); triangle(x-9,y,x+9,y,x,y+11); fill(lite(id)); triangle(x-9,y-4,x,y-4,x,y-12); DK(); triangle(x,y,x+9,y,x,y+11); WT(); rect(x-6,y-8,2,2); break; // gem (emerald)
    case 60: fill(c); quad(x-8,y-9,x+8,y-9,x+5,y-1,x-5,y-1); rect(x-1,y-1,2,8); rect(x-7,y+6,14,3,1); fill(210,60,80); ellipse(x,y-7,7); WT(); ellipse(x-3,y-8,2); break; // chalice (bowl+liquid+stem+base)
    case 61: fill(c); rect(x-9,y-10,18,20,2); WT(); rect(x+5,y-9,4,18); DK(); rect(x-9,y-10,4,20); fill(240,235,220); rect(x-3,y-6,7,1); rect(x-3,y-2,7,1); rect(x-3,y+2,7,1); break; // book
    case 62: BR(); rect(x-2,y+2,4,11); fill(255,140,0); triangle(x-6,y+3,x+6,y+3,x,y-13); fill(255,210,0); ellipse(x,y-2,8); WT(); ellipse(x,y-1,3); break; // torch
    case 63: fill(c); ellipse(x,y-6,11); DK(); ellipse(x,y-6,5); fill(c); rect(x-2,y-4,4,16); rect(x-2,y+8,7,3); rect(x-2,y+4,5,3); break; // key
    // ---- 12 new items (64-75) ----
    case 64: fill(c); ellipse(x,y+4,17); rect(x-3,y-8,6,10); BR(); rect(x-4,y-12,8,4); WT(); ellipse(x-4,y+2,4); break; // potion (red) — colour variation
    case 65: fill(c); ellipse(x,y-6,11); DK(); ellipse(x,y-6,5); fill(c); rect(x-2,y-4,4,16); rect(x-2,y+8,7,3); rect(x-2,y+4,5,3); break; // key (blue) — colour variation
    case 66: BRD(); ellipse(x-6,y,6,15); ellipse(x+6,y,6,15); fill(c); rect(x-6,y-6,12,12); fill(240,228,195); rect(x-4,y-4,8,8); DK(); rect(x-3,y-2,6,1); rect(x-3,y+1,6,1); break; // scroll
    case 67: fill(c); ellipse(x,y-2,17); fill(lite(id)); ellipse(x-3,y-5,7); WT(); ellipse(x-4,y-6,2); BRD(); rect(x-6,y+6,12,4,1); rect(x-3,y+5,6,3); break; // orb / crystal ball
    case 68: fill(c); ellipse(x,y+3,16); BRD(); rect(x+3,y-9,2,6); fill(255,170,40); ellipse(x+4,y-10,5); WT(); ellipse(x+4,y-10,2); ellipse(x-3,y,3); break; // bomb
    case 69: fill(c); ellipse(x,y-3,19,14); WT(); ellipse(x-5,y-5,3); ellipse(x+5,y-4,3); ellipse(x,y-1,2); fill(245,235,205); rect(x-4,y+2,8,9,2); break; // mushroom
    case 70: BRD(); rect(x-9,y-11,18,3,1); rect(x-2,y-14,4,3); fill(c); rect(x-8,y-8,16,15,2); DK(); rect(x-8,y-8,3,15); rect(x+5,y-8,3,15); rect(x-8,y-2,16,2); WT(); rect(x-3,y-6,3,6); break; // lantern (wider)
    case 71: fill(c); quad(x,y-12,x+3,y,x,y+12,x-3,y); quad(x-12,y,x,y-3,x+12,y,x,y+3); WT(); ellipse(x,y,4); break; // star / sparkle
    case 72: fill(c); rect(x-7,y-2,14,7,1); rect(x-7,y-9,3,8,1); rect(x-3,y-9,3,8,1); rect(x+1,y-9,3,8,1); rect(x+5,y-9,3,8,1); GRD(); rect(x-7,y-6,14,1); rect(x-7,y-3,14,1); fill(c); rect(x-10,y,3,5,1); DK(); rect(x-8,y+5,16,4,1); WT(); rect(x-6,y-8,1,5); break; // gauntlet: armored fist (4 fingers + plates + thumb + cuff)
    case 73: fill(c); triangle(x-8,y+9,x+8,y+9,x,y-3); rect(x-3,y-8,6,7); BR(); rect(x-4,y-11,8,3); WT(); ellipse(x-2,y+5,3); break; // flask (conical)
    case 74: fill(c); quad(x+1,y-13,x+5,y-4,x+2,y+6,x+1,y+8); quad(x-1,y-13,x-5,y-4,x-2,y+6,x-1,y+8); GRD(); rect(x-1,y-13,2,20); DK(); rect(x-4,y-5,3,1); rect(x+2,y-5,3,1); rect(x-4,y-1,3,1); rect(x+2,y-1,3,1); rect(x-3,y+3,2,1); rect(x+2,y+3,2,1); BRD(); rect(x-1,y+8,2,4); break; // feather: plume vanes + shaft + barbs + quill
    case 75: BRD(); rect(x-1,y-13,2,4); fill(c); ellipse(x,y-6,13,11); quad(x-6,y-6,x+6,y-6,x+9,y+6,x-9,y+6); rect(x-9,y+6,18,3,2); DK(); ellipse(x,y+9,5); WT(); ellipse(x-3,y-6,2); break; // bell (dome + flare + rim + clapper)
  }
}

function setup() { createCanvas(360, 360); noStroke(); }
function draw() {
  background(0);
  const N = 36, COLS = 6, ROWS = 6, cw = 360 / COLS, ch = 360 / ROWS;
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / COLS), col = i % COLS;
    const cx = col * cw + cw / 2, cy = r * ch + ch / 2;
    fill(24, 24, 28); rect(col * cw + 2, r * ch + 2, cw - 4, ch - 4, 4);
    push(); translate(cx, cy); scale(1.45); drawSprite(40 + i, 0, 0); pop();
  }
  noLoop();
}
