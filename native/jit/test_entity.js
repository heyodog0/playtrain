// Milestone-3b: entity iteration arr[i].field — the real-game pattern. Float + int fields
// on per-iteration array elements. Must be byte-identical OFF==ON and should fire.
function hot(arr, n) {
  var s = 0.0, i = 0, hp = 0;
  while (i < n) {
    s = s + arr[i].x * arr[i].vx + arr[i].y;   // float fields on the element
    hp = hp + arr[i].hp;                        // int field
    i = i + 1;
  }
  return (s | 0) ^ hp;
}
var ents = [];
for (var k = 0; k < 32; k++) ents[k] = { x: k * 0.5, y: k * 0.25, vx: 0.1, hp: (k % 5) + 1 };
var acc = 0;
function setup(){ createCanvas(64,64); }
function resetGame(seed){ acc = 0; }
function getGameState(){ return { score: acc|0, lives:0, gameState:'PLAYING' }; }
function draw(){ acc = hot(ents, 32); }
