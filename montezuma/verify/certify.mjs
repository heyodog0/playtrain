import fs from 'fs'; import vm from 'vm';
const src=fs.readFileSync(process.argv[2],'utf8');
const K=4, NODE_CAP=+(process.env.CAP||60000);
// held arrows per action (SPACE delivered only on frame 0 of a macro-step)
const HELD=[[],[37],[39],[38],[40],[],[37],[39]];
const SPACE=[0,0,0,0,0,1,1,1];

function makeEnv(){
  let h=new Set();
  const s={Math,Infinity,NaN,JSON,Object,Array,createCanvas(){},background(){},fill(){},rect(){},ellipse(){},noStroke(){},stroke(){},width:400,height:400,
    keyIsDown:c=>h.has(c),keyPressed(){},_setHeld:a=>{h=new Set(a)}};
  vm.createContext(s); vm.runInContext(src,s);
  // inject snapshot / restore / heuristic / visited-key helpers (run in game context)
  vm.runInContext(`
    globalThis.__snap=function(){return {
      p:Object.assign({},player), hasKey, roomIndex, frame, score, lives, gameState, bestDist,
      visited:visited.slice(),
      rooms:world.rooms.map(rm=>({u:rm.unlocked, le:rm.lastEnter, k:rm.key?rm.key.taken:false,
        j:rm.jewels.map(x=>x.taken),
        hz:rm.hazards.map(h=>({x:h.x,vx:h.vx,dead:!!h.dead}))}))};};
    globalThis.__restore=function(s){
      player=Object.assign({},s.p); hasKey=s.hasKey; roomIndex=s.roomIndex; frame=s.frame;
      score=s.score; lives=s.lives; gameState=s.gameState; bestDist=s.bestDist; visited=s.visited.slice();
      world.rooms.forEach((rm,i)=>{const r=s.rooms[i]; rm.unlocked=r.u; rm.lastEnter=r.le; if(rm.key)rm.key.taken=r.k;
        rm.jewels.forEach((j,k)=>j.taken=r.j[k]);
        rm.hazards.forEach((h,k)=>{if(h.type==='skull'){h.x=r.hz[k].x; h.vx=r.hz[k].vx;} h.dead=r.hz[k].dead;});});
      room=world.rooms[roomIndex];};
    globalThis.__h=function(){const hasDoor=world.rooms.some(r=>r.door);
      const unlocked=!hasDoor||world.rooms.some(r=>r.door&&r.unlocked);
      const keyGot=world.rooms.some(r=>r.key&&r.key.taken);
      return (unlocked?0:1000)+(keyGot?0:1000)+(isFinite(distToSubgoal())?distToSubgoal():500);};
    globalThis.__key=function(){
      return roomIndex+'|'+(hasKey?1:0)+'|'+(room.unlocked?1:0)+'|'+Math.round(player.x/10)+'|'+Math.round(player.y/10)+'|'+
        Math.sign(player.vx)+'|'+Math.max(-1,Math.min(2,Math.round(player.vy/4)))+'|'+
        (player.supported?1:0)+'|'+(player.climbing?1:0)+'|'+(player.climbingRope?1:0)+'|'+(player.sinkT>0?Math.min(7,Math.round(player.sinkT/10)):0)+'|'+((room.hazards.some(h=>h.type==='laser')||(room.disappearing&&room.disappearing.length>0))?(frame%150):0);};
  `, s);
  return s;
}

// tiny binary heap on h, FIFO tie-break
class Heap{constructor(){this.a=[];this.seq=0;}
  push(h,v){this.a.push({h,s:this.seq++,v});this._up(this.a.length-1);}
  pop(){const a=this.a,top=a[0],last=a.pop();if(a.length){a[0]=last;this._down(0);}return top;}
  get size(){return this.a.length;}
  _lt(x,y){return x.h<y.h||(x.h===y.h&&x.s<y.s);}
  _up(i){const a=this.a;while(i){const p=(i-1)>>1;if(this._lt(a[i],a[p])){[a[i],a[p]]=[a[p],a[i]];i=p;}else break;}}
  _down(i){const a=this.a,n=a.length;for(;;){let l=2*i+1,r=l+1,m=i;if(l<n&&this._lt(a[l],a[m]))m=l;if(r<n&&this._lt(a[r],a[m]))m=r;if(m===i)break;[a[i],a[m]]=[a[m],a[i]];i=m;}}}

function macro(e,a){
  for(let f=0;f<K;f++){
    const keys=HELD[a].slice(); if(f===0&&SPACE[a]) keys.push(32);
    e._setHeld(keys); e.draw();
    if(e.getGameState().gameState!=='PLAYING') break;
  }
}

function solve(seed){
  const e=makeEnv(); e.setup(); e.resetGame(seed);
  const start=e.__snap();
  const open=new Heap(); const seen=new Set();
  open.push(e.__h(), start); seen.add(e.__key());
  let nodes=0;
  while(open.size && nodes<NODE_CAP){
    const cur=open.pop(); nodes++;
    for(let a=0;a<8;a++){
      e.__restore(cur.v); macro(e,a);
      const gs=e.getGameState().gameState;
      if(gs==='WIN') return {seed,res:'SOLVABLE',nodes};
      if(gs!=='PLAYING') continue;       // GAMEOVER -> dead
      const k=e.__key(); if(seen.has(k)) continue; seen.add(k);
      open.push(e.__h(), e.__snap());
    }
  }
  return {seed,res:(nodes>=NODE_CAP?'CAP':'EXHAUSTED'),nodes};
}

const seeds=process.argv.slice(3).map(Number);
const t0=Date.now();
for(const seed of seeds){ const r=solve(seed); console.log(`seed ${seed}: ${r.res} (nodes=${r.nodes})`); }
console.log(`elapsed ${((Date.now()-t0)/1000).toFixed(1)}s`);
