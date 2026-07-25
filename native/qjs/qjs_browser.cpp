// qjs_browser.cpp — browser entry point. Same stack as the trainer (QuickJS +
// native rasterizer + frozen fdlibm), compiled to wasm via emscripten, exposing
// an exported API the page drives. Because it's the SAME engine + rasterizer +
// math as training, the frames a human sees are bit-identical to what agents see.
//
// Exported: qb_init(src) qb_reset(seed) qb_step(keymask) qb_pixels() qb_obs_dim()
#include <cstdint>
#include <cstring>
#include <string>
#include <emscripten.h>
#include "quickjs.h"
#include "../runtime/p5.hpp"

// Browser renders at the game's NATIVE logical resolution (crisp, full-detail for
// humans) — not the 64x64 agent obs. The game logic is identical either way
// (proven native==wasm), so the human plays a faithful high-res view of the same
// deterministic game the agent trains on at 64x64.
static JSRuntime* rt = nullptr;
static JSContext* ctx = nullptr;
static JSValue jsReset, jsDraw, jsState;
static int frameCount = 0;
static uint8_t obsbuf[1600 * 1600 * 3];  // large enough for any logical canvas
static bool keydown[256];

static double argd(JSContext* c, JSValueConst v) { double d = 0; JS_ToFloat64(c, &d, v); return d; }

// ---- p5 bindings -> native rasterizer (via runtime/p5.cpp) ----
static p5::Color colArgs(JSContext* c, int argc, JSValueConst* a) {
  if (argc == 1 && JS_IsArray(a[0])) { double v[4] = {0,0,0,255};
    for (int i=0;i<4;i++){JSValue e=JS_GetPropertyUint32(c,a[0],i); if(!JS_IsUndefined(e))JS_ToFloat64(c,&v[i],e); JS_FreeValue(c,e);} return {v[0],v[1],v[2],v[3]}; }
  if (argc==1) return p5::color(argd(c,a[0]));
  if (argc==2) return p5::color(argd(c,a[0]),argd(c,a[1]));
  if (argc==3) return p5::color(argd(c,a[0]),argd(c,a[1]),argd(c,a[2]));
  return p5::color(argd(c,a[0]),argd(c,a[1]),argd(c,a[2]),argd(c,a[3]));
}
#define FN(n) static JSValue n(JSContext* c, JSValueConst, int argc, JSValueConst* a)
FN(b_createCanvas){ p5::createCanvas(argd(c,a[0]),argd(c,a[1])); JSValue g=JS_GetGlobalObject(c);
  JS_SetPropertyStr(c,g,"width",JS_NewInt32(c,p5::width())); JS_SetPropertyStr(c,g,"height",JS_NewInt32(c,p5::height())); JS_FreeValue(c,g); return JS_UNDEFINED; }
FN(b_background){ p5::background(colArgs(c,argc,a)); return JS_UNDEFINED; }
FN(b_fill){ p5::fill(colArgs(c,argc,a)); return JS_UNDEFINED; }
FN(b_stroke){ p5::stroke(colArgs(c,argc,a)); return JS_UNDEFINED; }
FN(b_color){ p5::Color k=colArgs(c,argc,a); JSValue r=JS_NewArray(c);
  JS_SetPropertyUint32(c,r,0,JS_NewFloat64(c,k.r)); JS_SetPropertyUint32(c,r,1,JS_NewFloat64(c,k.g));
  JS_SetPropertyUint32(c,r,2,JS_NewFloat64(c,k.b)); JS_SetPropertyUint32(c,r,3,JS_NewFloat64(c,k.a)); return r; }
FN(b_lerpColor){ p5::Color k1=colArgs(c,1,&a[0]); p5::Color k2=colArgs(c,1,&a[1]);
  p5::Color k=p5::lerpColor(k1,k2,argd(c,a[2])); JSValue r=JS_NewArray(c);
  JS_SetPropertyUint32(c,r,0,JS_NewFloat64(c,k.r)); JS_SetPropertyUint32(c,r,1,JS_NewFloat64(c,k.g));
  JS_SetPropertyUint32(c,r,2,JS_NewFloat64(c,k.b)); JS_SetPropertyUint32(c,r,3,JS_NewFloat64(c,k.a)); return r; }
FN(b_noStroke){ p5::noStroke(); return JS_UNDEFINED; }
FN(b_noFill){ p5::noFill(); return JS_UNDEFINED; }
FN(b_strokeWeight){ p5::strokeWeight(argd(c,a[0])); return JS_UNDEFINED; }
FN(b_rect){ if(argc>=5)p5::rect(argd(c,a[0]),argd(c,a[1]),argd(c,a[2]),argd(c,a[3]),argd(c,a[4])); else p5::rect(argd(c,a[0]),argd(c,a[1]),argd(c,a[2]),argd(c,a[3])); return JS_UNDEFINED; }
FN(b_ellipse){ if(argc>=4)p5::ellipse(argd(c,a[0]),argd(c,a[1]),argd(c,a[2]),argd(c,a[3])); else p5::ellipse(argd(c,a[0]),argd(c,a[1]),argd(c,a[2])); return JS_UNDEFINED; }
FN(b_circle){ p5::circle(argd(c,a[0]),argd(c,a[1]),argd(c,a[2])); return JS_UNDEFINED; }
FN(b_triangle){ p5::triangle(argd(c,a[0]),argd(c,a[1]),argd(c,a[2]),argd(c,a[3]),argd(c,a[4]),argd(c,a[5])); return JS_UNDEFINED; }
FN(b_quad){ p5::quad(argd(c,a[0]),argd(c,a[1]),argd(c,a[2]),argd(c,a[3]),argd(c,a[4]),argd(c,a[5]),argd(c,a[6]),argd(c,a[7])); return JS_UNDEFINED; }
FN(b_line){ p5::line(argd(c,a[0]),argd(c,a[1]),argd(c,a[2]),argd(c,a[3])); return JS_UNDEFINED; }
FN(b_rectMode){ p5::rectMode((int)argd(c,a[0])); return JS_UNDEFINED; }
FN(b_ellipseMode){ p5::ellipseMode((int)argd(c,a[0])); return JS_UNDEFINED; }
FN(b_push){ p5::push(); return JS_UNDEFINED; }
FN(b_pop){ p5::pop(); return JS_UNDEFINED; }
FN(b_translate){ p5::translate(argd(c,a[0]),argd(c,a[1])); return JS_UNDEFINED; }
FN(b_rotate){ p5::rotate(argd(c,a[0])); return JS_UNDEFINED; }
FN(b_scale){ if(argc>=2)p5::scale(argd(c,a[0]),argd(c,a[1])); else p5::scale(argd(c,a[0])); return JS_UNDEFINED; }
FN(b_beginShape){ p5::beginShape(); return JS_UNDEFINED; }
FN(b_vertex){ p5::vertex(argd(c,a[0]),argd(c,a[1])); return JS_UNDEFINED; }
FN(b_endShape){ if(argc>=1)p5::endShape((int)argd(c,a[0])); else p5::endShape(); return JS_UNDEFINED; }
FN(b_keyIsDown){ int k=argc?(int)argd(c,a[0]):-1; return JS_NewBool(c, k>=0&&k<256&&keydown[k]); }
FN(b_noop){ return JS_UNDEFINED; }
FN(m_pow){ return JS_NewFloat64(c, js::pow(argd(c,a[0]),argd(c,a[1]))); }
FN(m_atan2){ return JS_NewFloat64(c, js::atan2(argd(c,a[0]),argd(c,a[1]))); }
FN(m_hypot){ return JS_NewFloat64(c, js::hypot(argd(c,a[0]),argd(c,a[1]))); }
FN(m_sin){ return JS_NewFloat64(c, js::sin(argd(c,a[0]))); }
FN(m_cos){ return JS_NewFloat64(c, js::cos(argd(c,a[0]))); }

static const char* PRELUDE = R"JS(
globalThis.dist=(a,b,x,y)=>Math.sqrt((x-a)**2+(y-b)**2);
globalThis.constrain=(v,l,h)=>Math.min(Math.max(v,l),h);
globalThis.lerp=(a,b,t)=>a+(b-a)*t;
globalThis.map=(v,s1,e1,s2,e2)=>s2+(e2-s2)*((v-s1)/(e1-s1));
globalThis.__mb=function(s){let t=s>>>0;return function(){t+=0x6D2B79F5;let n=Math.imul(t^(t>>>15),t|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296}};
globalThis.millis=()=>frameCount*(1000/60);
Math.pow=__m_pow; Math.atan2=__m_atan2; Math.hypot=__m_hypot; Math.sin=__m_sin; Math.cos=__m_cos;
)JS";

static void setFrame(int f){ frameCount=f; JSValue g=JS_GetGlobalObject(ctx); JS_SetPropertyStr(ctx,g,"frameCount",JS_NewInt32(ctx,f)); JS_FreeValue(ctx,g); }
static void call0(JSValue fn){ JSValue r=JS_Call(ctx,fn,JS_UNDEFINED,0,nullptr); JS_FreeValue(ctx,r); }

extern "C" {

EMSCRIPTEN_KEEPALIVE int qb_width() { return p5::width(); }
EMSCRIPTEN_KEEPALIVE int qb_height() { return p5::height(); }
EMSCRIPTEN_KEEPALIVE uint8_t* qb_pixels() { return obsbuf; }

EMSCRIPTEN_KEEPALIVE int qb_init(const char* src) {
  rt = JS_NewRuntime();
  JS_SetMaxStackSize(rt, 0);
  ctx = JS_NewContext(rt);
  JSValue g = JS_GetGlobalObject(ctx);
  struct B { const char* n; JSCFunction* f; int a; };
  const B bs[] = {
    {"createCanvas",b_createCanvas,2},{"background",b_background,1},{"fill",b_fill,4},{"stroke",b_stroke,4},
    {"color",b_color,4},{"lerpColor",b_lerpColor,3},{"noStroke",b_noStroke,0},{"noFill",b_noFill,0},{"strokeWeight",b_strokeWeight,1},
    {"rect",b_rect,5},{"ellipse",b_ellipse,4},{"circle",b_circle,3},{"triangle",b_triangle,6},{"quad",b_quad,8},
    {"line",b_line,4},{"rectMode",b_rectMode,1},{"ellipseMode",b_ellipseMode,1},{"push",b_push,0},{"pop",b_pop,0},
    {"translate",b_translate,2},{"rotate",b_rotate,1},{"scale",b_scale,2},{"beginShape",b_beginShape,0},
    {"vertex",b_vertex,2},{"endShape",b_endShape,1},{"keyIsDown",b_keyIsDown,1},
    {"textSize",b_noop,1},{"textAlign",b_noop,2},{"text",b_noop,3},{"textFont",b_noop,1},{"noSmooth",b_noop,0},
    {"tint",b_noop,4},{"noLoop",b_noop,0},{"loop",b_noop,0},{"frameRate",b_noop,1},{"noCursor",b_noop,0},{"cursor",b_noop,0},{"smooth",b_noop,0},
    {"__m_pow",m_pow,2},{"__m_atan2",m_atan2,2},{"__m_hypot",m_hypot,2},{"__m_sin",m_sin,1},{"__m_cos",m_cos,1},
  };
  for (auto& b : bs) JS_SetPropertyStr(ctx, g, b.n, JS_NewCFunction(ctx, b.f, b.n, b.a));
  const char* kv[][2] = {{"LEFT_ARROW","37"},{"UP_ARROW","38"},{"RIGHT_ARROW","39"},{"DOWN_ARROW","40"},
    {"ENTER","13"},{"CENTER","1"},{"CORNER","2"},{"LEFT","3"},{"CLOSE","1"}};
  for (auto& c : kv) JS_SetPropertyStr(ctx, g, c[0], JS_NewInt32(ctx, atoi(c[1])));
  JS_SetPropertyStr(ctx, g, "PI", JS_NewFloat64(ctx, p5::PI));
  JS_SetPropertyStr(ctx, g, "TWO_PI", JS_NewFloat64(ctx, p5::TWO_PI));
  JS_SetPropertyStr(ctx, g, "HALF_PI", JS_NewFloat64(ctx, p5::HALF_PI));
  JS_SetPropertyStr(ctx, g, "frameCount", JS_NewInt32(ctx, 0));
  JS_FreeValue(ctx, g);

  auto ev = [&](const char* code, const char* fn) { JSValue r = JS_Eval(ctx, code, strlen(code), fn, JS_EVAL_TYPE_GLOBAL);
    int bad = JS_IsException(r); JS_FreeValue(ctx, r); return bad ? -1 : 0; };
  // no setRasterRes -> render at the game's logical (native) resolution
  if (ev(PRELUDE, "<prelude>")) return -1;
  if (ev(src, "<game>")) return -2;
  JSValue gg = JS_GetGlobalObject(ctx);
  JSValue jsSetup = JS_GetPropertyStr(ctx, gg, "setup");
  jsReset = JS_GetPropertyStr(ctx, gg, "resetGame");
  jsDraw = JS_GetPropertyStr(ctx, gg, "draw");
  jsState = JS_GetPropertyStr(ctx, gg, "getGameState");
  JS_FreeValue(ctx, gg);
  call0(jsSetup); JS_FreeValue(ctx, jsSetup);
  return 0;
}

EMSCRIPTEN_KEEPALIVE void qb_reset(unsigned seed) {
  for (int i = 0; i < 256; i++) keydown[i] = false;
  frameCount = 0; setFrame(0);
  char b[64]; snprintf(b, sizeof b, "Math.random=__mb(%u)", seed);
  JSValue r0 = JS_Eval(ctx, b, strlen(b), "<seed>", JS_EVAL_TYPE_GLOBAL); JS_FreeValue(ctx, r0);
  JSValue s = JS_NewInt32(ctx, (int)seed); JSValue r = JS_Call(ctx, jsReset, JS_UNDEFINED, 1, &s);
  JS_FreeValue(ctx, r); JS_FreeValue(ctx, s);
  setFrame(++frameCount); call0(jsDraw);
  p5::render_obs_rgb(obsbuf);
}

// keymask bits: 1=LEFT(37) 2=RIGHT(39) 4=UP(38) 8=DOWN(40) 16=SPACE(32)
EMSCRIPTEN_KEEPALIVE void qb_step(int keymask) {
  for (int i = 0; i < 256; i++) keydown[i] = false;
  if (keymask & 1) keydown[37] = true; if (keymask & 2) keydown[39] = true;
  if (keymask & 4) keydown[38] = true; if (keymask & 8) keydown[40] = true;
  if (keymask & 16) keydown[32] = true;
  setFrame(++frameCount); call0(jsDraw);
  p5::render_obs_rgb(obsbuf);
}

}  // extern "C"
