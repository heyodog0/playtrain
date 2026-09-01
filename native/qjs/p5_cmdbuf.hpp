// p5_cmdbuf.hpp — optional p5 command buffer for the QuickJS hosts (round-3
// lever 2). Off by default; PLAYTRAIN_QJS_CMDBUF=1 replaces the per-call draw
// bindings with JS wrappers that append (opcode, args) doubles into a shared
// Float64Array backed by C++ memory, so a whole frame's p5 calls cross the
// QuickJS->C++ boundary once (the host-side flush) instead of once per call.
//
// Contract (the differential gate is the arbiter):
//   - Replay executes the SAME p5:: overloads the direct bindings would have,
//     in the same order. Color variants mirror colorFromArgs exactly: a single
//     array argument becomes a verbatim Color (argc marker 5); 1-4 numeric
//     args go through the matching p5::color overload.
//   - Under nodraw (render-skip / QJS_NODRAW), replay skips exactly the ops
//     the bindings' NODRAW macro skips; sticky-state ops (noStroke, noFill,
//     strokeWeight, modes, transform stack, targets) still execute.
//   - text/tint/etc stay no-ops and never enter the buffer.
//   - The write index lives in buf[0] (starts at 1) so the C++ flush can both
//     read and reset it without a JS call. Wrappers flush early via the native
//     __p5flush binding if a frame ever nears capacity.
#ifndef PLAYTRAIN_P5_CMDBUF_HPP
#define PLAYTRAIN_P5_CMDBUF_HPP

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "quickjs.h"
#include "../runtime/p5.hpp"

namespace p5cb {

enum : int {
  BG = 1, FILL = 2, STROKE = 3, NOSTROKE = 4, NOFILL = 5, STROKEW = 6,
  RECT4 = 7, RECT5 = 8, ELLIPSE3 = 9, ELLIPSE4 = 10, CIRCLE = 11, ARC = 12,
  TRIANGLE = 13, QUAD = 14, LINE = 15, RECTMODE = 16, ELLIPSEMODE = 17,
  PUSH = 18, POP = 19, TRANSLATE = 20, ROTATE = 21, SCALE1 = 22, SCALE2 = 23,
  BEGINSHAPE = 24, VERTEX = 25, ENDSHAPE0 = 26, ENDSHAPE1 = 27,
  SETTARGET = 28, CLEARTARGET = 29, IMAGE = 30,
};

// 32768 doubles = 256KB per env; the JS-side early-flush limit below (32720)
// leaves room for the largest command (10 slots) with margin.
constexpr size_t CAP = 32768;

struct Buf { double* q; };

inline bool enabled() {
  const char* s = getenv("PLAYTRAIN_QJS_CMDBUF");
  return s && *s && *s != '0';
}

// The buffer memory is a JS-side ArrayBuffer (created in install below) so the
// same code works on vendored quickjs-ng 0.15.1 and current heads, whose
// JS_NewArrayBuffer signatures differ. Buf.q borrows the ArrayBuffer's data
// (stable while the context lives; the global keeps it from being collected),
// so destroy() frees only the handle.
inline void destroy(Buf* b) { delete b; }

// Replay + reset. `nodraw` mirrors the hosts' NODRAW macro per-op.
inline void flush(Buf* b, bool nodraw) {
  double* q = b->q;
  size_t n = (size_t)q[0];
  for (size_t i = 1; i < n;) {
    int op = (int)q[i];
    switch (op) {
      case BG: case FILL: case STROKE: {
        if (!nodraw) {
          int c = (int)q[i + 1];
          p5::Color col = c == 5 ? p5::Color{q[i + 2], q[i + 3], q[i + 4], q[i + 5]}
                        : c == 1 ? p5::color(q[i + 2])
                        : c == 2 ? p5::color(q[i + 2], q[i + 3])
                        : c == 3 ? p5::color(q[i + 2], q[i + 3], q[i + 4])
                                 : p5::color(q[i + 2], q[i + 3], q[i + 4], q[i + 5]);
          if (op == BG) p5::background(col);
          else if (op == FILL) p5::fill(col);
          else p5::stroke(col);
        }
        i += 6; break; }
      case NOSTROKE:   p5::noStroke(); i += 1; break;
      case NOFILL:     p5::noFill(); i += 1; break;
      case STROKEW:    p5::strokeWeight(q[i + 1]); i += 2; break;
      case RECT4:      if (!nodraw) p5::rect(q[i + 1], q[i + 2], q[i + 3], q[i + 4]); i += 5; break;
      case RECT5:      if (!nodraw) p5::rect(q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5]); i += 6; break;
      case ELLIPSE3:   if (!nodraw) p5::ellipse(q[i + 1], q[i + 2], q[i + 3]); i += 4; break;
      case ELLIPSE4:   if (!nodraw) p5::ellipse(q[i + 1], q[i + 2], q[i + 3], q[i + 4]); i += 5; break;
      case CIRCLE:     if (!nodraw) p5::circle(q[i + 1], q[i + 2], q[i + 3]); i += 4; break;
      case ARC:        if (!nodraw) p5::arc(q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5], q[i + 6]); i += 7; break;
      case TRIANGLE:   if (!nodraw) p5::triangle(q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5], q[i + 6]); i += 7; break;
      case QUAD:       if (!nodraw) p5::quad(q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5], q[i + 6], q[i + 7], q[i + 8]); i += 9; break;
      case LINE:       if (!nodraw) p5::line(q[i + 1], q[i + 2], q[i + 3], q[i + 4]); i += 5; break;
      case RECTMODE:   p5::rectMode((int)q[i + 1]); i += 2; break;
      case ELLIPSEMODE: p5::ellipseMode((int)q[i + 1]); i += 2; break;
      case PUSH:       p5::push(); i += 1; break;
      case POP:        p5::pop(); i += 1; break;
      case TRANSLATE:  p5::translate(q[i + 1], q[i + 2]); i += 3; break;
      case ROTATE:     p5::rotate(q[i + 1]); i += 2; break;
      case SCALE1:     p5::scale(q[i + 1]); i += 2; break;
      case SCALE2:     p5::scale(q[i + 1], q[i + 2]); i += 3; break;
      case BEGINSHAPE: if (!nodraw) p5::beginShape(); i += 1; break;
      case VERTEX:     if (!nodraw) p5::vertex(q[i + 1], q[i + 2]); i += 3; break;
      case ENDSHAPE0:  if (!nodraw) p5::endShape(); i += 1; break;
      case ENDSHAPE1:  if (!nodraw) p5::endShape((int)q[i + 1]); i += 2; break;
      case SETTARGET:  p5::setTarget((int)q[i + 1]); i += 2; break;
      case CLEARTARGET: p5::clearTarget(); i += 1; break;
      case IMAGE:      if (!nodraw) p5::image((int)q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5]); i += 6; break;
      default:         q[0] = 1; return;  // unreachable unless the buffer is corrupt
    }
  }
  q[0] = 1;
}

// JS wrappers. Installed AFTER the direct bindings + PRELUDE so they shadow
// the natives; createCanvas/createGraphics flush-then-delegate (they mutate
// the canvas registry); color/lerpColor/keyIsDown stay native (pure / input).
// argc detection is by trailing-undefined, which matches real call sites; the
// arbiter for equivalence is the differential gate over the full catalog.
static const char* WRAPPERS = R"JS(
(function(){
"use strict";
const q=new Float64Array(__p5ab),F=__p5flush,L=32720;
const _cc=createCanvas,_cg=createGraphics;
globalThis.createCanvas=(w,h)=>{F();return _cc(w,h)};
globalThis.createGraphics=(w,h)=>{F();return _cg(w,h)};
const col=(op,r,g,b,a)=>{let n=q[0];if(n>L){F();n=1}
 if(g===undefined&&Array.isArray(r)){q[n+1]=5;q[n+2]=r[0]===undefined?0:r[0];q[n+3]=r[1]===undefined?0:r[1];q[n+4]=r[2]===undefined?0:r[2];q[n+5]=r[3]===undefined?255:r[3]}
 else{q[n+1]=a!==undefined?4:b!==undefined?3:g!==undefined?2:1;q[n+2]=r;q[n+3]=g;q[n+4]=b;q[n+5]=a}
 q[n]=op;q[0]=n+6};
globalThis.background=(r,g,b,a)=>col(1,r,g,b,a);
globalThis.fill=(r,g,b,a)=>col(2,r,g,b,a);
globalThis.stroke=(r,g,b,a)=>col(3,r,g,b,a);
globalThis.noStroke=()=>{let n=q[0];if(n>L){F();n=1}q[n]=4;q[0]=n+1};
globalThis.noFill=()=>{let n=q[0];if(n>L){F();n=1}q[n]=5;q[0]=n+1};
globalThis.strokeWeight=w=>{let n=q[0];if(n>L){F();n=1}q[n]=6;q[n+1]=w;q[0]=n+2};
globalThis.rect=(x,y,w,h,r)=>{let n=q[0];if(n>L){F();n=1}
 if(r===undefined){q[n]=7;q[n+1]=x;q[n+2]=y;q[n+3]=w;q[n+4]=h;q[0]=n+5}
 else{q[n]=8;q[n+1]=x;q[n+2]=y;q[n+3]=w;q[n+4]=h;q[n+5]=r;q[0]=n+6}};
globalThis.ellipse=(x,y,w,h)=>{let n=q[0];if(n>L){F();n=1}
 if(h===undefined){q[n]=9;q[n+1]=x;q[n+2]=y;q[n+3]=w;q[0]=n+4}
 else{q[n]=10;q[n+1]=x;q[n+2]=y;q[n+3]=w;q[n+4]=h;q[0]=n+5}};
globalThis.circle=(x,y,d)=>{let n=q[0];if(n>L){F();n=1}q[n]=11;q[n+1]=x;q[n+2]=y;q[n+3]=d;q[0]=n+4};
globalThis.arc=(x,y,w,h,s,e)=>{let n=q[0];if(n>L){F();n=1}q[n]=12;q[n+1]=x;q[n+2]=y;q[n+3]=w;q[n+4]=h;q[n+5]=s;q[n+6]=e;q[0]=n+7};
globalThis.triangle=(a,b,c,d,e,f)=>{let n=q[0];if(n>L){F();n=1}q[n]=13;q[n+1]=a;q[n+2]=b;q[n+3]=c;q[n+4]=d;q[n+5]=e;q[n+6]=f;q[0]=n+7};
globalThis.quad=(a,b,c,d,e,f,g,h)=>{let n=q[0];if(n>L){F();n=1}q[n]=14;q[n+1]=a;q[n+2]=b;q[n+3]=c;q[n+4]=d;q[n+5]=e;q[n+6]=f;q[n+7]=g;q[n+8]=h;q[0]=n+9};
globalThis.line=(a,b,c,d)=>{let n=q[0];if(n>L){F();n=1}q[n]=15;q[n+1]=a;q[n+2]=b;q[n+3]=c;q[n+4]=d;q[0]=n+5};
globalThis.rectMode=m=>{let n=q[0];if(n>L){F();n=1}q[n]=16;q[n+1]=m;q[0]=n+2};
globalThis.ellipseMode=m=>{let n=q[0];if(n>L){F();n=1}q[n]=17;q[n+1]=m;q[0]=n+2};
globalThis.push=()=>{let n=q[0];if(n>L){F();n=1}q[n]=18;q[0]=n+1};
globalThis.pop=()=>{let n=q[0];if(n>L){F();n=1}q[n]=19;q[0]=n+1};
globalThis.translate=(x,y)=>{let n=q[0];if(n>L){F();n=1}q[n]=20;q[n+1]=x;q[n+2]=y;q[0]=n+3};
globalThis.rotate=a=>{let n=q[0];if(n>L){F();n=1}q[n]=21;q[n+1]=a;q[0]=n+2};
globalThis.scale=(x,y)=>{let n=q[0];if(n>L){F();n=1}
 if(y===undefined){q[n]=22;q[n+1]=x;q[0]=n+2}
 else{q[n]=23;q[n+1]=x;q[n+2]=y;q[0]=n+3}};
globalThis.beginShape=()=>{let n=q[0];if(n>L){F();n=1}q[n]=24;q[0]=n+1};
globalThis.vertex=(x,y)=>{let n=q[0];if(n>L){F();n=1}q[n]=25;q[n+1]=x;q[n+2]=y;q[0]=n+3};
globalThis.endShape=m=>{let n=q[0];if(n>L){F();n=1}
 if(m===undefined){q[n]=26;q[0]=n+1}
 else{q[n]=27;q[n+1]=m;q[0]=n+2}};
globalThis.setTarget=h=>{let n=q[0];if(n>L){F();n=1}q[n]=28;q[n+1]=h;q[0]=n+2};
globalThis.clearTarget=()=>{let n=q[0];if(n>L){F();n=1}q[n]=29;q[0]=n+1};
globalThis.image=(h,x,y,w,g)=>{let n=q[0];if(n>L){F();n=1}q[n]=30;q[n+1]=h;q[n+2]=x;q[n+3]=y;q[n+4]=w;q[n+5]=g;q[0]=n+6};
globalThis.text=()=>{};globalThis.textSize=()=>{};globalThis.textAlign=()=>{};
globalThis.textFont=()=>{};globalThis.noSmooth=()=>{};globalThis.tint=()=>{};
globalThis.noLoop=()=>{};globalThis.loop=()=>{};globalThis.noCursor=()=>{};
globalThis.cursor=()=>{};globalThis.frameRate=()=>{};globalThis.smooth=()=>{};
})();
)JS";

// Install the buffer + wrappers on a context. `flushFn` is the host's
// __p5flush binding (it owns the host's nodraw flag). The Buf* is stored in
// the context opaque (free slot in both hosts) and returned; caller owns it
// and must destroy() it after the context is freed.
inline Buf* install(JSContext* ctx, JSValue g, JSCFunction* flushFn) {
  Buf* b = new Buf;
  JS_SetContextOpaque(ctx, b);
  JS_SetPropertyStr(ctx, g, "__p5flush", JS_NewCFunction(ctx, flushFn, "__p5flush", 0));
  {
    char mk[80];
    snprintf(mk, sizeof mk, "globalThis.__p5ab=new ArrayBuffer(%zu)", CAP * sizeof(double));
    JSValue r0 = JS_Eval(ctx, mk, strlen(mk), "<p5cmdbuf-ab>", JS_EVAL_TYPE_GLOBAL);
    JS_FreeValue(ctx, r0);
    JSValue ab = JS_GetPropertyStr(ctx, g, "__p5ab");
    size_t sz = 0;
    b->q = (double*)JS_GetArrayBuffer(ctx, &sz, ab);
    JS_FreeValue(ctx, ab);
    if (!b->q || sz != CAP * sizeof(double)) {
      fprintf(stderr, "p5cmdbuf: ArrayBuffer alloc failed\n");
      delete b; JS_SetContextOpaque(ctx, nullptr); return nullptr;
    }
    b->q[0] = 1;
  }
  JSValue r = JS_Eval(ctx, WRAPPERS, strlen(WRAPPERS), "<p5cmdbuf>", JS_EVAL_TYPE_GLOBAL);
  if (JS_IsException(r)) {
    JSValue e = JS_GetException(ctx);
    const char* s = JS_ToCString(ctx, e);
    fprintf(stderr, "p5cmdbuf install failed: %s\n", s ? s : "?");
    JS_FreeCString(ctx, s); JS_FreeValue(ctx, e);
  }
  JS_FreeValue(ctx, r);
  return b;
}

}  // namespace p5cb

#endif  // PLAYTRAIN_P5_CMDBUF_HPP
