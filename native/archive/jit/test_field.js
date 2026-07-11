// Milestone-3 property access: read object fields in a hot loop (shape-guarded inline
// cache). o.x/o.vx are float fields, o.hp an int field — exercises the f64 and int field
// loads + the shape guard. Must be byte-identical OFF==ON and should fire.
function hot(o, n) {
  var s = 0.0, i = 0, c = 0;
  while (i < n) {
    s = s + o.x * o.vx;   // float field reads (get_arg0; get_field) -> Q_FIELD_LOC (f64)
    c = c + o.hp;         // int field read -> Q_FIELD_LOC (int)
    i = i + 1;
  }
  return (s | 0) ^ c;
}
var obj = { x: 1.5, vx: 0.5, hp: 7 };
var acc = 0;
function setup() { createCanvas(64, 64); }
function resetGame(seed) { acc = 0; }
function getGameState() { return { score: acc | 0, lives: 0, gameState: 'PLAYING' }; }
function draw() { acc = hot(obj, 3000); }
