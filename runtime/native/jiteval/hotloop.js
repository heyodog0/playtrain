const W=64, H=20, TILE=16;
const types=['GROUND','DIRT','CRATE','LAVA',0];
const grid=[]; let s=12345;
function rnd(){ s=(s*1103515245+12345)&0x7fffffff; return s/0x7fffffff; }
for(let x=0;x<W;x++){ grid[x]=[]; for(let y=0;y<H;y++){ grid[x][y]= rnd()<0.4 ? types[(rnd()*4)|0] : 0; } }
let acc=0;
const FRAMES=20000;
for(let f=0;f<FRAMES;f++){
  for(let x=0;x<W;x++){ if(!grid[x])continue;
    for(let y=0;y<H;y++){ let t=grid[x][y]; if(!t)continue;
      if(t==='GROUND'||t==='DIRT'){ acc += x*TILE + y*TILE + TILE + TILE; }
      else if(t==='CRATE'){ acc += x*TILE*2; }
      else if(t==='LAVA'){ acc += x*TILE + y*TILE+4; }
    }
  }
}
console.log('acc='+acc);
