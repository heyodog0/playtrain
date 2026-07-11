// spike_threading.c — tail-call-threading spike (v2: correct calling convention).
//
// KEY LESSON from v1: threading only wins if the hot state (pc, sp, locals) is passed as
// ARGUMENTS so it stays in registers across the tail calls. Passing a VM* and touching
// memory each op is *slower* than a switch (whose sp/pc are register locals). This is the
// whole reason copy-and-patch / CPython's tail-call interp use a pinned-register convention.
//
// Same hot loop 3 ways, identical results, timed:
//   V1  switch interpreter, boxed values           (== QuickJS today)
//   V2  tail-call threaded (args in regs), boxed    (dispatch removed; AUTOMATIC baseline)
//   V3  tail-call threaded (args in regs), UNBOXED  (+ specialization; our JIT's lever)
//
// build: clang -O2 -fomit-frame-pointer jit/spike_threading.c -o /tmp/spk && /tmp/spk
#include <stdint.h>
#include <stdio.h>
#include <time.h>

static double now(void){ struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return t.tv_sec+t.tv_nsec*1e-9; }

enum { T_INT = 0 };
typedef struct { int32_t tag; int64_t v; } Val;

enum { OP_GET0, OP_GET1, OP_GET2, OP_LT, OP_JZ_END, OP_ADD, OP_PUT0,
       OP_PUT1, OP_PUSH1, OP_GOTO_TOP, OP_HALT };
static const uint8_t CODE[] = {
  /*top:*/ OP_GET1, OP_GET2, OP_LT, OP_JZ_END,
           OP_GET0, OP_GET1, OP_ADD, OP_PUT0,
           OP_GET1, OP_PUSH1, OP_ADD, OP_PUT1,
           OP_GOTO_TOP,
  /*end:*/ OP_HALT
};
#define TOP 0
#define END 13

// ================= V1: switch, boxed (sp/pc are register locals) =================
static int64_t run_switch(int64_t n){
  Val st[16]; int sp=0; Val loc[3]={{T_INT,0},{T_INT,0},{T_INT,n}};
  const uint8_t *pc = CODE;
  for(;;){
    switch(*pc++){
      case OP_GET0: st[sp++]=loc[0]; break;
      case OP_GET1: st[sp++]=loc[1]; break;
      case OP_GET2: st[sp++]=loc[2]; break;
      case OP_PUSH1: st[sp].tag=T_INT; st[sp].v=1; sp++; break;
      case OP_LT: { Val b=st[--sp],a=st[--sp]; st[sp].tag=T_INT;
                    st[sp].v=(a.tag==T_INT&&b.tag==T_INT)?(a.v<b.v):0; sp++; } break;
      case OP_JZ_END: { Val c=st[--sp]; if(c.v==0) pc=CODE+END; } break;
      case OP_ADD: { Val b=st[--sp],a=st[--sp]; Val r; r.tag=T_INT;
                     r.v=(a.tag==T_INT&&b.tag==T_INT)?a.v+b.v:0; st[sp++]=r; } break;
      case OP_PUT0: loc[0]=st[--sp]; break;
      case OP_PUT1: loc[1]=st[--sp]; break;
      case OP_GOTO_TOP: pc=CODE+TOP; break;
      case OP_HALT: return loc[0].v;
    }
  }
}

// ================= V2: threaded, boxed, ARGS in registers =================
// preserve_none (clang's ghccc-like) frees up callee-saved regs and passes args in a way
// that survives the tail-call chain. Falls back to a plain convention if unsupported.
#if defined(__clang__) && (__clang_major__ >= 17)
#define CC __attribute__((preserve_none))
#else
#define CC
#endif
typedef CC void (*H)(const uint8_t*, Val*, Val*);
static H T2[16];
#define D2(pc,sp,loc) __attribute__((musttail)) return T2[*(pc)]((pc)+1,(sp),(loc))
static CC void h_get0(const uint8_t*pc,Val*sp,Val*loc){ sp[0]=loc[0]; D2(pc,sp+1,loc); }
static CC void h_get1(const uint8_t*pc,Val*sp,Val*loc){ sp[0]=loc[1]; D2(pc,sp+1,loc); }
static CC void h_get2(const uint8_t*pc,Val*sp,Val*loc){ sp[0]=loc[2]; D2(pc,sp+1,loc); }
static CC void h_push1(const uint8_t*pc,Val*sp,Val*loc){ sp[0].tag=T_INT; sp[0].v=1; D2(pc,sp+1,loc); }
static CC void h_lt(const uint8_t*pc,Val*sp,Val*loc){ Val b=sp[-1],a=sp[-2];
   sp[-2].tag=T_INT; sp[-2].v=(a.tag==T_INT&&b.tag==T_INT)?(a.v<b.v):0; D2(pc,sp-1,loc); }
static CC void h_jz(const uint8_t*pc,Val*sp,Val*loc){ Val c=sp[-1];
   if(c.v==0){ const uint8_t*p=CODE+END; __attribute__((musttail)) return T2[*p](p+1,sp-1,loc); }
   D2(pc,sp-1,loc); }
static CC void h_add(const uint8_t*pc,Val*sp,Val*loc){ Val b=sp[-1],a=sp[-2];
   sp[-2].tag=T_INT; sp[-2].v=(a.tag==T_INT&&b.tag==T_INT)?a.v+b.v:0; D2(pc,sp-1,loc); }
static CC void h_put0(const uint8_t*pc,Val*sp,Val*loc){ loc[0]=sp[-1]; D2(pc,sp-1,loc); }
static CC void h_put1(const uint8_t*pc,Val*sp,Val*loc){ loc[1]=sp[-1]; D2(pc,sp-1,loc); }
static CC void h_goto(const uint8_t*pc,Val*sp,Val*loc){ const uint8_t*p=CODE+TOP;
   __attribute__((musttail)) return T2[*p](p+1,sp,loc); }
static CC void h_halt(const uint8_t*pc,Val*sp,Val*loc){ (void)pc;(void)sp;(void)loc; }  // loc[0]=result
static int64_t run_threaded(int64_t n){
  T2[OP_GET0]=h_get0;T2[OP_GET1]=h_get1;T2[OP_GET2]=h_get2;T2[OP_PUSH1]=h_push1;T2[OP_LT]=h_lt;
  T2[OP_JZ_END]=h_jz;T2[OP_ADD]=h_add;T2[OP_PUT0]=h_put0;T2[OP_PUT1]=h_put1;T2[OP_GOTO_TOP]=h_goto;T2[OP_HALT]=h_halt;
  Val st[16]; Val loc[3]={{T_INT,0},{T_INT,0},{T_INT,n}};
  T2[CODE[0]](CODE+1, st, loc); return loc[0].v;
}

// ================= V3: threaded, UNBOXED int, ARGS in registers =================
typedef CC void (*Hi)(const uint8_t*, int64_t*, int64_t*);
static Hi T3[16];
#define D3(pc,sp,loc) __attribute__((musttail)) return T3[*(pc)]((pc)+1,(sp),(loc))
static CC void j_get0(const uint8_t*pc,int64_t*sp,int64_t*loc){ sp[0]=loc[0]; D3(pc,sp+1,loc); }
static CC void j_get1(const uint8_t*pc,int64_t*sp,int64_t*loc){ sp[0]=loc[1]; D3(pc,sp+1,loc); }
static CC void j_get2(const uint8_t*pc,int64_t*sp,int64_t*loc){ sp[0]=loc[2]; D3(pc,sp+1,loc); }
static CC void j_push1(const uint8_t*pc,int64_t*sp,int64_t*loc){ sp[0]=1; D3(pc,sp+1,loc); }
static CC void j_lt(const uint8_t*pc,int64_t*sp,int64_t*loc){ sp[-2]=(sp[-2]<sp[-1]); D3(pc,sp-1,loc); }
static CC void j_jz(const uint8_t*pc,int64_t*sp,int64_t*loc){
   if(sp[-1]==0){ const uint8_t*p=CODE+END; __attribute__((musttail)) return T3[*p](p+1,sp-1,loc); }
   D3(pc,sp-1,loc); }
static CC void j_add(const uint8_t*pc,int64_t*sp,int64_t*loc){ sp[-2]=sp[-2]+sp[-1]; D3(pc,sp-1,loc); }
static CC void j_put0(const uint8_t*pc,int64_t*sp,int64_t*loc){ loc[0]=sp[-1]; D3(pc,sp-1,loc); }
static CC void j_put1(const uint8_t*pc,int64_t*sp,int64_t*loc){ loc[1]=sp[-1]; D3(pc,sp-1,loc); }
static CC void j_goto(const uint8_t*pc,int64_t*sp,int64_t*loc){ const uint8_t*p=CODE+TOP;
   __attribute__((musttail)) return T3[*p](p+1,sp,loc); }
static CC void j_halt(const uint8_t*pc,int64_t*sp,int64_t*loc){ (void)pc;(void)sp;(void)loc; }
static int64_t run_threaded_int(int64_t n){
  T3[OP_GET0]=j_get0;T3[OP_GET1]=j_get1;T3[OP_GET2]=j_get2;T3[OP_PUSH1]=j_push1;T3[OP_LT]=j_lt;
  T3[OP_JZ_END]=j_jz;T3[OP_ADD]=j_add;T3[OP_PUT0]=j_put0;T3[OP_PUT1]=j_put1;T3[OP_GOTO_TOP]=j_goto;T3[OP_HALT]=j_halt;
  int64_t st[16]; int64_t loc[3]={0,0,n};
  T3[CODE[0]](CODE+1, st, loc); return loc[0];
}

int main(void){
  int64_t N=200000000; int64_t r1,r2,r3; double t;
  t=now(); r1=run_switch(N);        double d1=now()-t;
  t=now(); r2=run_threaded(N);      double d2=now()-t;
  t=now(); r3=run_threaded_int(N);  double d3=now()-t;
  printf("N=%lld  results: switch=%lld threaded=%lld threaded_int=%lld  match=%s\n",
         (long long)N,(long long)r1,(long long)r2,(long long)r3,(r1==r2&&r2==r3)?"YES":"NO");
  printf("V1 switch (boxed)        : %.3fs   1.00x  (QuickJS today)\n", d1);
  printf("V2 threaded (boxed)      : %.3fs   %.2fx  (dispatch removed -- AUTOMATIC baseline)\n", d2, d1/d2);
  printf("V3 threaded (unboxed int): %.3fs   %.2fx  (+ specialization -- our JIT's lever)\n", d3, d1/d3);
  return (r1==r2&&r2==r3)?0:1;
}
