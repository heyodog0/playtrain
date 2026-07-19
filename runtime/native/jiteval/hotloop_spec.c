// Fully type-specialized version of hotloop.js (what a specializing JIT targets):
// unboxed int loop vars, tile types as int tags, direct 2D int array, native arith.
#include <stdio.h>
#include <stdint.h>
enum { EMPTY=0, GROUND=1, DIRT=2, CRATE=3, LAVA=4 };
int main(){
  const int W=64,H=20,TILE=16;
  static int8_t grid[64][20];
  uint32_t s=12345;
  #define RND() ((s=(s*1103515245u+12345u)&0x7fffffffu)/(double)0x7fffffff)
  int tags[4]={GROUND,DIRT,CRATE,LAVA};
  for(int x=0;x<W;x++)for(int y=0;y<H;y++){ grid[x][y]= RND()<0.4 ? tags[(int)(RND()*4)] : 0; }
  long long acc=0;
  const int FRAMES=20000;
  for(int f=0;f<FRAMES;f++){
    for(int x=0;x<W;x++){
      for(int y=0;y<H;y++){ int t=grid[x][y]; if(!t)continue;
        if(t==GROUND||t==DIRT){ acc += x*TILE + y*TILE + TILE + TILE; }
        else if(t==CRATE){ acc += x*TILE*2; }
        else if(t==LAVA){ acc += x*TILE + y*TILE+4; }
      }
    }
  }
  printf("acc=%lld\n", acc);
}
