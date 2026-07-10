// qjs_logic.cpp — minimal QuickJS logic harness (NO rasterizer, no-op p5) used to
// verify that QuickJS-compiled-to-wasm computes bit-identical game LOGIC to
// QuickJS-native. Runs a game (which must expose an instrumented getGameState
// returning a position checksum in `score`) and prints score per frame.
// The rasterizer is separately proven bit-identical native<->wasm, so matching
// logic here => matching frames => browser == training.
//   qjs_logic <game.js> <seed> <nsteps>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <string>
#include "quickjs.h"
#include "../runtime/jsmath.h"  // frozen transcendentals (fm_pow/fm_atan2, psin/pcos)

static double argd(JSContext* c, JSValueConst v) { double d = 0; JS_ToFloat64(c, &d, v); return d; }
static JSValue noop(JSContext*, JSValueConst, int, JSValueConst*) { return JS_UNDEFINED; }

static bool keys[256];
static JSValue js_keyIsDown(JSContext* c, JSValueConst, int argc, JSValueConst* argv) {
  int k = argc ? (int)argd(c, argv[0]) : -1; return JS_NewBool(c, k >= 0 && k < 256 && keys[k]);
}
// Frozen Math bindings (route to js:: = vendored fdlibm + psin/pcos), so QuickJS's
// transcendentals are deterministic + identical native<->wasm.
static JSValue m_pow(JSContext* c, JSValueConst, int, JSValueConst* a) { return JS_NewFloat64(c, js::pow(argd(c, a[0]), argd(c, a[1]))); }
static JSValue m_atan2(JSContext* c, JSValueConst, int, JSValueConst* a) { return JS_NewFloat64(c, js::atan2(argd(c, a[0]), argd(c, a[1]))); }
static JSValue m_hypot(JSContext* c, JSValueConst, int, JSValueConst* a) { return JS_NewFloat64(c, js::hypot(argd(c, a[0]), argd(c, a[1]))); }
static JSValue m_sin(JSContext* c, JSValueConst, int, JSValueConst* a) { return JS_NewFloat64(c, js::sin(argd(c, a[0]))); }
static JSValue m_cos(JSContext* c, JSValueConst, int, JSValueConst* a) { return JS_NewFloat64(c, js::cos(argd(c, a[0]))); }
static JSValue js_createCanvas(JSContext* c, JSValueConst, int argc, JSValueConst* argv) {
  JSValue g = JS_GetGlobalObject(c);
  JS_SetPropertyStr(c, g, "width", JS_NewInt32(c, argc > 0 ? (int)argd(c, argv[0]) : 400));
  JS_SetPropertyStr(c, g, "height", JS_NewInt32(c, argc > 1 ? (int)argd(c, argv[1]) : 400));
  JS_FreeValue(c, g); return JS_UNDEFINED;
}

static const char* PRELUDE = R"JS(
globalThis.dist=(a,b,x,y)=>Math.sqrt((x-a)**2+(y-b)**2);
globalThis.constrain=(v,l,h)=>Math.min(Math.max(v,l),h);
globalThis.lerp=(a,b,t)=>a+(b-a)*t;
globalThis.map=(v,s1,e1,s2,e2)=>s2+(e2-s2)*((v-s1)/(e1-s1));
globalThis.__mb=function(s){let t=s>>>0;return function(){t+=0x6D2B79F5;let n=Math.imul(t^(t>>>15),t|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296}};
globalThis.millis=()=>frameCount*(1000/60);
Math.pow=__m_pow; Math.atan2=__m_atan2; Math.hypot=__m_hypot; Math.sin=__m_sin; Math.cos=__m_cos;
)JS";

static const char* P5FUNCS[] = {"background","fill","stroke","noStroke","noFill","strokeWeight",
  "rect","ellipse","circle","triangle","quad","line","rectMode","ellipseMode","push","pop",
  "translate","rotate","scale","beginShape","vertex","endShape","textSize","textAlign","text",
  "textFont","noSmooth","tint","color","noLoop","loop","frameRate","noCursor","cursor","smooth", nullptr};

int main(int argc, char** argv) {
  const char* gamePath = argc > 1 ? argv[1] : nullptr;
  uint32_t seed = argc > 2 ? (uint32_t)strtoul(argv[2], nullptr, 10) : 1u;
  long nsteps = argc > 3 ? atol(argv[3]) : 400;
  if (!gamePath) { fprintf(stderr, "usage: qjs_logic <game.js> <seed> <n>\n"); return 1; }
  FILE* f = fopen(gamePath, "rb"); if (!f) { fprintf(stderr, "open %s failed\n", gamePath); return 1; }
  fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
  std::string src(sz, 0); if (fread(&src[0], 1, sz, f) != (size_t)sz) return 1; fclose(f);

  JSRuntime* rt = JS_NewRuntime();
  JS_SetMaxStackSize(rt, 0);  // disable the C-stack guard: under wasm, stack_top-stack_size underflows and misfires (quickjs-ng disables it for wasi too)
  JSContext* ctx = JS_NewContext(rt);
  JSValue g = JS_GetGlobalObject(ctx);
  for (int i = 0; P5FUNCS[i]; i++) JS_SetPropertyStr(ctx, g, P5FUNCS[i], JS_NewCFunction(ctx, noop, P5FUNCS[i], 0));
  JS_SetPropertyStr(ctx, g, "createCanvas", JS_NewCFunction(ctx, js_createCanvas, "createCanvas", 2));
  JS_SetPropertyStr(ctx, g, "keyIsDown", JS_NewCFunction(ctx, js_keyIsDown, "keyIsDown", 1));
  JS_SetPropertyStr(ctx, g, "__m_pow", JS_NewCFunction(ctx, m_pow, "__m_pow", 2));
  JS_SetPropertyStr(ctx, g, "__m_atan2", JS_NewCFunction(ctx, m_atan2, "__m_atan2", 2));
  JS_SetPropertyStr(ctx, g, "__m_hypot", JS_NewCFunction(ctx, m_hypot, "__m_hypot", 2));
  JS_SetPropertyStr(ctx, g, "__m_sin", JS_NewCFunction(ctx, m_sin, "__m_sin", 1));
  JS_SetPropertyStr(ctx, g, "__m_cos", JS_NewCFunction(ctx, m_cos, "__m_cos", 1));
  const char* consts[][2] = {{"LEFT_ARROW","37"},{"UP_ARROW","38"},{"RIGHT_ARROW","39"},{"DOWN_ARROW","40"},
    {"ENTER","13"},{"CENTER","1"},{"CORNER","2"},{"LEFT","3"},{"CLOSE","1"}};
  for (auto& c : consts) JS_SetPropertyStr(ctx, g, c[0], JS_NewInt32(ctx, atoi(c[1])));
  JS_SetPropertyStr(ctx, g, "PI", JS_NewFloat64(ctx, 3.141592653589793));
  JS_SetPropertyStr(ctx, g, "TWO_PI", JS_NewFloat64(ctx, 6.283185307179586));
  JS_SetPropertyStr(ctx, g, "HALF_PI", JS_NewFloat64(ctx, 1.5707963267948966));
  int frameCount = 0;
  JS_SetPropertyStr(ctx, g, "frameCount", JS_NewInt32(ctx, 0));

  auto ev = [&](const char* code, const char* fn) { JSValue r = JS_Eval(ctx, code, strlen(code), fn, JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) { JSValue e = JS_GetException(ctx); const char* s = JS_ToCString(ctx, e); fprintf(stderr, "err: %s\n", s?s:"?"); JS_FreeCString(ctx, s); JS_FreeValue(ctx, e);} JS_FreeValue(ctx, r); };
  ev(PRELUDE, "<prelude>"); ev(src.c_str(), gamePath);
  JSValue jsSetup = JS_GetPropertyStr(ctx, g, "setup"), jsReset = JS_GetPropertyStr(ctx, g, "resetGame"),
          jsDraw = JS_GetPropertyStr(ctx, g, "draw"), jsState = JS_GetPropertyStr(ctx, g, "getGameState");
  auto setFrame = [&](int fc){ JS_SetPropertyStr(ctx, g, "frameCount", JS_NewInt32(ctx, fc)); };
  auto call0 = [&](JSValue fn){ JSValue r = JS_Call(ctx, fn, JS_UNDEFINED, 0, nullptr); JS_FreeValue(ctx, r); };
  auto reseed = [&](uint32_t s){ char b[64]; snprintf(b, sizeof b, "Math.random=__mb(%u)", s); ev(b, "<seed>"); };
  auto score = [&]() -> double { JSValue st = JS_Call(ctx, jsState, JS_UNDEFINED, 0, nullptr);
    JSValue sc = JS_GetPropertyStr(ctx, st, "score"); double v; JS_ToFloat64(ctx, &v, sc); JS_FreeValue(ctx, sc); JS_FreeValue(ctx, st); return v; };
  static const int HELD[8][2] = {{-1,-1},{37,-1},{39,-1},{38,-1},{40,-1},{-1,32},{37,32},{39,32}};

  call0(jsSetup); reseed(0); { JSValue a = JS_NewInt32(ctx, 0); JSValue r = JS_Call(ctx, jsReset, JS_UNDEFINED, 1, &a); JS_FreeValue(ctx,r); JS_FreeValue(ctx,a);} setFrame(++frameCount); call0(jsDraw);
  // reset(seed)
  for (int i=0;i<256;i++) keys[i]=false; frameCount = 0; setFrame(0);
  reseed(seed); { JSValue a = JS_NewInt32(ctx, (int)seed); JSValue r = JS_Call(ctx, jsReset, JS_UNDEFINED, 1, &a); JS_FreeValue(ctx,r); JS_FreeValue(ctx,a);} setFrame(++frameCount); call0(jsDraw);
  printf("reset score=%.0f\n", score());
  for (long i = 0; i < nsteps; i++) {
    int a = (int)((i * 3 + 1) % 8);
    for (int k=0;k<256;k++) keys[k]=false; for (int j=0;j<2;j++) if (HELD[a][j]>=0) keys[HELD[a][j]]=true;
    setFrame(++frameCount); call0(jsDraw);
    printf("%ld score=%.0f\n", i, score());
  }
  return 0;
}
