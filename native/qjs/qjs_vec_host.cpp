// qjs_vec_host.cpp — the envpool-class vectorized backend for node-gym.
//
// One process, N QuickJS+rasterizer envs, a fixed thread pool. Each env owns its
// own JSContext + rasterizer state + p5 shim state (all made per-env selectable in
// crates/rasterizer/src/lib.rs and native/runtime/p5.cpp) and is PINNED to one
// worker thread, so no two threads ever touch the same interpreter or rasterizer
// state. A batched `vec_step(actions) -> (obs, rew, term, trunc)` steps every env
// in parallel across the pool; the Python side (python/node_gym/native_vec_env.py)
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
#include <thread>
#include <atomic>
#if defined(__APPLE__)
#include <sys/sysctl.h>
#endif
#include "quickjs.h"
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

static bool g_nodraw = false;
#define FN(name) static JSValue name(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
#define NODRAW if (g_nodraw) return JS_UNDEFINED;

FN(js_createCanvas) {
  p5::createCanvas(argd(ctx, argv[0]), argd(ctx, argv[1]));
  JSValue g = JS_GetGlobalObject(ctx);
  JS_SetPropertyStr(ctx, g, "width", JS_NewInt32(ctx, p5::width()));
  JS_SetPropertyStr(ctx, g, "height", JS_NewInt32(ctx, p5::height()));
  JS_FreeValue(ctx, g);
  return JS_UNDEFINED;
}
FN(js_background) { NODRAW p5::background(colorFromArgs(ctx, argc, argv)); return JS_UNDEFINED; }
FN(js_fill)   { NODRAW p5::fill(colorFromArgs(ctx, argc, argv)); return JS_UNDEFINED; }
FN(js_stroke) { NODRAW p5::stroke(colorFromArgs(ctx, argc, argv)); return JS_UNDEFINED; }
FN(js_color)  { p5::Color c = colorFromArgs(ctx, argc, argv);
  JSValue a = JS_NewArray(ctx);
  JS_SetPropertyUint32(ctx, a, 0, JS_NewFloat64(ctx, c.r)); JS_SetPropertyUint32(ctx, a, 1, JS_NewFloat64(ctx, c.g));
  JS_SetPropertyUint32(ctx, a, 2, JS_NewFloat64(ctx, c.b)); JS_SetPropertyUint32(ctx, a, 3, JS_NewFloat64(ctx, c.a));
  return a; }
FN(js_noStroke) { p5::noStroke(); return JS_UNDEFINED; }
FN(js_noFill) { p5::noFill(); return JS_UNDEFINED; }
FN(js_strokeWeight) { p5::strokeWeight(argd(ctx, argv[0])); return JS_UNDEFINED; }
FN(js_rect) { NODRAW if (argc >= 5) p5::rect(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2]),argd(ctx,argv[3]),argd(ctx,argv[4]));
  else p5::rect(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2]),argd(ctx,argv[3])); return JS_UNDEFINED; }
FN(js_ellipse) { NODRAW if (argc >= 4) p5::ellipse(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2]),argd(ctx,argv[3]));
  else p5::ellipse(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2])); return JS_UNDEFINED; }
FN(js_circle) { NODRAW p5::circle(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2])); return JS_UNDEFINED; }
FN(js_triangle) { NODRAW p5::triangle(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2]),argd(ctx,argv[3]),argd(ctx,argv[4]),argd(ctx,argv[5])); return JS_UNDEFINED; }
FN(js_quad) { NODRAW p5::quad(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2]),argd(ctx,argv[3]),argd(ctx,argv[4]),argd(ctx,argv[5]),argd(ctx,argv[6]),argd(ctx,argv[7])); return JS_UNDEFINED; }
FN(js_line) { NODRAW p5::line(argd(ctx,argv[0]),argd(ctx,argv[1]),argd(ctx,argv[2]),argd(ctx,argv[3])); return JS_UNDEFINED; }
FN(js_rectMode) { p5::rectMode((int)argd(ctx, argv[0])); return JS_UNDEFINED; }
FN(js_ellipseMode) { p5::ellipseMode((int)argd(ctx, argv[0])); return JS_UNDEFINED; }
FN(js_push) { p5::push(); return JS_UNDEFINED; }
FN(js_pop) { p5::pop(); return JS_UNDEFINED; }
FN(js_translate) { p5::translate(argd(ctx,argv[0]),argd(ctx,argv[1])); return JS_UNDEFINED; }
FN(js_rotate) { p5::rotate(argd(ctx,argv[0])); return JS_UNDEFINED; }
FN(js_scale) { if (argc >= 2) p5::scale(argd(ctx,argv[0]),argd(ctx,argv[1])); else p5::scale(argd(ctx,argv[0])); return JS_UNDEFINED; }
FN(js_beginShape) { NODRAW p5::beginShape(); return JS_UNDEFINED; }
FN(js_vertex) { NODRAW p5::vertex(argd(ctx,argv[0]),argd(ctx,argv[1])); return JS_UNDEFINED; }
FN(js_endShape) { NODRAW if (argc >= 1) p5::endShape((int)argd(ctx, argv[0])); else p5::endShape(); return JS_UNDEFINED; }
FN(js_keyIsDown) { return JS_NewBool(ctx, p5::keyIsDown((int)argd(ctx, argv[0]))); }
FN(js_noop) { (void)ctx; (void)argc; (void)argv; return JS_UNDEFINED; }
FN(js_createGraphics) { return JS_NewInt32(ctx, p5::createGraphics(argd(ctx, argv[0]), argd(ctx, argv[1]))); }
FN(js_setTarget) { p5::setTarget((int)argd(ctx, argv[0])); return JS_UNDEFINED; }
FN(js_clearTarget) { p5::clearTarget(); return JS_UNDEFINED; }
FN(js_image) { NODRAW p5::image((int)argd(ctx, argv[0]), argd(ctx, argv[1]), argd(ctx, argv[2]), argd(ctx, argv[3]), argd(ctx, argv[4])); return JS_UNDEFINED; }

FN(js_m_pow)   { return JS_NewFloat64(ctx, js::pow(argd(ctx, argv[0]), argd(ctx, argv[1]))); }
FN(js_m_sqrt)  { return JS_NewFloat64(ctx, js::sqrt(argd(ctx, argv[0]))); }
FN(js_m_sin)   { return JS_NewFloat64(ctx, js::sin(argd(ctx, argv[0]))); }
FN(js_m_cos)   { return JS_NewFloat64(ctx, js::cos(argd(ctx, argv[0]))); }
FN(js_m_atan2) { return JS_NewFloat64(ctx, js::atan2(argd(ctx, argv[0]), argd(ctx, argv[1]))); }
FN(js_m_hypot) { return JS_NewFloat64(ctx, js::hypot(argd(ctx, argv[0]), argd(ctx, argv[1]))); }

struct Binding { const char* name; JSCFunction* fn; int nargs; };
static const Binding BINDINGS[] = {
  {"createCanvas", js_createCanvas, 2}, {"background", js_background, 1},
  {"fill", js_fill, 4}, {"stroke", js_stroke, 4}, {"color", js_color, 4},
  {"noStroke", js_noStroke, 0}, {"noFill", js_noFill, 0}, {"strokeWeight", js_strokeWeight, 1},
  {"rect", js_rect, 5}, {"ellipse", js_ellipse, 4}, {"circle", js_circle, 3},
  {"triangle", js_triangle, 6}, {"quad", js_quad, 8}, {"line", js_line, 4},
  {"rectMode", js_rectMode, 1}, {"ellipseMode", js_ellipseMode, 1},
  {"push", js_push, 0}, {"pop", js_pop, 0}, {"translate", js_translate, 2},
  {"rotate", js_rotate, 1}, {"scale", js_scale, 2},
  {"beginShape", js_beginShape, 0}, {"vertex", js_vertex, 2}, {"endShape", js_endShape, 1},
  {"keyIsDown", js_keyIsDown, 1},
  {"createGraphics", js_createGraphics, 2}, {"setTarget", js_setTarget, 1},
  {"clearTarget", js_clearTarget, 0}, {"image", js_image, 5},
  {"textSize", js_noop, 1}, {"textAlign", js_noop, 2}, {"text", js_noop, 3},
  {"textFont", js_noop, 1}, {"noSmooth", js_noop, 0}, {"tint", js_noop, 4},
  {"noLoop", js_noop, 0}, {"loop", js_noop, 0}, {"noCursor", js_noop, 0}, {"cursor", js_noop, 0},
  {"frameRate", js_noop, 1}, {"smooth", js_noop, 0},
  {"__m_pow", js_m_pow, 2}, {"__m_sqrt", js_m_sqrt, 1}, {"__m_sin", js_m_sin, 1},
  {"__m_cos", js_m_cos, 1}, {"__m_atan2", js_m_atan2, 2}, {"__m_hypot", js_m_hypot, 2},
};

static void setConst(JSContext* ctx, JSValue g, const char* k, double v) { JS_SetPropertyStr(ctx, g, k, JS_NewFloat64(ctx, v)); }

static const char* PRELUDE = R"JS(
globalThis.dist=(x1,y1,x2,y2)=>Math.sqrt((x2-x1)**2+(y2-y1)**2);
globalThis.constrain=(v,lo,hi)=>Math.min(Math.max(v,lo),hi);
globalThis.lerp=(a,b,t)=>a+(b-a)*t;
globalThis.map=(v,s1,e1,s2,e2)=>s2+(e2-s2)*((v-s1)/(e1-s1));
globalThis.__mb=function(s){let t=s>>>0;return function(){t+=0x6D2B79F5;let n=Math.imul(t^(t>>>15),t|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296}};
globalThis.millis=()=>frameCount*(1000/60);
Math.pow=__m_pow; Math.sqrt=__m_sqrt; Math.sin=__m_sin; Math.cos=__m_cos; Math.atan2=__m_atan2; Math.hypot=__m_hypot;
)JS";

// action -> held key codes, identical to qjs_host.cpp
static const int HELD[8][2] = {{-1,-1},{37,-1},{39,-1},{38,-1},{40,-1},{-1,32},{37,32},{39,32}};

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
  int hw = (int)std::thread::hardware_concurrency();
  return hw > 0 ? hw : 1;
}

// ============================ per-env state ===================================

struct Env {
  JSRuntime* rt = nullptr;
  JSContext* ctx = nullptr;
  JSValue g, jsReset, jsDraw, jsState;
  void* rstate = nullptr;   // rasterizer per-env state (rs_state_new)
  void* p5state = nullptr;  // p5 shim per-env state (p5::newState)
  int frameCount = 0;
  long steps = 0;
  double lastScore = 0;
  bool ok = true;
  std::string err;

  inline void select() { rs_state_select(rstate); p5::selectState(p5state); }
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

// Per-worker done flag, each on its own cacheline. A single shared decrement
// counter would bounce one cacheline across all cores every step (an RMW per
// worker), which at 1 env/thread roughly halved throughput. With per-worker
// flags each helper writes only its OWN line and the caller read-polls T lines —
// no cross-core RMW contention.
struct alignas(128) WorkerCtl {
  std::atomic<uint64_t> done{0};
};

struct VecHost {
  std::vector<Env> envs;
  std::string src;
  int num_envs = 0, obs_size = 0, obs_bytes = 0, max_steps = 2000, autoreset = 0;
  int nthreads = 1;
  std::vector<std::thread> pool;      // helper threads (pool[0] is unused; caller does shard 0)
  std::vector<int> shard_start;       // size nthreads+1

  // batch command plumbing (go on its own line; helpers only read it)
  alignas(128) std::atomic<uint64_t> go{0};
  std::vector<WorkerCtl> done;        // per-helper completion generation
  std::atomic<bool> stop{false};
  int cmd = 0;                         // 0 = step, 1 = reset, 2 = init
  const int32_t* in_actions = nullptr;
  const int32_t* in_seeds = nullptr;
  uint8_t* out_obs = nullptr;
  float*   out_rew = nullptr;
  uint8_t* out_term = nullptr;
  uint8_t* out_trunc = nullptr;
};

// ---- build one env's interpreter (called ON its owning worker thread) ----
static void env_init(VecHost* H, Env& e) {
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
  setConst(ctx, g, "LEFT", p5::LEFT); setConst(ctx, g, "CLOSE", p5::CLOSE);
  setConst(ctx, g, "PI", p5::PI); setConst(ctx, g, "TWO_PI", p5::TWO_PI); setConst(ctx, g, "HALF_PI", p5::HALF_PI);
  setConst(ctx, g, "frameCount", 0);
  { JSValue r = JS_Eval(ctx, PRELUDE, strlen(PRELUDE), "<prelude>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) { JSValue ex = JS_GetException(ctx); const char* s = JS_ToCString(ctx, ex); e.err = s?s:"prelude"; e.ok=false; JS_FreeCString(ctx,s); JS_FreeValue(ctx,ex); }
    JS_FreeValue(ctx, r); }
  p5::setRasterRes(H->obs_size);
  { JSValue r = JS_Eval(ctx, H->src.c_str(), H->src.size(), "game.js", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) { JSValue ex = JS_GetException(ctx); const char* s = JS_ToCString(ctx, ex); e.err = s?s:"eval"; e.ok=false; JS_FreeCString(ctx,s); JS_FreeValue(ctx,ex); }
    JS_FreeValue(ctx, r); }
  JSValue jsSetup = JS_GetPropertyStr(ctx, g, "setup");
  e.jsReset = JS_GetPropertyStr(ctx, g, "resetGame");
  e.jsDraw  = JS_GetPropertyStr(ctx, g, "draw");
  e.jsState = JS_GetPropertyStr(ctx, g, "getGameState");
  e.call0(jsSetup);
  JS_FreeValue(ctx, jsSetup);
}

// ---- one env reset (mirrors qjs_host serve cmd 0) ----
static void env_reset(VecHost* H, Env& e, int idx, uint32_t seed) {
  e.select();
  p5::setKeysDown(nullptr, 0);
  e.frameCount = 0; e.setFrame(0);
  e.resetGame(seed);
  e.frameCount = 1; e.setFrame(1);
  e.call0(e.jsDraw);
  double score = 0, lives = 0; uint8_t gs = 0;
  e.readState(score, lives, gs);
  e.steps = 0; e.lastScore = score;
  p5::render_obs_rgb(H->out_obs + (size_t)idx * H->obs_bytes);
}

// ---- one env step (mirrors qjs_host serve cmd 1 / stepEnv) ----
static void env_step(VecHost* H, Env& e, int idx, int action) {
  e.select();
  int codes[2], n = 0;
  for (int i = 0; i < 2; i++) if (HELD[action][i] >= 0) codes[n++] = HELD[action][i];
  p5::setKeysDown(codes, n);
  e.frameCount++; e.setFrame(e.frameCount);
  p5::frameBegin(); e.call0(e.jsDraw); p5::frameEnd();
  double score = 0, lives = 0; uint8_t gs = 0;
  bool term = e.readState(score, lives, gs);
  e.steps++;
  bool trunc = (!term && e.steps >= H->max_steps);
  double reward = score - e.lastScore; e.lastScore = score;
  H->out_rew[idx]   = (float)reward;
  H->out_term[idx]  = term ? 1 : 0;
  H->out_trunc[idx] = trunc ? 1 : 0;
  p5::render_obs_rgb(H->out_obs + (size_t)idx * H->obs_bytes);
  if (H->autoreset && (term || trunc)) {
    // SAME_STEP autoreset: overwrite obs with the reset frame; done flag stays set.
    uint32_t rseed = (uint32_t)(idx * 100003u + (uint32_t)e.steps + 1u);
    env_reset(H, e, idx, rseed);
  }
}

// ---- process one thread's shard for the current batch command ----
static void run_shard(VecHost* H, int t) {
  int lo = H->shard_start[t], hi = H->shard_start[t + 1];
  for (int i = lo; i < hi; i++) {
    Env& e = H->envs[i];
    if (H->cmd == 2)      env_init(H, e);
    else if (H->cmd == 1) env_reset(H, e, i, (uint32_t)H->in_seeds[i]);
    else                  env_step(H, e, i, H->in_actions[i]);
  }
}

static void worker_loop(VecHost* H, int t) {
  uint64_t seen = 0;
  for (;;) {
    uint64_t g;
    while ((g = H->go.load(std::memory_order_acquire)) == seen) {
      if (H->stop.load(std::memory_order_acquire)) return;
      cpu_relax();
    }
    if (H->stop.load(std::memory_order_acquire)) return;
    run_shard(H, t);
    seen = g;
    H->done[t].done.store(g, std::memory_order_release);   // publish completion
  }
}

// Dispatch the current cmd to all shards: caller thread runs shard 0, helper
// threads run shards 1..T-1. Blocks until every helper has published this
// generation (per-worker-flag spin barrier).
static void dispatch(VecHost* H) {
  int T = H->nthreads;
  if (T <= 1) { run_shard(H, 0); return; }
  uint64_t g = H->go.fetch_add(1, std::memory_order_release) + 1;  // release helpers
  run_shard(H, 0);                                                  // caller does shard 0
  for (int t = 1; t < T; t++)
    while (H->done[t].done.load(std::memory_order_acquire) != g) cpu_relax();
}

// ================================ C ABI =======================================
extern "C" {

void* vec_create(const char* game_path, int num_envs, int obs_size,
                 int max_steps, int num_threads, int autoreset) {
  FILE* f = fopen(game_path, "rb");
  if (!f) { fprintf(stderr, "qjs_vec: cannot open %s\n", game_path); return nullptr; }
  fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
  std::string src(sz, 0);
  if (fread(&src[0], 1, sz, f) != (size_t)sz) { fclose(f); return nullptr; }
  fclose(f);

  VecHost* H = new VecHost();
  H->src = std::move(src);
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

  for (auto& e : H->envs) if (!e.ok) { fprintf(stderr, "qjs_vec: env init failed: %s\n", e.err.c_str()); }
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

void vec_close(void* h) {
  if (!h) return;
  VecHost* H = (VecHost*)h;
  H->stop.store(true, std::memory_order_release);
  H->go.fetch_add(1, std::memory_order_release);
  for (int t = 1; t < H->nthreads; t++) if (H->pool[t].joinable()) H->pool[t].join();
  // Free each env on ITS owning thread would be cleanest, but envs are only touched
  // after all workers have stopped; free from the caller thread (select first so the
  // rasterizer/p5 frees target the right state).
  for (auto& e : H->envs) {
    if (e.ctx) {
      e.select();
      JS_FreeValue(e.ctx, e.jsReset); JS_FreeValue(e.ctx, e.jsDraw);
      JS_FreeValue(e.ctx, e.jsState); JS_FreeValue(e.ctx, e.g);
      JS_FreeContext(e.ctx); JS_FreeRuntime(e.rt);
    }
    if (e.p5state) p5::freeState(e.p5state);
    if (e.rstate) rs_state_free(e.rstate);
  }
  delete H;
}

}  // extern "C"
