// qjs_vec_host.cpp — the envpool-class vectorized backend for PlayTrain.
//
// One process, N QuickJS+rasterizer envs, a fixed thread pool. Each env owns its
// own JSContext + rasterizer state + p5 shim state (all made per-env selectable in
// crates/rasterizer/src/lib.rs and native/runtime/p5.cpp) and is PINNED to one
// worker thread, so no two threads ever touch the same interpreter or rasterizer
// state. A batched `vec_step(actions) -> (obs, rew, term, trunc)` steps every env
// in parallel across the pool; the Python side (src/playtrain/runtime/native_vec_env.py)
// calls it through ctypes, which releases the GIL for the whole batch. No
// subprocess, no pipe, no Python in the hot loop — the same architecture envpool
// uses to get near-linear scaling.
//
// Per-env step semantics are byte-identical to qjs_host.cpp `serve` mode (which
// QuickJSEnv drives), so obs are bit-exact vs the single-env backend (verified).
//
// Built as a shared library (libqjs_vec.dylib / .so) by native/build_qjs_vec.sh.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <vector>
#include <string>
#include <memory>
#include <thread>
#include <atomic>
#include <mutex>
#include <condition_variable>
#include <chrono>
#include <deque>
#if defined(__APPLE__)
#include <sys/sysctl.h>
#endif
#if defined(__linux__)
#include <sched.h>
#endif
#include "quickjs.h"
#include "action_table.hpp"
#include "p5_cmdbuf.hpp"
#include "../runtime/p5.hpp"
#include "../runtime/raster_abi.h"

// ============================ p5 bindings (copied verbatim from qjs_host.cpp) ===
// These route to the p5:: namespace, which reads/writes the per-thread SELECTED
// state — so as long as a worker selects an env's states before JS_Call(draw), the
// bindings hit that env's rasterizer + shim state. Kept in sync with qjs_host.cpp.

static inline double argd(JSContext* ctx, JSValueConst v) { double d = 0; JS_ToFloat64(ctx, &d, v); return d; }

static p5::Color colorFromArgs(JSContext* ctx, int argc, JSValueConst* argv) {
  if (argc == 1 && JS_IsArray(argv[0])) {
    double c[4] = {0, 0, 0, 255};
    for (int i = 0; i < 4; i++) { JSValue e = JS_GetPropertyUint32(ctx, argv[0], i); if (!JS_IsUndefined(e)) JS_ToFloat64(ctx, &c[i], e); JS_FreeValue(ctx, e); }
    return p5::Color{c[0], c[1], c[2], c[3]};
  }
  if (argc == 1) return p5::color(argd(ctx, argv[0]));
  if (argc == 2) return p5::color(argd(ctx, argv[0]), argd(ctx, argv[1]));
  if (argc == 3) return p5::color(argd(ctx, argv[0]), argd(ctx, argv[1]), argd(ctx, argv[2]));
  return p5::color(argd(ctx, argv[0]), argd(ctx, argv[1]), argd(ctx, argv[2]), argd(ctx, argv[3]));
}

// thread_local: render-skip (below) toggles this per frame from worker
// threads; envs are stepped by exactly one thread at a time, so a
// thread-local flag is race-free in both sync (pinned) and async modes.
static thread_local bool g_nodraw = false;
// Draw-call instrumentation. OFF by default and gated on a plain bool, so a
// normal run pays one predictable branch per p5 draw binding and nothing else;
// the counter itself is only touched while counting. Counting a game's calls
// makes the env-cost model testable rather than merely descriptive -- without
// it, an operation count for a real game can only be read backwards out of the
// timing it is supposed to predict.
static bool g_count_draws = false;
static std::atomic<unsigned long long> g_draw_calls{0};

// PER-BINDING counts. A single total is not enough to price a game's drawing:
// the bindings do not cost the same (a quad() carries eight coordinates and an
// arbitrary polygon; a rect() four and an axis-aligned box), so charging every
// command one average rate mis-attributes the difference to "game logic".
// Registration is via a function-local static in the NODRAW macro, so each
// binding claims a slot the first time it runs and no call site changes.
#define DC_MAX 32
static std::atomic<unsigned long long> g_dc[DC_MAX];
static const char* g_dc_name[DC_MAX];
static std::atomic<int> g_dc_n{0};
static int dc_register(const char* name) {
  int i = g_dc_n.fetch_add(1, std::memory_order_relaxed);
  if (i >= DC_MAX) return DC_MAX - 1;
  g_dc_name[i] = name;
  return i;
}
#define FN(name) static JSValue name(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
#define NODRAW static const int _dc_idx = dc_register(__func__); if (g_count_draws) { g_draw_calls.fetch_add(1, std::memory_order_relaxed); g_dc[_dc_idx].fetch_add(1, std::memory_order_relaxed); } if (g_nodraw) return JS_UNDEFINED;

// Command-buffer recording (PLAYTRAIN_QJS_CMDBUF=1): the context carries a
// p5cb::Buf; draw bindings append resolved args and return, and the host
// replays the frame in one flush. Without a buffer the direct path runs.
static inline p5cb::Buf* cbuf(JSContext* ctx) { return (p5cb::Buf*)JS_GetContextOpaque(ctx); }
#define REC(b) if ((b)->n > p5cb::CAP - 16) p5cb::flush((b), g_nodraw);

FN(js_createCanvas) {
  if (p5cb::Buf* b = cbuf(ctx)) p5cb::flush(b, g_nodraw);  // canvas registry changes: drain first
  if (argc >= 3) p5::createCanvas(argd(ctx, argv[0]), argd(ctx, argv[1]), (int)argd(ctx, argv[2]));  // WEBGL
  else p5::createCanvas(argd(ctx, argv[0]), argd(ctx, argv[1]));
  JSValue g = JS_GetGlobalObject(ctx);
  JS_SetPropertyStr(ctx, g, "width", JS_NewInt32(ctx, p5::width()));
  JS_SetPropertyStr(ctx, g, "height", JS_NewInt32(ctx, p5::height()));
  JS_FreeValue(ctx, g);
  return JS_UNDEFINED;
}
FN(js_background) { NODRAW p5::Color c = colorFromArgs(ctx, argc, argv);
  if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::recColor(b, p5cb::BG, c); } else p5::background(c);
  return JS_UNDEFINED; }
FN(js_fill)   { NODRAW p5::Color c = colorFromArgs(ctx, argc, argv);
  if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::recColor(b, p5cb::FILL, c); } else p5::fill(c);
  return JS_UNDEFINED; }
FN(js_stroke) { NODRAW p5::Color c = colorFromArgs(ctx, argc, argv);
  if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::recColor(b, p5cb::STROKE, c); } else p5::stroke(c);
  return JS_UNDEFINED; }
FN(js_color)  { p5::Color c = colorFromArgs(ctx, argc, argv);
  JSValue a = JS_NewArray(ctx);
  JS_SetPropertyUint32(ctx, a, 0, JS_NewFloat64(ctx, c.r)); JS_SetPropertyUint32(ctx, a, 1, JS_NewFloat64(ctx, c.g));
  JS_SetPropertyUint32(ctx, a, 2, JS_NewFloat64(ctx, c.b)); JS_SetPropertyUint32(ctx, a, 3, JS_NewFloat64(ctx, c.a));
  return a; }
FN(js_lerpColor) {
  p5::Color c1 = colorFromArgs(ctx, 1, &argv[0]);
  p5::Color c2 = colorFromArgs(ctx, 1, &argv[1]);
  p5::Color c = p5::lerpColor(c1, c2, argd(ctx, argv[2]));
  JSValue a = JS_NewArray(ctx);
  JS_SetPropertyUint32(ctx, a, 0, JS_NewFloat64(ctx, c.r)); JS_SetPropertyUint32(ctx, a, 1, JS_NewFloat64(ctx, c.g));
  JS_SetPropertyUint32(ctx, a, 2, JS_NewFloat64(ctx, c.b)); JS_SetPropertyUint32(ctx, a, 3, JS_NewFloat64(ctx, c.a));
  return a; }
FN(js_noStroke) { if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec0(b, p5cb::NOSTROKE); } else p5::noStroke(); return JS_UNDEFINED; }
FN(js_noFill) { if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec0(b, p5cb::NOFILL); } else p5::noFill(); return JS_UNDEFINED; }
FN(js_strokeWeight) { if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec1(b, p5cb::STROKEW, argd(ctx, argv[0])); } else p5::strokeWeight(argd(ctx, argv[0])); return JS_UNDEFINED; }
FN(js_rect) { NODRAW p5cb::Buf* b = cbuf(ctx);
  double x=argd(ctx,argv[0]), y=argd(ctx,argv[1]), w=argd(ctx,argv[2]), h=argd(ctx,argv[3]);
  if (argc >= 5) { double r=argd(ctx,argv[4]);
    if (b) { REC(b) p5cb::rec5(b, p5cb::RECT5, x, y, w, h, r); } else p5::rect(x, y, w, h, r); }
  else { if (b) { REC(b) p5cb::rec4(b, p5cb::RECT4, x, y, w, h); } else p5::rect(x, y, w, h); }
  return JS_UNDEFINED; }
FN(js_ellipse) { NODRAW p5cb::Buf* b = cbuf(ctx);
  double x=argd(ctx,argv[0]), y=argd(ctx,argv[1]), w=argd(ctx,argv[2]);
  if (argc >= 4) { double h=argd(ctx,argv[3]);
    if (b) { REC(b) p5cb::rec4(b, p5cb::ELLIPSE4, x, y, w, h); } else p5::ellipse(x, y, w, h); }
  else { if (b) { REC(b) p5cb::rec3(b, p5cb::ELLIPSE3, x, y, w); } else p5::ellipse(x, y, w); }
  return JS_UNDEFINED; }
FN(js_circle) { NODRAW if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec3(b, p5cb::CIRCLE, argd(ctx,argv[0]), argd(ctx,argv[1]), argd(ctx,argv[2])); }
  else p5::circle(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2])); return JS_UNDEFINED; }
FN(js_arc) { NODRAW if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec6(b, p5cb::ARC, argd(ctx,argv[0]), argd(ctx,argv[1]), argd(ctx,argv[2]), argd(ctx,argv[3]), argd(ctx,argv[4]), argd(ctx,argv[5])); }
  else p5::arc(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2]),argd(ctx,argv[3]),argd(ctx,argv[4]),argd(ctx,argv[5])); return JS_UNDEFINED; }
FN(js_triangle) { NODRAW if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec6(b, p5cb::TRIANGLE, argd(ctx,argv[0]), argd(ctx,argv[1]), argd(ctx,argv[2]), argd(ctx,argv[3]), argd(ctx,argv[4]), argd(ctx,argv[5])); }
  else p5::triangle(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2]),argd(ctx,argv[3]),argd(ctx,argv[4]),argd(ctx,argv[5])); return JS_UNDEFINED; }
FN(js_quad) { NODRAW if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec8(b, p5cb::QUAD, argd(ctx,argv[0]), argd(ctx,argv[1]), argd(ctx,argv[2]), argd(ctx,argv[3]), argd(ctx,argv[4]), argd(ctx,argv[5]), argd(ctx,argv[6]), argd(ctx,argv[7])); }
  else p5::quad(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2]),argd(ctx,argv[3]),argd(ctx,argv[4]),argd(ctx,argv[5]),argd(ctx,argv[6]),argd(ctx,argv[7])); return JS_UNDEFINED; }
FN(js_line) { NODRAW if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec4(b, p5cb::LINE, argd(ctx,argv[0]), argd(ctx,argv[1]), argd(ctx,argv[2]), argd(ctx,argv[3])); }
  else p5::line(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2]),argd(ctx,argv[3])); return JS_UNDEFINED; }
FN(js_rectMode) { if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec1(b, p5cb::RECTMODE, argd(ctx, argv[0])); } else p5::rectMode((int)argd(ctx, argv[0])); return JS_UNDEFINED; }
FN(js_ellipseMode) { if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec1(b, p5cb::ELLIPSEMODE, argd(ctx, argv[0])); } else p5::ellipseMode((int)argd(ctx, argv[0])); return JS_UNDEFINED; }
FN(js_push) { if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec0(b, p5cb::PUSH); } else p5::push(); return JS_UNDEFINED; }
FN(js_pop) { if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec0(b, p5cb::POP); } else p5::pop(); return JS_UNDEFINED; }
FN(js_translate) { if (argc >= 3 && p5::isWebgl()) { p5::translate(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2])); return JS_UNDEFINED; }
  if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec2(b, p5cb::TRANSLATE, argd(ctx,argv[0]), argd(ctx,argv[1])); } else p5::translate(argd(ctx,argv[0]),argd(ctx,argv[1])); return JS_UNDEFINED; }
FN(js_rotate) { if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec1(b, p5cb::ROTATE, argd(ctx,argv[0])); } else p5::rotate(argd(ctx,argv[0])); return JS_UNDEFINED; }
FN(js_scale) { p5cb::Buf* b = cbuf(ctx);
  if (argc >= 2) { if (b) { REC(b) p5cb::rec2(b, p5cb::SCALE2, argd(ctx,argv[0]), argd(ctx,argv[1])); } else p5::scale(argd(ctx,argv[0]),argd(ctx,argv[1])); }
  else { if (b) { REC(b) p5cb::rec1(b, p5cb::SCALE1, argd(ctx,argv[0])); } else p5::scale(argd(ctx,argv[0])); }
  return JS_UNDEFINED; }
FN(js_beginShape) { NODRAW if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec0(b, p5cb::BEGINSHAPE); } else p5::beginShape(); return JS_UNDEFINED; }
FN(js_vertex) { NODRAW if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec2(b, p5cb::VERTEX, argd(ctx,argv[0]), argd(ctx,argv[1])); } else p5::vertex(argd(ctx,argv[0]),argd(ctx,argv[1])); return JS_UNDEFINED; }
FN(js_endShape) { NODRAW p5cb::Buf* b = cbuf(ctx);
  if (argc >= 1) { if (b) { REC(b) p5cb::rec1(b, p5cb::ENDSHAPE1, argd(ctx, argv[0])); } else p5::endShape((int)argd(ctx, argv[0])); }
  else { if (b) { REC(b) p5cb::rec0(b, p5cb::ENDSHAPE0); } else p5::endShape(); }
  return JS_UNDEFINED; }
// ---- WEBGL mode (P5_WEBGL_PLAN.md). Direct forwarders; they bypass the
// command buffer (p5cb has no 3D opcodes) and NODRAW like the 2D primitives.
FN(js_rotateX) { p5::rotateX(argd(ctx, argv[0])); return JS_UNDEFINED; }
FN(js_rotateY) { p5::rotateY(argd(ctx, argv[0])); return JS_UNDEFINED; }
FN(js_rotateZ) { p5::rotateZ(argd(ctx, argv[0])); return JS_UNDEFINED; }
FN(js_ambientMaterial) { p5::ambientMaterial(colorFromArgs(ctx, argc, argv)); return JS_UNDEFINED; }
FN(js_specularMaterial) { p5::specularMaterial(colorFromArgs(ctx, argc, argv)); return JS_UNDEFINED; }
FN(js_shininess) { p5::shininess(argd(ctx, argv[0])); return JS_UNDEFINED; }
FN(js_ambientLight) { p5::ambientLight(colorFromArgs(ctx, argc, argv)); return JS_UNDEFINED; }
FN(js_directionalLight) { p5::directionalLight(colorFromArgs(ctx, 3, argv), argd(ctx, argv[3]), argd(ctx, argv[4]), argd(ctx, argv[5])); return JS_UNDEFINED; }
FN(js_pointLight) { p5::pointLight(colorFromArgs(ctx, 3, argv), argd(ctx, argv[3]), argd(ctx, argv[4]), argd(ctx, argv[5])); return JS_UNDEFINED; }
FN(js_box) { NODRAW double w = argd(ctx, argv[0]);
  double h = argc >= 2 ? argd(ctx, argv[1]) : w, d = argc >= 3 ? argd(ctx, argv[2]) : w;
  p5::box(w, h, d); return JS_UNDEFINED; }
FN(js_sphere) { NODRAW p5::sphere(argd(ctx, argv[0])); return JS_UNDEFINED; }
FN(js_ellipsoid) { NODRAW double rx = argd(ctx, argv[0]);
  double ry = argc >= 2 ? argd(ctx, argv[1]) : rx, rz = argc >= 3 ? argd(ctx, argv[2]) : ry;
  p5::ellipsoid(rx, ry, rz); return JS_UNDEFINED; }
FN(js_cylinder) { NODRAW p5::cylinder(argd(ctx, argv[0]), argd(ctx, argv[1])); return JS_UNDEFINED; }
FN(js_cone) { NODRAW p5::cone(argd(ctx, argv[0]), argd(ctx, argv[1])); return JS_UNDEFINED; }
FN(js_keyIsDown) { return JS_NewBool(ctx, p5::keyIsDown((int)argd(ctx, argv[0]))); }
FN(js_noop) { (void)ctx; (void)argc; (void)argv; return JS_UNDEFINED; }
FN(js_createGraphics) { if (p5cb::Buf* b = cbuf(ctx)) p5cb::flush(b, g_nodraw);  // canvas registry changes: drain first
  return JS_NewInt32(ctx, p5::createGraphics(argd(ctx, argv[0]), argd(ctx, argv[1]))); }
FN(js_setTarget) { if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec1(b, p5cb::SETTARGET, argd(ctx, argv[0])); } else p5::setTarget((int)argd(ctx, argv[0])); return JS_UNDEFINED; }
FN(js_clearTarget) { if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec0(b, p5cb::CLEARTARGET); } else p5::clearTarget(); return JS_UNDEFINED; }
FN(js_image) { NODRAW if (p5cb::Buf* b = cbuf(ctx)) { REC(b) p5cb::rec5(b, p5cb::IMAGE, argd(ctx, argv[0]), argd(ctx, argv[1]), argd(ctx, argv[2]), argd(ctx, argv[3]), argd(ctx, argv[4])); }
  else p5::image((int)argd(ctx, argv[0]), argd(ctx, argv[1]), argd(ctx, argv[2]), argd(ctx, argv[3]), argd(ctx, argv[4])); return JS_UNDEFINED; }

FN(js_m_pow)   { return JS_NewFloat64(ctx, js::pow(argd(ctx, argv[0]), argd(ctx, argv[1]))); }
FN(js_m_sqrt)  { return JS_NewFloat64(ctx, js::sqrt(argd(ctx, argv[0]))); }
FN(js_m_sin)   { return JS_NewFloat64(ctx, js::sin(argd(ctx, argv[0]))); }
FN(js_m_cos)   { return JS_NewFloat64(ctx, js::cos(argd(ctx, argv[0]))); }
FN(js_m_atan2) { return JS_NewFloat64(ctx, js::atan2(argd(ctx, argv[0]), argd(ctx, argv[1]))); }
FN(js_m_acos)  { return JS_NewFloat64(ctx, js::acos(argd(ctx, argv[0]))); }
FN(js_m_hypot) { return JS_NewFloat64(ctx, js::hypot(argd(ctx, argv[0]), argd(ctx, argv[1]))); }

struct Binding { const char* name; JSCFunction* fn; int nargs; };
static const Binding BINDINGS[] = {
  {"createCanvas", js_createCanvas, 3}, {"background", js_background, 1},
  {"fill", js_fill, 4}, {"stroke", js_stroke, 4}, {"color", js_color, 4}, {"lerpColor", js_lerpColor, 3},
  {"noStroke", js_noStroke, 0}, {"noFill", js_noFill, 0}, {"strokeWeight", js_strokeWeight, 1},
  {"rect", js_rect, 5}, {"ellipse", js_ellipse, 4}, {"circle", js_circle, 3}, {"arc", js_arc, 6},
  {"triangle", js_triangle, 6}, {"quad", js_quad, 8}, {"line", js_line, 4},
  {"rectMode", js_rectMode, 1}, {"ellipseMode", js_ellipseMode, 1},
  {"push", js_push, 0}, {"pop", js_pop, 0}, {"translate", js_translate, 2},
  {"rotate", js_rotate, 1}, {"scale", js_scale, 2},
  {"beginShape", js_beginShape, 0}, {"vertex", js_vertex, 2}, {"endShape", js_endShape, 1},
  {"keyIsDown", js_keyIsDown, 1},
  {"rotateX", js_rotateX, 1}, {"rotateY", js_rotateY, 1}, {"rotateZ", js_rotateZ, 1},
  {"ambientMaterial", js_ambientMaterial, 3}, {"specularMaterial", js_specularMaterial, 3},
  {"shininess", js_shininess, 1}, {"ambientLight", js_ambientLight, 3},
  {"directionalLight", js_directionalLight, 6}, {"pointLight", js_pointLight, 6},
  {"box", js_box, 3}, {"sphere", js_sphere, 1}, {"ellipsoid", js_ellipsoid, 3},
  {"cylinder", js_cylinder, 2}, {"cone", js_cone, 2},
  {"noLights", js_noop, 0}, {"normalMaterial", js_noop, 0}, {"emissiveMaterial", js_noop, 3},
  {"createGraphics", js_createGraphics, 2}, {"setTarget", js_setTarget, 1},
  {"clearTarget", js_clearTarget, 0}, {"image", js_image, 5},
  {"textSize", js_noop, 1}, {"textAlign", js_noop, 2}, {"text", js_noop, 3},
  {"textFont", js_noop, 1}, {"noSmooth", js_noop, 0}, {"tint", js_noop, 4},
  {"noLoop", js_noop, 0}, {"loop", js_noop, 0}, {"noCursor", js_noop, 0}, {"cursor", js_noop, 0},
  {"frameRate", js_noop, 1}, {"smooth", js_noop, 0},
  {"__m_pow", js_m_pow, 2}, {"__m_sqrt", js_m_sqrt, 1}, {"__m_sin", js_m_sin, 1},
  {"__m_cos", js_m_cos, 1}, {"__m_atan2", js_m_atan2, 2}, {"__m_hypot", js_m_hypot, 2},
  {"__m_acos", js_m_acos, 1},
};

static void setConst(JSContext* ctx, JSValue g, const char* k, double v) { JS_SetPropertyStr(ctx, g, k, JS_NewFloat64(ctx, v)); }

#include "matter_bundle.h"

// p5's math helpers as bare globals, the same set runtime/p5/p5-shim.mjs installs
// and with the same bodies. They were missing here, so a game calling abs() threw
// mid-frame in the native backend and every draw after it was dropped, while the
// reference drew the full frame (jetpack_joyride.spaceship-viz-v2, native/gate_qjs.sh).
// They read Math.* at call time, so the frozen Math.sin/cos/... below apply to them.
static const char* PRELUDE = R"JS(
globalThis.dist=(x1,y1,x2,y2)=>Math.sqrt((x2-x1)**2+(y2-y1)**2);
globalThis.constrain=(v,lo,hi)=>Math.min(Math.max(v,lo),hi);
globalThis.lerp=(a,b,t)=>a+(b-a)*t;
globalThis.map=(v,s1,e1,s2,e2)=>s2+(e2-s2)*((v-s1)/(e1-s1));
globalThis.abs=(v)=>Math.abs(v);globalThis.floor=(v)=>Math.floor(v);globalThis.ceil=(v)=>Math.ceil(v);globalThis.round=(v)=>Math.round(v);
globalThis.sqrt=(v)=>Math.sqrt(v);globalThis.pow=(b,e)=>Math.pow(b,e);globalThis.sin=(a)=>Math.sin(a);globalThis.cos=(a)=>Math.cos(a);globalThis.atan2=(y,x)=>Math.atan2(y,x);
globalThis.min=(...a)=>Math.min(...(a.length===1&&Array.isArray(a[0])?a[0]:a));globalThis.max=(...a)=>Math.max(...(a.length===1&&Array.isArray(a[0])?a[0]:a));
globalThis.random=(a,b)=>a===undefined?Math.random():b===undefined?Math.random()*a:a+Math.random()*(b-a);
globalThis.__mb=function(s){let t=s>>>0;return function(){t+=0x6D2B79F5;let n=Math.imul(t^(t>>>15),t|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296}};
globalThis.millis=()=>frameCount*(1000/60);
globalThis.mouseX=0;globalThis.mouseY=0;globalThis.mouseIsPressed=false;globalThis.gamepadAxes=[0,0,0,0];
Math.pow=__m_pow; Math.sqrt=__m_sqrt; Math.sin=__m_sin; Math.cos=__m_cos; Math.atan2=__m_atan2; Math.hypot=__m_hypot; Math.acos=__m_acos;
)JS";

static inline void cpu_relax() {
#if defined(__aarch64__) || defined(__arm__)
  asm volatile("yield");
#elif defined(__x86_64__) || defined(__i386__)
  asm volatile("pause");
#endif
}

// Default worker count. On homogeneous CPUs (x86 servers) that's every hardware
// thread. On Apple Silicon the 4 efficiency cores are ~half speed, and a
// per-step spin barrier waits for the slowest shard — so scheduling work onto
// them (or oversubscribing with spinning threads) collapses aggregate
// throughput. Default to the performance-core count there.
static int default_threads() {
#if defined(__APPLE__)
  int n = 0; size_t sz = sizeof(n);
  if (sysctlbyname("hw.perflevel0.logicalcpu", &n, &sz, nullptr, 0) == 0 && n > 0)
    return n;
#endif
#if defined(__linux__)
  // Respect the cgroup/affinity limit (SLURM --cpus-per-task), NOT the node's
  // full core count: hardware_concurrency() reported 96 inside a 47-core
  // allocation and the oversubscribed spin barrier collapsed throughput ~70x
  // (measured: 1.4k vs 104k decisions/s, H100 bench job 30281357).
  cpu_set_t set;
  if (sched_getaffinity(0, sizeof(set), &set) == 0) {
    int n = CPU_COUNT(&set);
    if (n > 0) return n;
  }
#endif
  int hw = (int)std::thread::hardware_concurrency();
  return hw > 0 ? hw : 1;
}

// ============================ per-env state ===================================

struct Env {
  JSRuntime* rt = nullptr;
  JSContext* ctx = nullptr;
  JSValue g, jsReset, jsDraw, jsState, jsKeyPressed, jsMousePressed;
  bool hasKeyPressed = false;
  bool hasMousePressed = false;
  uint32_t prev_buttons = 0;   // for the mousePressed() rising-edge event
  void* rstate = nullptr;   // rasterizer per-env state (rs_state_new)
  void* p5state = nullptr;  // p5 shim per-env state (p5::newState)
  p5cb::Buf* cb = nullptr;  // p5 command buffer (PLAYTRAIN_QJS_CMDBUF=1 only)
  // Adaptive dirty-rect (QJS_DIRTY): probe the first frames, keep the
  // whole-frame skip only where the skip rate pays for the record cost
  // (miner-class games; command-heavy games auto-disable). Output is
  // identical either way — only the cost profile changes.
  bool dirty_on = false;
  int dirty_probe = 0;
  int dirty_skips = 0;
  int frameCount = 0;
  long steps = 0;
  double lastScore = 0;
  bool ok = true;
  std::string err;

  inline void select() { rs_state_select(rstate); p5::selectState(p5state); }
  inline void flushCB() { if (cb) p5cb::flush(cb, g_nodraw); }
  inline void setFrame(int fc) { JS_SetPropertyStr(ctx, g, "frameCount", JS_NewInt32(ctx, fc)); }
  inline void call0(JSValue fn) {
    JSValue r = JS_Call(ctx, fn, JS_UNDEFINED, 0, nullptr);
    if (JS_IsException(r)) { JSValue e = JS_GetException(ctx); const char* s = JS_ToCString(ctx, e);
      err = s ? s : "?"; ok = false; JS_FreeCString(ctx, s); JS_FreeValue(ctx, e); }
    JS_FreeValue(ctx, r);
  }
  void resetGame(uint32_t s) {
    char buf[64]; snprintf(buf, sizeof buf, "Math.random=__mb(%u)", s);
    JSValue r0 = JS_Eval(ctx, buf, strlen(buf), "<seed>", JS_EVAL_TYPE_GLOBAL); JS_FreeValue(ctx, r0);
    JSValue a = JS_NewInt32(ctx, (int)s);
    JSValue r = JS_Call(ctx, jsReset, JS_UNDEFINED, 1, &a);
    // Record it like call0 does. Dropping it here is how a game that throws on
    // every reset produced black frames and no error for a whole training run.
    if (JS_IsException(r)) { JSValue e = JS_GetException(ctx); const char* cs = JS_ToCString(ctx, e);
      err = cs ? cs : "?"; ok = false; JS_FreeCString(ctx, cs); JS_FreeValue(ctx, e); }
    JS_FreeValue(ctx, r); JS_FreeValue(ctx, a);
  }
  // read score/lives/gameState into out params; returns term flag.
  bool readState(double& score, double& lives, uint8_t& gsIdx) {
    JSValue st = JS_Call(ctx, jsState, JS_UNDEFINED, 0, nullptr);
    JSValue sc = JS_GetPropertyStr(ctx, st, "score"); JS_ToFloat64(ctx, &score, sc); JS_FreeValue(ctx, sc);
    JSValue lv = JS_GetPropertyStr(ctx, st, "lives"); JS_ToFloat64(ctx, &lives, lv); JS_FreeValue(ctx, lv);
    JSValue gs = JS_GetPropertyStr(ctx, st, "gameState"); const char* s = JS_ToCString(ctx, gs);
    char last[32]; last[0] = 0; if (s) { strncpy(last, s, 31); last[31] = 0; }
    JS_FreeCString(ctx, s); JS_FreeValue(ctx, gs); JS_FreeValue(ctx, st);
    bool term = last[0] && (!strcmp(last,"WIN") || !strcmp(last,"EXIT") || !strcmp(last,"GAMEOVER"));
    gsIdx = !strcmp(last,"PLAYING") ? 0 : !strcmp(last,"WIN") ? 1 : !strcmp(last,"GAMEOVER") ? 2 : !strcmp(last,"EXIT") ? 3 : 4;
    return term;
  }
};

// Bounded lock-free MPMC queue (Vyukov). Async stepping needs a queue whose
// per-item cost is ~100 ns, not the µs-scale futex of a condition variable —
// otherwise, at a ~5 µs frame, coordination costs more than the work (a naive
// mutex+cv version measured *slower* than the sync barrier). Workers spin-pop, so
// they stay hot. Capacity is a power of two ≥ num_envs+1; in-flight ids never
// exceed num_envs (each env is in exactly one of: input queue / stepping / ready
// queue), so push never fails.
struct MPMC {
  struct Cell { std::atomic<size_t> seq; int val; };
  std::vector<Cell> buf;
  size_t mask = 0;
  alignas(128) std::atomic<size_t> enq{0};
  alignas(128) std::atomic<size_t> deq{0};
  void init(size_t cap) {
    buf = std::vector<Cell>(cap);
    mask = cap - 1;
    for (size_t i = 0; i < cap; i++) buf[i].seq.store(i, std::memory_order_relaxed);
  }
  bool push(int v) {
    size_t pos = enq.load(std::memory_order_relaxed);
    for (;;) {
      Cell& c = buf[pos & mask];
      size_t s = c.seq.load(std::memory_order_acquire);
      intptr_t d = (intptr_t)s - (intptr_t)pos;
      if (d == 0) { if (enq.compare_exchange_weak(pos, pos + 1, std::memory_order_relaxed)) { c.val = v; c.seq.store(pos + 1, std::memory_order_release); return true; } }
      else if (d < 0) return false;
      else pos = enq.load(std::memory_order_relaxed);
    }
  }
  bool pop(int& v) {
    size_t pos = deq.load(std::memory_order_relaxed);
    for (;;) {
      Cell& c = buf[pos & mask];
      size_t s = c.seq.load(std::memory_order_acquire);
      intptr_t d = (intptr_t)s - (intptr_t)(pos + 1);
      if (d == 0) { if (deq.compare_exchange_weak(pos, pos + 1, std::memory_order_relaxed)) { v = c.val; c.seq.store(pos + mask + 1, std::memory_order_release); return true; } }
      else if (d < 0) return false;
      else pos = deq.load(std::memory_order_relaxed);
    }
  }
};

static size_t next_pow2(size_t n) { size_t p = 1; while (p < n) p <<= 1; return p; }

// Per-worker done flag, each on its own cacheline. A single shared decrement
// counter would bounce one cacheline across all cores every step (an RMW per
// worker), which at 1 env/thread roughly halved throughput. With per-worker
// flags each helper writes only its OWN line and the caller read-polls T lines —
// no cross-core RMW contention.
struct alignas(128) WorkerCtl {
  std::atomic<uint64_t> done{0};
};

struct VecHost {
  VecHost() { actions.installDefault8(); }
  // Discrete action table (see action_table.hpp). default8 unless the caller
  // installs a custom one via vec_set_actions (+ vec_set_action_analog).
  ActionTable actions;
  // Box-space channel map (vec_set_input_map); box_mode routes stepping
  // through quantized action vectors (vec_step_q) instead of the int table.
  InputMap imap;
  bool box_mode = false;
  std::vector<Env> envs;
  std::vector<std::string> srcs;   // game source per env (all equal for single-game)
  int num_envs = 0, obs_size = 0, obs_bytes = 0, max_steps = 2000, autoreset = 0;
  // Action-repeat: run `frame_skip` game ticks per vec_step, holding the action
  // (semantics mirror runtime/p5/game-env.mjs: per-frame terminal/trunc check
  // with early break, `steps`/`max_steps` count FRAMES, reward = end-score -
  // start-score, obs rendered once after the last tick). 1 == original behavior.
  int frame_skip = 1;
  // Render-skip: with frame_skip>1, only the LAST tick of each skip renders
  // pixels — the intermediate frames' draw calls are no-oped (game LOGIC runs
  // untouched: fill/push/translate and all state still execute; these games
  // repaint from scratch after background() every frame and never read
  // pixels, so the final rendered frame is bit-identical). ONLY valid with
  // autoreset: an episode ending mid-skip leaves a stale canvas, but
  // SAME_STEP autoreset overwrites the obs with the fully-rendered reset
  // frame before anything is surfaced. Enforced by the Python wrapper.
  // Exception class (none in the consumer catalog): games accumulating into
  // createGraphics layers across frames.
  int render_skip = 0;
  // Autoreset seeding policy (SAME_STEP autoreset + vec_reset fallbacks):
  //   mode 0 = legacy formula idx*100003+steps+1 (default, original behavior)
  //   mode 1 = fixed_seed on every autoreset (a consumer's fixed_env_seed)
  //   mode 2 = sample uniformly from seed_pool via per-env splitmix64
  //            (a consumer's train_pool / SeedSetWrapper)
  int seed_mode = 0;
  uint32_t fixed_seed = 0;
  std::vector<int32_t> seed_pool;
  std::vector<uint64_t> rng;       // per-env splitmix64 state (mode 2)
  int nthreads = 1;
  std::vector<std::thread> pool;      // helper threads (pool[0] is unused; caller does shard 0)
  std::vector<int> shard_start;       // size nthreads+1

  // batch command plumbing (go on its own line; helpers only read it)
  alignas(128) std::atomic<uint64_t> go{0};
  std::vector<WorkerCtl> done;        // per-helper completion generation
  std::atomic<bool> stop{false};
  // Hybrid idle parking. Pure spin-wait is right for the hot loop (next
  // dispatch is µs away) but wrong when the Python side blocks for seconds
  // (e.g. waiting on the trainer's free_queue): idle helpers then burn a full
  // core each, and on core-tight nodes that starves anything else — measured
  // strangling a torch max-autotune compile at 23 cores. Helpers spin a
  // bounded budget, then sleep on park_cv; producers notify only when
  // parked > 0, so the hot path pays one relaxed load and no syscall.
  // wait_for (not wait) bounds any theoretically-missed wake at 100 ms.
  alignas(128) std::atomic<int> parked{0};
  alignas(128) std::atomic<uint64_t> send_gen{0};   // bumped once per vec_send
  std::mutex park_mu;
  std::condition_variable park_cv;
  int cmd = 0;                         // 0 = step, 1 = reset, 2 = init, 3 = step_q
  const int32_t* in_actions = nullptr;
  const uint16_t* in_qacts = nullptr;  // cmd 3: num_envs * imap.n wire values
  const int32_t* in_seeds = nullptr;
  uint8_t* out_obs = nullptr;
  float*   out_rew = nullptr;
  uint8_t* out_term = nullptr;
  uint8_t* out_trunc = nullptr;

  // ---- async mode (envpool-style send/recv; no per-step barrier) ----
  // Workers pull env ids off an input queue, step them at their own pace (env
  // state is selected per-env so any worker can run any env), and publish
  // finished ids to a ready queue. recv() waits for batch_size finished envs, so
  // a slow env never stalls the batch — the barrier tail latency is gone.
  bool async = false;
  std::vector<int> act;   // per-env pending action
  // One input queue PER WORKER: env i is owned by worker i % nthreads, for
  // its whole life (init, every step, autoreset). A single shared work-stealing
  // queue let any worker step any env, so each frame FREED buffers another
  // thread had malloc'd (rasterizer path Vecs, engine property arrays) — every
  // such free/realloc takes the owning glibc arena's mutex, and with 5+ workers
  // those collide and futex-sleep: measured ~1M voluntary context switches and
  // 6x lower throughput than the sync path on the same binary (fruitbot,
  // g256 t5). Pinning keeps each env's malloc traffic on one thread's arena,
  // exactly as run_shard does for the sync host. The interleaved ownership
  // (i % T, not contiguous shards) keeps a contiguous ping-pong group spread
  // evenly across workers.
  std::unique_ptr<MPMC[]> inq;   // inq[t]: env ids for worker t (main -> worker t)
  alignas(128) std::atomic<int> async_init_left{0};   // workers still running env_init
  // vec_async_reset also runs on the owners (token ~i on inq[i % T]), for the
  // same reason: a reset allocates the episode's whole game state, and doing it
  // on the caller would put every env's live heap in the caller's arena.
  alignas(128) std::atomic<int> async_resets_left{0};
  std::vector<uint32_t> reset_seeds;
  MPMC readyq;            // finished env ids (workers -> main)

  // ---- group (ping-pong) mode on the async host ----
  // vec_send + vec_wait_ids instead of vec_recv: the caller sends one GROUP
  // of envs, overlaps Python/GPU work on the other group, then waits for
  // exactly those ids. busy[i] is set at send and cleared by the worker
  // after the env's outputs are fully written. group_mode disables readyq
  // publication (nothing pops it in this mode; a full queue would deadlock).
  bool group_mode = false;
  std::unique_ptr<std::atomic<uint8_t>[]> busy;
};

// ---- build one env's interpreter (called ON its owning worker thread) ----
static void env_init(VecHost* H, Env& e, int idx) {
  const std::string& src = H->srcs[idx];
  e.rstate = rs_state_new();
  e.p5state = p5::newState();
  e.select();
  e.rt = JS_NewRuntime();
  JS_SetMaxStackSize(e.rt, 0);     // interpreter runs on a worker thread; disable SP check
  e.ctx = JS_NewContext(e.rt);
  JSContext* ctx = e.ctx;
  e.g = JS_GetGlobalObject(ctx);
  JSValue g = e.g;
  for (const auto& b : BINDINGS) JS_SetPropertyStr(ctx, g, b.name, JS_NewCFunction(ctx, b.fn, b.name, b.nargs));
  setConst(ctx, g, "LEFT_ARROW", 37); setConst(ctx, g, "UP_ARROW", 38);
  setConst(ctx, g, "RIGHT_ARROW", 39); setConst(ctx, g, "DOWN_ARROW", 40); setConst(ctx, g, "ENTER", 13);
  setConst(ctx, g, "CENTER", p5::CENTER); setConst(ctx, g, "CORNER", p5::CORNER);
  setConst(ctx, g, "RIGHT", p5::RIGHT); setConst(ctx, g, "TOP", p5::TOP);
  setConst(ctx, g, "BOTTOM", p5::BOTTOM); setConst(ctx, g, "BASELINE", p5::BASELINE);
  setConst(ctx, g, "LEFT", p5::LEFT); setConst(ctx, g, "CLOSE", p5::CLOSE);
  setConst(ctx, g, "WEBGL", p5::WEBGL); setConst(ctx, g, "P2D", p5::P2D);
  setConst(ctx, g, "PI", p5::PI); setConst(ctx, g, "TWO_PI", p5::TWO_PI); setConst(ctx, g, "HALF_PI", p5::HALF_PI);
  setConst(ctx, g, "frameCount", 0);
  { JSValue r = JS_Eval(ctx, PRELUDE, strlen(PRELUDE), "<prelude>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) { JSValue ex = JS_GetException(ctx); const char* s = JS_ToCString(ctx, ex); e.err = s?s:"prelude"; e.ok=false; JS_FreeCString(ctx,s); JS_FreeValue(ctx,ex); }
    JS_FreeValue(ctx, r); }
  // Matter.js games expect a `Matter` global. Same auto-detect the node backend
  // uses (env.py: "Matter." in the source), so non-physics games pay nothing.
  if (e.ok && src.find("Matter.") != std::string::npos) {
    JSValue r = JS_Eval(ctx, MATTER_JS, strlen(MATTER_JS), "<matter>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) { JSValue ex = JS_GetException(ctx); const char* s2 = JS_ToCString(ctx, ex); e.err = s2?s2:"matter"; e.ok=false; JS_FreeCString(ctx,s2); JS_FreeValue(ctx,ex); }
    JS_FreeValue(ctx, r);
  }
  if (p5cb::enabled()) { e.cb = p5cb::create(); JS_SetContextOpaque(ctx, e.cb); }
  // Opt-in dirty-rect whole-frame skip (QJS_DIRTY, like qjs_host): identical
  // command streams skip the raster pass entirely; per-env state, so this
  // applies to the state selected above. Probed adaptively (see Env).
  if (getenv("QJS_DIRTY")) {
    p5::setDirty(true);
    e.dirty_on = true;
    // 20 frames: fits inside bench_vec_rollout's untimed warmup (default 20),
    // so the probe transient never lands in a measured window.
    e.dirty_probe = 20;
    e.dirty_skips = 0;
  }
  p5::setRasterRes(H->obs_size);
  { JSValue r = JS_Eval(ctx, src.c_str(), src.size(), "game.js", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) { JSValue ex = JS_GetException(ctx); const char* s = JS_ToCString(ctx, ex); e.err = s?s:"eval"; e.ok=false; JS_FreeCString(ctx,s); JS_FreeValue(ctx,ex); }
    JS_FreeValue(ctx, r); }
  JSValue jsSetup = JS_GetPropertyStr(ctx, g, "setup");
  e.jsReset = JS_GetPropertyStr(ctx, g, "resetGame");
  e.jsDraw  = JS_GetPropertyStr(ctx, g, "draw");
  e.jsState = JS_GetPropertyStr(ctx, g, "getGameState");
  e.jsKeyPressed = JS_GetPropertyStr(ctx, g, "keyPressed");
  e.hasKeyPressed = JS_IsFunction(ctx, e.jsKeyPressed);
  e.jsMousePressed = JS_GetPropertyStr(ctx, g, "mousePressed");
  e.hasMousePressed = JS_IsFunction(ctx, e.jsMousePressed);
  e.call0(jsSetup);
  e.flushCB();
  JS_FreeValue(ctx, jsSetup);
}

// Apply one resolved input frame (see action_table.hpp): keys down, optional
// pointer/axes globals, mouseIsPressed, and the one-shot keyPressed()/
// mousePressed() events — all BEFORE the tick loop, mirroring the Node shim.
// Pure-keyboard frames touch nothing beyond setKeysDown + keyPressed, so the
// default8 hot path is unchanged.
static void env_apply_frame(Env& e, const InputFrame& f) {
  p5::setKeysDown(f.codes, f.ncodes);
  if (f.press >= 0) {
    JS_SetPropertyStr(e.ctx, e.g, "keyCode", JS_NewInt32(e.ctx, f.press));
    if (e.hasKeyPressed) e.call0(e.jsKeyPressed);
  }
  if (f.set_pointer) {
    // Dequantize with the wire formula (q/65535) into logical canvas coords.
    JS_SetPropertyStr(e.ctx, e.g, "mouseX",
                      JS_NewFloat64(e.ctx, (f.qx / 65535.0) * p5::width()));
    JS_SetPropertyStr(e.ctx, e.g, "mouseY",
                      JS_NewFloat64(e.ctx, (f.qy / 65535.0) * p5::height()));
  }
  if (f.set_pointer || f.buttons || e.prev_buttons) {
    JS_SetPropertyStr(e.ctx, e.g, "mouseIsPressed", JS_NewBool(e.ctx, (f.buttons & 1u) ? 1 : 0));
    if ((f.buttons & 1u) && !(e.prev_buttons & 1u) && e.hasMousePressed)
      e.call0(e.jsMousePressed);
    e.prev_buttons = f.buttons;
  }
  if (f.set_axes) {
    JSValue arr = JS_NewArray(e.ctx);
    for (int j = 0; j < 4; j++)
      JS_SetPropertyUint32(e.ctx, arr, (uint32_t)j,
                           JS_NewFloat64(e.ctx, (f.qaxes[j] / 65535.0) * 2.0 - 1.0));
    JS_SetPropertyStr(e.ctx, e.g, "gamepadAxes", arr);
  }
  e.flushCB();  // keyPressed/mousePressed handlers may have issued draw calls
}

// ---- one env reset (mirrors qjs_host serve cmd 0) ----
static void env_reset(VecHost* H, Env& e, int idx, uint32_t seed) {
  e.select();
  g_nodraw = false;  // reset frames always render fully
  // Dirty mode: the reset frame renders OUTSIDE the frame bracket, so the
  // cached command-stream hash no longer describes the pixels — clear it
  // (setDirty resets has_last) so the first post-reset frame never skips
  // against a pre-reset hash.
  if (e.dirty_on) p5::setDirty(true);
  p5::setKeysDown(nullptr, 0);
  if (H->actions.any_analog || H->box_mode) {
    // Pointer/axes state is per-episode: park at rest, like setKeysDown([]).
    e.prev_buttons = 0;
    JS_SetPropertyStr(e.ctx, e.g, "mouseX", JS_NewFloat64(e.ctx, 0));
    JS_SetPropertyStr(e.ctx, e.g, "mouseY", JS_NewFloat64(e.ctx, 0));
    JS_SetPropertyStr(e.ctx, e.g, "mouseIsPressed", JS_NewBool(e.ctx, 0));
    JSValue arr = JS_NewArray(e.ctx);
    for (int j = 0; j < 4; j++) JS_SetPropertyUint32(e.ctx, arr, (uint32_t)j, JS_NewFloat64(e.ctx, 0));
    JS_SetPropertyStr(e.ctx, e.g, "gamepadAxes", arr);
  }
  e.frameCount = 0; e.setFrame(0);
  e.resetGame(seed);
  e.flushCB();
  e.frameCount = 1; e.setFrame(1);
  e.call0(e.jsDraw);
  e.flushCB();
  double score = 0, lives = 0; uint8_t gs = 0;
  e.readState(score, lives, gs);
  e.flushCB();
  e.steps = 0; e.lastScore = score;
  p5::render_obs_rgb(H->out_obs + (size_t)idx * H->obs_bytes);
}

// Next autoreset seed for env idx, per the host's seeding policy.
static inline uint32_t autoreset_seed(VecHost* H, Env& e, int idx) {
  switch (H->seed_mode) {
    case 1: return H->fixed_seed;
    case 2: {
      uint64_t& s = H->rng[idx];                       // splitmix64
      s += 0x9E3779B97F4A7C15ULL;
      uint64_t z = s;
      z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
      z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
      z ^= z >> 31;
      return (uint32_t)H->seed_pool[z % H->seed_pool.size()];
    }
    default: return (uint32_t)(idx * 100003u + (uint32_t)e.steps + 1u);
  }
}

// ---- one env step (mirrors qjs_host serve cmd 1 / stepEnv; frame_skip loop
// mirrors runtime/p5/game-env.mjs step()) ----
// Tick loop shared by the discrete (cmd 0) and box (cmd 3) step paths;
// the input frame has already been applied.
static void env_step_frame(VecHost* H, Env& e, int idx) {
  double score = 0, lives = 0; uint8_t gs = 0;
  bool term = false, trunc = false;
  for (int k = 0; k < H->frame_skip; k++) {
    // Render-skip: no-op draw calls on all but the final tick of the skip.
    g_nodraw = H->render_skip && (k + 1 < H->frame_skip);
    e.frameCount++; e.setFrame(e.frameCount);
    p5::frameBegin(); e.call0(e.jsDraw); e.flushCB();
    int fskip = p5::frameEnd();
    if (e.dirty_probe > 0) {
      e.dirty_skips += fskip;
      if (--e.dirty_probe == 0 && e.dirty_skips * 4 < 20 * 3) {
        // skip rate under 75%: recording costs more than skipping saves
        // (command-heavy games lose even at ~60% skips — measured on maze)
        p5::setDirty(false);
        e.dirty_on = false;
      }
    }
    term = e.readState(score, lives, gs);
    e.flushCB();
    e.steps++;
    trunc = (!term && e.steps >= H->max_steps);
    if (term || trunc) break;   // stop ticking a finished episode
  }
  g_nodraw = false;
  double reward = score - e.lastScore; e.lastScore = score;  // summed delta over the skip
  H->out_rew[idx]   = (float)reward;
  H->out_term[idx]  = term ? 1 : 0;
  H->out_trunc[idx] = trunc ? 1 : 0;
  p5::render_obs_rgb(H->out_obs + (size_t)idx * H->obs_bytes);
  if (H->autoreset && (term || trunc)) {
    // SAME_STEP autoreset: overwrite obs with the reset frame; done flag stays set.
    env_reset(H, e, idx, autoreset_seed(H, e, idx));
  }
}

// ---- one env step, discrete action (mirrors qjs_host serve cmd 1) ----
static void env_step(VecHost* H, Env& e, int idx, int action) {
  e.select();
  InputFrame f;
  H->actions.frameFor(H->actions.clamp(action), f);
  env_apply_frame(e, f);
  env_step_frame(H, e, idx);
}

// ---- one env step, quantized box-action vector (cmd 3) ----
static void env_step_q(VecHost* H, Env& e, int idx, const uint16_t* q) {
  e.select();
  InputFrame f;
  H->imap.frameFor(q, f);
  env_apply_frame(e, f);
  env_step_frame(H, e, idx);
}

// ---- process one thread's shard for the current batch command ----
static void run_shard(VecHost* H, int t) {
  int lo = H->shard_start[t], hi = H->shard_start[t + 1];
  for (int i = lo; i < hi; i++) {
    Env& e = H->envs[i];
    if (H->cmd == 2)      env_init(H, e, i);
    else if (H->cmd == 1) env_reset(H, e, i, (uint32_t)H->in_seeds[i]);
    else if (H->cmd == 3) env_step_q(H, e, i, H->in_qacts + (size_t)i * H->imap.n);
    else                  env_step(H, e, i, H->in_actions[i]);
  }
}

// Spin budget before parking: must exceed normal intra-rollout waits (shard
// imbalance is ms-scale — a 100 µs budget measured a 10% barrier regression
// from helpers parking every step), while still bounding a true stall's burn
// to a few ms. Clock checked only every kParkCheckSpins pauses so the hot
// spin stays branch-cheap.
static const int kParkCheckSpins = 4096;
static const auto kParkAfter = std::chrono::milliseconds(5);

// Returns true when the caller has spun past the park budget. `spins` and
// `t0` are the caller's loop-local state; resets both when the budget fires.
static inline bool park_due(int& spins, std::chrono::steady_clock::time_point& t0) {
  if (++spins < kParkCheckSpins) return false;
  spins = 0;
  auto now = std::chrono::steady_clock::now();
  if (t0 == std::chrono::steady_clock::time_point{}) { t0 = now; return false; }
  if (now - t0 < kParkAfter) return false;
  t0 = std::chrono::steady_clock::time_point{};
  return true;
}

static void worker_loop(VecHost* H, int t) {
  uint64_t seen = 0;
  for (;;) {
    uint64_t g;
    int spins = 0;
    std::chrono::steady_clock::time_point t0{};
    while ((g = H->go.load(std::memory_order_acquire)) == seen) {
      if (H->stop.load(std::memory_order_acquire)) return;
      if (!park_due(spins, t0)) { cpu_relax(); continue; }
      // Stay parked until real work/stop arrives: re-waiting under the lock
      // (not re-spinning the budget) keeps idle cost at one predicate check
      // per 100 ms. The timeout only bounds a theoretically-missed wake.
      std::unique_lock<std::mutex> lk(H->park_mu);
      H->parked.fetch_add(1, std::memory_order_seq_cst);
      while (H->go.load(std::memory_order_acquire) == seen &&
             !H->stop.load(std::memory_order_acquire))
        H->park_cv.wait_for(lk, std::chrono::milliseconds(100));
      H->parked.fetch_sub(1, std::memory_order_relaxed);
    }
    if (H->stop.load(std::memory_order_acquire)) return;
    run_shard(H, t);
    seen = g;
    H->done[t].done.store(g, std::memory_order_release);   // publish completion
  }
}

// Wake parked helpers after publishing new work / stop. The lock_guard
// handshake (acquire+release, no work inside) pairs with the waiter's
// parked++-then-recheck under the same mutex, so a wake can't slip between
// its predicate check and its sleep.
static inline void wake_parked(VecHost* H) {
  if (H->parked.load(std::memory_order_acquire) > 0) {
    { std::lock_guard<std::mutex> lk(H->park_mu); }
    H->park_cv.notify_all();
  }
}

// Dispatch the current cmd to all shards: caller thread runs shard 0, helper
// threads run shards 1..T-1. Blocks until every helper has published this
// generation (per-worker-flag spin barrier).
static void dispatch(VecHost* H) {
  int T = H->nthreads;
  if (T <= 1) { run_shard(H, 0); return; }
  uint64_t g = H->go.fetch_add(1, std::memory_order_release) + 1;  // release helpers
  wake_parked(H);
  run_shard(H, 0);                                                  // caller does shard 0
  for (int t = 1; t < T; t++)
    while (H->done[t].done.load(std::memory_order_acquire) != g) cpu_relax();
}

// Async worker t: init its own envs (i % T == t), then spin-pop ids off ITS
// queue, step them, publish them ready. See VecHost::inq for why envs are pinned.
static void worker_async(VecHost* H, int t) {
  for (int i = t; i < H->num_envs; i += H->nthreads) env_init(H, H->envs[i], i);
  H->async_init_left.fetch_sub(1, std::memory_order_acq_rel);
  MPMC& q = H->inq[t];
  uint64_t seen_send = H->send_gen.load(std::memory_order_acquire);
  for (;;) {
    int env;
    int spins = 0;
    std::chrono::steady_clock::time_point t0{};
    while (!q.pop(env)) {
      if (H->stop.load(std::memory_order_acquire)) return;
      if (!park_due(spins, t0)) { cpu_relax(); continue; }
      // Park on the send generation: bumped once per vec_send batch, so no
      // per-env RMW is added to the queue hot path.
      uint64_t sg = H->send_gen.load(std::memory_order_acquire);
      if (sg != seen_send) { seen_send = sg; continue; }
      std::unique_lock<std::mutex> lk(H->park_mu);
      H->parked.fetch_add(1, std::memory_order_seq_cst);
      while (H->send_gen.load(std::memory_order_acquire) == seen_send &&
             !H->stop.load(std::memory_order_acquire))
        H->park_cv.wait_for(lk, std::chrono::milliseconds(100));
      H->parked.fetch_sub(1, std::memory_order_relaxed);
      seen_send = H->send_gen.load(std::memory_order_acquire);
    }
    if (env < 0) {                       // reset token from vec_async_reset
      int idx = ~env;
      env_reset(H, H->envs[idx], idx, H->reset_seeds[idx]);
      H->async_resets_left.fetch_sub(1, std::memory_order_acq_rel);
      continue;
    }
    env_step(H, H->envs[env], env, H->act[env]);
    if (H->group_mode) {
      // Outputs are fully written; release-store so the waiter's acquire
      // load observes them.
      H->busy[env].store(0, std::memory_order_release);
    } else {
      while (!H->readyq.push(env)) cpu_relax(); // never fails (in-flight <= num_envs)
    }
  }
}

static bool read_file(const char* path, std::string& out) {
  FILE* f = fopen(path, "rb");
  if (!f) { fprintf(stderr, "qjs_vec: cannot open %s\n", path); return false; }
  fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
  out.resize(sz);
  bool ok = fread(&out[0], 1, sz, f) == (size_t)sz;
  fclose(f);
  return ok;
}

// ================================ C ABI =======================================
// The vec_* functions below are the .so's entire public surface (loaded via
// ctypes). Under -fvisibility=hidden builds this pragma keeps them exported
// while everything else (engine, rasterizer, p5) goes DSO-local — intra-.so
// calls then skip the PLT and stay inlinable under LTO.
#if defined(__GNUC__)
#pragma GCC visibility push(default)
#endif
extern "C" {

// Last init failure, for the caller to report. A JS error at env init used to be
// printed to stderr while vec_create still returned a live handle, so a game the
// engine could not run (a Matter.js game before matter was compiled in, say)
// trained on all-black frames and zero reward instead of failing.
static std::string g_last_error;
const char* vec_last_error() { return g_last_error.c_str(); }
void vec_close(void* h);   // defined below; used by the create paths on failure

// First env stuck in an error state, or nullptr when all are healthy. Polled by
// the Python wrapper after reset and after the first step: a JS exception in
// resetGame or draw leaves the frame blank rather than stopping anything, and
// that reads as a game that trains badly instead of one that never ran.
const char* vec_error(void* h) {
  if (!h) return nullptr;
  VecHost* H = (VecHost*)h;
  for (auto& e : H->envs) if (!e.ok) { g_last_error = e.err; return g_last_error.c_str(); }
  return nullptr;
}

void* vec_create(const char* game_path, int num_envs, int obs_size,
                 int max_steps, int num_threads, int autoreset) {
  std::string src;
  if (!read_file(game_path, src)) return nullptr;

  VecHost* H = new VecHost();
  H->srcs.assign(num_envs, src);
  H->num_envs = num_envs;
  H->obs_size = obs_size;
  H->obs_bytes = obs_size * obs_size * 3;
  H->max_steps = max_steps > 0 ? max_steps : 2000;
  H->autoreset = autoreset;
  int T = num_threads > 0 ? num_threads : default_threads();
  if (T > num_envs) T = num_envs;
  if (T < 1) T = 1;
  H->nthreads = T;
  H->envs.resize(num_envs);

  // static contiguous shard partition
  H->shard_start.resize(T + 1);
  for (int t = 0; t <= T; t++) H->shard_start[t] = (int)((long)t * num_envs / T);

  // spawn helper threads (shards 1..T-1); they park in worker_loop
  H->done = std::vector<WorkerCtl>(T);   // WorkerCtl holds an atomic (non-movable)
  H->pool.resize(T);
  for (int t = 1; t < T; t++) H->pool[t] = std::thread(worker_loop, H, t);

  // init all envs on their owning threads (cmd 2)
  H->cmd = 2;
  dispatch(H);

  for (auto& e : H->envs) {
    if (!e.ok) {
      g_last_error = e.err;
      fprintf(stderr, "qjs_vec: env init failed: %s\n", e.err.c_str());
      vec_close(H);
      return nullptr;
    }
  }
  g_last_error.clear();
  return H;
}

int vec_obs_bytes(void* h) { return h ? ((VecHost*)h)->obs_bytes : 0; }
int vec_num_threads(void* h) { return h ? ((VecHost*)h)->nthreads : 0; }

void vec_reset(void* h, const int32_t* seeds, uint8_t* obs) {
  VecHost* H = (VecHost*)h;
  H->cmd = 1; H->in_seeds = seeds; H->out_obs = obs;
  dispatch(H);
}

void vec_step(void* h, const int32_t* actions, uint8_t* obs,
              float* rew, uint8_t* term, uint8_t* trunc) {
  VecHost* H = (VecHost*)h;
  H->cmd = 0;
  H->in_actions = actions; H->out_obs = obs;
  H->out_rew = rew; H->out_term = term; H->out_trunc = trunc;
  dispatch(H);
}

// Reset a SUBSET of envs (for Gymnasium autoreset). Runs on the caller thread —
// safe because sync workers are parked on `go` between vec_step calls and touch
// no env state. Each env's reset obs is written into `obs` at its own index.
void vec_reset_subset(void* h, const int32_t* ids, const int32_t* seeds,
                      int count, uint8_t* obs) {
  VecHost* H = (VecHost*)h;
  H->out_obs = obs;
  for (int k = 0; k < count; k++) {
    int i = ids[k];
    env_reset(H, H->envs[i], i, (uint32_t)seeds[k]);
  }
}

// Install a custom discrete action table (semantics in action_table.hpp:
// `held` is flat n_actions*max_held, -1 padded, the spec's held keys verbatim;
// `press` is n_actions, -1 = none — the press key is unioned into the frame's
// down-keys internally). Call between batches, like vec_set_frame_skip —
// workers are parked then, so no dispatch races. Returns 1 on success, 0 on
// rejected input (table unchanged). Never called == the frozen default8.
int vec_set_actions(void* h, const int32_t* held, const int32_t* press,
                    int n_actions, int max_held) {
  VecHost* H = (VecHost*)h;
  if (!H) return 0;
  if (!H->actions.install(held, press, n_actions, max_held)) {
    fprintf(stderr, "qjs_vec: vec_set_actions rejected (n_actions=%d max_held=%d)\n",
            n_actions, max_held);
    return 0;
  }
  return 1;
}

// Attach per-action analog fields (pointer/buttons/axes; see action_table.hpp)
// to the installed table. Arrays are sized to the table's n_actions; any may
// be NULL. Call after vec_set_actions, between batches. Returns 1 on success.
int vec_set_action_analog(void* h, const uint16_t* qpointer,
                          const uint8_t* has_pointer, const uint32_t* buttons,
                          const uint16_t* qaxes) {
  VecHost* H = (VecHost*)h;
  if (!H) return 0;
  return H->actions.installAnalog(qpointer, has_pointer, buttons, qaxes) ? 1 : 0;
}

// Install a box-space channel map (kinds/args per action_table.hpp InputMap)
// and switch the host to quantized stepping via vec_step_q. Call between
// batches. Returns 1 on success, 0 on rejected input (mode unchanged).
int vec_set_input_map(void* h, const int32_t* kinds, const int32_t* args,
                      int n_channels) {
  VecHost* H = (VecHost*)h;
  if (!H) return 0;
  if (!H->imap.install(kinds, args, n_channels)) {
    fprintf(stderr, "qjs_vec: vec_set_input_map rejected (n_channels=%d)\n", n_channels);
    return 0;
  }
  H->box_mode = true;
  return 1;
}

// Step every env with a quantized box-action vector: qacts holds
// num_envs * n_channels uint16 wire values (see the quantization contract in
// action_table.hpp). Requires a prior vec_set_input_map. Sync host only.
void vec_step_q(void* h, const uint16_t* qacts, uint8_t* obs,
                float* rew, uint8_t* term, uint8_t* trunc) {
  VecHost* H = (VecHost*)h;
  if (!H->box_mode) { fprintf(stderr, "qjs_vec: vec_step_q without an input map\n"); return; }
  H->cmd = 3;
  H->in_qacts = qacts; H->out_obs = obs;
  H->out_rew = rew; H->out_term = term; H->out_trunc = trunc;
  dispatch(H);
}

// Set action-repeat (>= 1; see VecHost.frame_skip). Call between batches —
// workers are parked then, so no dispatch races. Sync and async hosts.
void vec_set_frame_skip(void* h, int k) {
  VecHost* H = (VecHost*)h;
  H->frame_skip = k > 1 ? k : 1;
}

// Draw-call counting: enable, read, reset. Counts every call into one of the
// NODRAW-guarded p5 bindings (background/rect/ellipse/circle/arc/triangle/quad/
// line/vertex/image/stroke), across all envs, so the caller divides by
// steps*num_envs to get calls per frame.
void vec_set_count_draws(int on) { g_count_draws = on != 0; }
unsigned long long vec_get_draw_calls() {
  return g_draw_calls.load(std::memory_order_relaxed);
}
void vec_reset_draw_calls() {
  g_draw_calls.store(0, std::memory_order_relaxed);
  for (int i = 0; i < DC_MAX; i++) g_dc[i].store(0, std::memory_order_relaxed);
}

// Per-binding readout. Slots are claimed lazily, so a binding that has never
// run has no name; the caller stops at vec_draw_kinds().
int vec_draw_kinds() {
  int n = g_dc_n.load(std::memory_order_relaxed);
  return n > DC_MAX ? DC_MAX : n;
}
const char* vec_draw_name(int i) {
  return (i >= 0 && i < DC_MAX && g_dc_name[i]) ? g_dc_name[i] : "";
}
unsigned long long vec_draw_count(int i) {
  return (i >= 0 && i < DC_MAX) ? g_dc[i].load(std::memory_order_relaxed) : 0;
}

// Enable render-skip (see VecHost.render_skip). Requires autoreset; the
// Python wrapper enforces that invariant.
void vec_set_render_skip(void* h, int on) {
  VecHost* H = (VecHost*)h;
  H->render_skip = on ? 1 : 0;
}

// Configure the autoreset seeding policy (see VecHost.seed_mode):
//   mode 0: legacy formula (default)
//   mode 1: every autoreset uses seed = (uint32)seed_arg
//   mode 2: uniform sample from pool[count]; per-env splitmix64 streams
//           derived from seed_arg + env index (deterministic, envs decorrelated)
void vec_set_autoreset_seeds(void* h, int mode, const int32_t* pool, int count,
                             uint64_t seed_arg) {
  VecHost* H = (VecHost*)h;
  if (mode == 2 && (!pool || count <= 0)) {
    fprintf(stderr, "qjs_vec: seed mode 2 needs a non-empty pool\n");
    return;
  }
  H->seed_mode = mode;
  if (mode == 1) H->fixed_seed = (uint32_t)seed_arg;
  if (mode == 2) {
    H->seed_pool.assign(pool, pool + count);
    H->rng.resize(H->num_envs);
    for (int i = 0; i < H->num_envs; i++)
      H->rng[i] = seed_arg * 0x9E3779B97F4A7C15ULL
                + (uint64_t)(i + 1) * 0xBF58476D1CE4E5B9ULL;
  }
}

void vec_close(void* h) {
  if (!h) return;
  VecHost* H = (VecHost*)h;
  H->stop.store(true, std::memory_order_release);
  // async workers spin on inq + check stop; sync workers spin on go — bump it.
  if (!H->async) H->go.fetch_add(1, std::memory_order_release);
  else H->send_gen.fetch_add(1, std::memory_order_release);
  { std::lock_guard<std::mutex> lk(H->park_mu); }
  H->park_cv.notify_all();
  for (auto& th : H->pool) if (th.joinable()) th.join();
  // Free each env on ITS owning thread would be cleanest, but envs are only touched
  // after all workers have stopped; free from the caller thread (select first so the
  // rasterizer/p5 frees target the right state).
  for (auto& e : H->envs) {
    if (e.ctx) {
      e.select();
      JS_FreeValue(e.ctx, e.jsReset); JS_FreeValue(e.ctx, e.jsDraw);
      JS_FreeValue(e.ctx, e.jsState); JS_FreeValue(e.ctx, e.jsKeyPressed);
      JS_FreeValue(e.ctx, e.jsMousePressed);
      JS_FreeValue(e.ctx, e.g);
      JS_FreeContext(e.ctx); JS_FreeRuntime(e.rt);
    }
    if (e.p5state) p5::freeState(e.p5state);
    if (e.rstate) rs_state_free(e.rstate);
    p5cb::destroy(e.cb);
  }
  delete H;
}

// ---- async (envpool send/recv) ----------------------------------------------

// Shared async-host constructor: `srcs` already holds one game source per env
// (all equal for single-game). Envs are initialized on the caller thread (safe:
// async stepping is non-pinned and never concurrent per env); T worker threads
// then park on the input queue. Register output buffers via vec_async_setup.
static void* make_async(std::vector<std::string>&& srcs, int num_envs, int obs_size,
                        int max_steps, int num_threads, int autoreset) {
  VecHost* H = new VecHost();
  H->async = true;
  H->srcs = std::move(srcs);
  H->num_envs = num_envs;
  H->obs_size = obs_size;
  H->obs_bytes = obs_size * obs_size * 3;
  H->max_steps = max_steps > 0 ? max_steps : 2000;
  H->autoreset = autoreset;
  int T = num_threads > 0 ? num_threads : default_threads();
  if (T > num_envs) T = num_envs;
  if (T < 1) T = 1;
  H->nthreads = T;
  H->envs.resize(num_envs);
  H->act.assign(num_envs, 0);
  size_t cap = next_pow2((size_t)num_envs + 1);  // in-flight ids never exceed num_envs
  H->inq.reset(new MPMC[T]);
  for (int t = 0; t < T; t++) H->inq[t].init(cap);
  H->readyq.init(cap);

  // Each worker inits ITS envs (owner thread = the thread that will step them,
  // so their heaps live in that thread's malloc arena); wait for all of them.
  H->async_init_left.store(T, std::memory_order_release);
  for (int t = 0; t < T; t++) H->pool.emplace_back(worker_async, H, t);
  while (H->async_init_left.load(std::memory_order_acquire) > 0) cpu_relax();
  bool failed = false;
  for (int i = 0; i < num_envs; i++)
    if (!H->envs[i].ok) {
      g_last_error = H->envs[i].err;
      fprintf(stderr, "qjs_vec: env init failed: %s\n", H->envs[i].err.c_str());
      failed = true;
    }
  if (failed) { vec_close(H); return nullptr; }
  g_last_error.clear();
  return H;
}

// Single-game async host.
void* vec_create_async(const char* game_path, int num_envs, int obs_size,
                       int max_steps, int num_threads, int autoreset) {
  std::string src;
  if (!read_file(game_path, src)) return nullptr;
  return make_async(std::vector<std::string>(num_envs, src), num_envs, obs_size,
                    max_steps, num_threads, autoreset);
}

// Heterogeneous async host: one game per env (a mixed pool). This is where async
// earns its keep — in sync mode every step waits for the slowest env's game, so
// aggregate is capped by the slowest; async lets each env cycle at its own rate.
void* vec_create_async_multi(const char** game_paths, int num_envs, int obs_size,
                             int max_steps, int num_threads, int autoreset) {
  std::vector<std::string> srcs(num_envs);
  for (int i = 0; i < num_envs; i++)
    if (!read_file(game_paths[i], srcs[i])) return nullptr;
  return make_async(std::move(srcs), num_envs, obs_size, max_steps, num_threads, autoreset);
}

// Register the persistent obs/rew/term/trunc buffers async workers write into.
void vec_async_setup(void* h, uint8_t* obs, float* rew, uint8_t* term, uint8_t* trunc) {
  VecHost* H = (VecHost*)h;
  H->out_obs = obs; H->out_rew = rew; H->out_term = term; H->out_trunc = trunc;
}

// Reset all envs, each on its owning worker (see VecHost::inq); blocks until
// every reset has run. Must not overlap in-flight steps (call before sends).
void vec_async_reset(void* h, const int32_t* seeds) {
  VecHost* H = (VecHost*)h;
  H->reset_seeds.assign(seeds, seeds + H->num_envs);
  H->async_resets_left.store(H->num_envs, std::memory_order_release);
  for (int i = 0; i < H->num_envs; i++)
    while (!H->inq[i % H->nthreads].push(~i)) cpu_relax();
  H->send_gen.fetch_add(1, std::memory_order_release);
  wake_parked(H);
  while (H->async_resets_left.load(std::memory_order_acquire) > 0) cpu_relax();
}

// Submit `count` (env_id, action) pairs to be stepped, in any order/subset.
void vec_send(void* h, const int32_t* env_ids, const int32_t* actions, int count) {
  VecHost* H = (VecHost*)h;
  for (int k = 0; k < count; k++) {
    int id = env_ids[k];
    H->act[id] = actions[k];
    if (H->group_mode) H->busy[id].store(1, std::memory_order_relaxed);
    while (!H->inq[id % H->nthreads].push(id)) cpu_relax();
  }
  H->send_gen.fetch_add(1, std::memory_order_release);
  wake_parked(H);
}

// Enable group (ping-pong) mode: vec_recv must NOT be used afterwards; wait
// for sent envs with vec_wait_ids. Call once after create, before any send.
void vec_set_group_mode(void* h) {
  VecHost* H = (VecHost*)h;
  H->group_mode = true;
  H->busy.reset(new std::atomic<uint8_t>[H->num_envs]);
  for (int i = 0; i < H->num_envs; i++) H->busy[i].store(0);
}

// Block until every listed env has finished its in-flight step. Outputs for
// those envs are then complete in the registered buffers.
void vec_wait_ids(void* h, const int32_t* env_ids, int count) {
  VecHost* H = (VecHost*)h;
  for (int k = 0; k < count; k++) {
    while (H->busy[env_ids[k]].load(std::memory_order_acquire)) cpu_relax();
  }
}

// Block until `batch_size` envs have finished; write their ids into out_env_ids
// (obs/rew/term/trunc are already in the registered buffers, indexed by id).
int vec_recv(void* h, int batch_size, int32_t* out_env_ids) {
  VecHost* H = (VecHost*)h;
  for (int k = 0; k < batch_size; k++) {
    int v;
    while (!H->readyq.pop(v)) cpu_relax();
    out_env_ids[k] = v;
  }
  return batch_size;
}

}  // extern "C"
#if defined(__GNUC__)
#pragma GCC visibility pop
#endif
