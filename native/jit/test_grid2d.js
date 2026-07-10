// increment 3: nested/global fast-array indexing. `grid` is a GLOBAL 2D array; the hot
// inner loop reads grid[x][y] (object element -> string element) and classifies it, using
// grid[x].length as the bound. Exercises IR_LOAD_GVAR + IR_ELEM_OBJ + Q_ARRAY_LENGTH + strict_eq.
var grid = [];
for (var x = 0; x < 12; x++) { grid[x] = []; for (var y = 0; y < 16; y++) grid[x][y] = ((x + y) % 3 === 0) ? 'G' : 'A'; }

var acc = 0;
function setup() { createCanvas(64, 64); }
function resetGame(s) { acc = 0; }
function getGameState() { return { score: acc | 0, lives: 0, gameState: 'PLAYING' }; }

function countG() {
  var c = 0;
  for (var x = 0; x < 12; x++) {
    for (var y = 0; y < 16; y++) {
      if (grid[x][y] === 'G') { c = c + 1; }
    }
  }
  return c;
}
function draw() { acc = countG(); }
