var acc=0; function setup(){createCanvas(64,64);} function resetGame(s){acc=0;}
function getGameState(){return {score:acc|0,lives:0,gameState:'PLAYING'};}
function drawBars(n){var i=0; while(i<n){ rect(i,0,2,2); i=i+1; }}
function draw(){ fill(30,60,90); drawBars(500); acc=acc+1; }
