// qjs_host.cpp — run a game's JavaScript UNCHANGED on embedded QuickJS, with the
// p5 API bound to native C functions that call the SAME rasterizer + p5 state as
// the transpiled path (runtime/p5.cpp). No transpiler: 100% JS coverage, native
// rasterizer, native one-pass readback. Tests whether an interpreter + direct
// native rasterizer bindings reaches near-native speed (logic is ~free).
//
//   qjs_host <game.js> trace <seed> <nsteps>
//   qjs_host <game.js> bench <ignored> <nsteps>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <vector>
#include <string>
#include <chrono>
#include "quickjs.h"
#include "../jit/qjit.h"
#include "../runtime/p5.hpp"

static const int OBS = 64;

// ---- arg helpers ----
static inline double argd(JSContext* ctx, JSValueConst v) { double d = 0; JS_ToFloat64(ctx, &d, v); return d; }

// color(...) returns a JS array [r,g,b,a] (pre-rounded); fill/stroke/background
// accept either numeric args or such an array.
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

static bool g_nodraw = false;  // measurement: draw bindings return immediately (JS+call cost only)
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

// Bit-exact Math overrides: QuickJS's built-in transcendentals differ from V8 by
// ULPs (breaks bit-exactness over time). Route to the SAME js:: math the
// transpiled native path uses, which gated bit-exact vs V8.
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
  {"textSize", js_noop, 1}, {"textAlign", js_noop, 2}, {"text", js_noop, 3},
  {"textFont", js_noop, 1}, {"noSmooth", js_noop, 0}, {"tint", js_noop, 4},
  {"noLoop", js_noop, 0}, {"loop", js_noop, 0}, {"noCursor", js_noop, 0}, {"cursor", js_noop, 0},
  {"frameRate", js_noop, 1}, {"smooth", js_noop, 0},
  {"__m_pow", js_m_pow, 2}, {"__m_sqrt", js_m_sqrt, 1}, {"__m_sin", js_m_sin, 1},
  {"__m_cos", js_m_cos, 1}, {"__m_atan2", js_m_atan2, 2}, {"__m_hypot", js_m_hypot, 2},
};

static void setConst(JSContext* ctx, JSValue g, const char* k, double v) { JS_SetPropertyStr(ctx, g, k, JS_NewFloat64(ctx, v)); }

// p5 helper + constant prelude (JS). Math helpers p5 exposes as globals; RNG.
static const char* PRELUDE = R"JS(
globalThis.dist=(x1,y1,x2,y2)=>Math.sqrt((x2-x1)**2+(y2-y1)**2);
globalThis.constrain=(v,lo,hi)=>Math.min(Math.max(v,lo),hi);
globalThis.lerp=(a,b,t)=>a+(b-a)*t;
globalThis.map=(v,s1,e1,s2,e2)=>s2+(e2-s2)*((v-s1)/(e1-s1));
globalThis.__mb=function(s){let t=s>>>0;return function(){t+=0x6D2B79F5;let n=Math.imul(t^(t>>>15),t|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296}};
globalThis.millis=()=>frameCount*(1000/60);
Math.pow=__m_pow; Math.sqrt=__m_sqrt; Math.sin=__m_sin; Math.cos=__m_cos; Math.atan2=__m_atan2; Math.hypot=__m_hypot;
)JS";

int main(int argc, char** argv) {
  const char* gamePath = argc > 1 ? argv[1] : nullptr;
  const char* mode = argc > 2 ? argv[2] : "trace";
  uint32_t seed = argc > 3 ? (uint32_t)strtoul(argv[3], nullptr, 10) : 12345u;
  long nsteps = argc > 4 ? atol(argv[4]) : 300;
  if (!gamePath) { fprintf(stderr, "usage: qjs_host <game.js> trace|bench <seed> <n>\n"); return 1; }

  // read game source
  FILE* f = fopen(gamePath, "rb"); if (!f) { fprintf(stderr, "cannot open %s\n", gamePath); return 1; }
  fseek(f, 0, SEEK_END); long sz = ftell(f); fseek(f, 0, SEEK_SET);
  std::string src(sz, 0); if (fread(&src[0], 1, sz, f) != (size_t)sz) { return 1; } fclose(f);

  JSRuntime* rt = JS_NewRuntime();
  JSContext* ctx = JS_NewContext(rt);
  JSValue g = JS_GetGlobalObject(ctx);
  for (const auto& b : BINDINGS) JS_SetPropertyStr(ctx, g, b.name, JS_NewCFunction(ctx, b.fn, b.name, b.nargs));
  setConst(ctx, g, "LEFT_ARROW", 37); setConst(ctx, g, "UP_ARROW", 38);
  setConst(ctx, g, "RIGHT_ARROW", 39); setConst(ctx, g, "DOWN_ARROW", 40); setConst(ctx, g, "ENTER", 13);
  setConst(ctx, g, "CENTER", p5::CENTER); setConst(ctx, g, "CORNER", p5::CORNER);
  setConst(ctx, g, "LEFT", p5::LEFT); setConst(ctx, g, "CLOSE", p5::CLOSE);
  setConst(ctx, g, "PI", p5::PI); setConst(ctx, g, "TWO_PI", p5::TWO_PI); setConst(ctx, g, "HALF_PI", p5::HALF_PI);
  setConst(ctx, g, "frameCount", 0);

  auto evalv = [&](const char* code, const char* fn) {
    JSValue r = JS_Eval(ctx, code, strlen(code), fn, JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) { JSValue e = JS_GetException(ctx); const char* s = JS_ToCString(ctx, e); fprintf(stderr, "JS error: %s\n", s ? s : "?"); JS_FreeCString(ctx, s); JS_FreeValue(ctx, e); }
    JS_FreeValue(ctx, r);
  };
  evalv(PRELUDE, "<prelude>");
  p5::setRasterRes(OBS);
  evalv(src.c_str(), gamePath);

  JSValue jsSetup = JS_GetPropertyStr(ctx, g, "setup");
  JSValue jsReset = JS_GetPropertyStr(ctx, g, "resetGame");
  JSValue jsDraw = JS_GetPropertyStr(ctx, g, "draw");
  JSValue jsState = JS_GetPropertyStr(ctx, g, "getGameState");

  int frameCount = 0;
  auto setFrame = [&](int fc) { JS_SetPropertyStr(ctx, g, "frameCount", JS_NewInt32(ctx, fc)); };
  auto call0 = [&](JSValue fn) { JSValue r = JS_Call(ctx, fn, JS_UNDEFINED, 0, nullptr); if (JS_IsException(r)) { JSValue e = JS_GetException(ctx); const char* s = JS_ToCString(ctx, e); fprintf(stderr, "call err: %s\n", s?s:"?"); JS_FreeCString(ctx, s); JS_FreeValue(ctx, e);} JS_FreeValue(ctx, r); };
  auto resetGame = [&](uint32_t s) {
    // env sets Math.random = mulberry32(seed) each reset; bigfish uses its own rng.
    char buf[64]; snprintf(buf, sizeof buf, "Math.random=__mb(%u)", s); evalv(buf, "<seed>");
    JSValue a = JS_NewInt32(ctx, (int)s); JSValue r = JS_Call(ctx, jsReset, JS_UNDEFINED, 1, &a);
    JS_FreeValue(ctx, r); JS_FreeValue(ctx, a);
  };
  // init (mirror env.init / game-env loadGame)
  call0(jsSetup);
  if (getenv("QJS_DIRTY")) p5::setDirty(true);   // opt-in dirty-rect whole-frame skip
  if (getenv("QJS_NODRAW")) g_nodraw = true;     // measurement: skip draw-binding bodies
  resetGame(0); setFrame(++frameCount); p5::frameBegin(); call0(jsDraw); p5::frameEnd();

  std::vector<uint8_t> obs((size_t)OBS * OBS * 3);
  auto obshash = [&]() -> uint64_t { p5::render_obs_rgb(obs.data()); uint64_t h = 1469598103934665603ULL; for (uint8_t b : obs) { h ^= b; h *= 1099511628211ULL; } return h; };
  auto action_at = [](long i) { return (int)((i * 3 + 1) % 8); };
  static const int HELD[8][2] = {{-1,-1},{37,-1},{39,-1},{38,-1},{40,-1},{-1,32},{37,32},{39,32}};

  auto stepEnv = [&](int a, double& score, double& lives, bool& term, const char*& name) {
    int codes[2], n = 0; for (int i = 0; i < 2; i++) if (HELD[a][i] >= 0) codes[n++] = HELD[a][i];
    p5::setKeysDown(codes, n);
    setFrame(++frameCount); p5::frameBegin(); call0(jsDraw); p5::frameEnd();
    // read state
    JSValue st = JS_Call(ctx, jsState, JS_UNDEFINED, 0, nullptr);
    JSValue sc = JS_GetPropertyStr(ctx, st, "score"); JS_ToFloat64(ctx, &score, sc); JS_FreeValue(ctx, sc);
    JSValue lv = JS_GetPropertyStr(ctx, st, "lives"); JS_ToFloat64(ctx, &lives, lv); JS_FreeValue(ctx, lv);
    JSValue gs = JS_GetPropertyStr(ctx, st, "gameState"); const char* s = JS_ToCString(ctx, gs);
    static char last[32]; last[0]=0; if (s) { strncpy(last, s, 31); last[31]=0; }
    term = last[0] && (!strcmp(last,"WIN")||!strcmp(last,"EXIT")||!strcmp(last,"GAMEOVER"));
    name = last; JS_FreeCString(ctx, s); JS_FreeValue(ctx, gs); JS_FreeValue(ctx, st);
  };

  auto gsIdx = [](const char* s) -> uint8_t {
    if (!strcmp(s, "PLAYING")) return 0; if (!strcmp(s, "WIN")) return 1;
    if (!strcmp(s, "GAMEOVER")) return 2; if (!strcmp(s, "EXIT")) return 3; return 4;
  };

  if (!strcmp(mode, "dirtycheck")) {
    // Differential test: run the SAME game+seed with dirty-rect OFF (baseline direct render)
    // and ON (record/replay/skip), hashing obs every frame; any mismatch = silent corruption
    // caught loudly. This is the safety net for the whole-frame-skip optimization.
    auto runN = [&](bool dirty, std::vector<uint64_t>& out) {
      p5::setDirty(dirty);
      p5::setKeysDown(nullptr, 0); frameCount = 0; setFrame(0);
      resetGame(seed); setFrame(++frameCount); p5::frameBegin(); call0(jsDraw); p5::frameEnd();
      out.clear();
      double sc, lv; bool term; const char* nm;
      for (long i = 0; i < nsteps; i++) {
        stepEnv(action_at(i), sc, lv, term, nm);
        out.push_back(obshash());
        if (term) { resetGame(seed + (uint32_t)i + 1); setFrame(++frameCount); p5::frameBegin(); call0(jsDraw); p5::frameEnd(); }
      }
    };
    std::vector<uint64_t> ha, hb;
    runN(false, ha);   // baseline: direct render
    runN(true,  hb);   // dirty-rect: record/replay/skip
    long mism = 0, first = -1;
    for (size_t i = 0; i < ha.size() && i < hb.size(); i++)
      if (ha[i] != hb[i]) { mism++; if (first < 0) first = (long)i; }
    printf("%-40s dirtycheck %ld frames: %ld mismatches%s -> %s\n",
           gamePath, (long)ha.size(), mism,
           first >= 0 ? (std::string(" (first @frame ") + std::to_string(first) + ")").c_str() : "",
           mism == 0 ? "BIT-EXACT" : "CORRUPT");
    return mism == 0 ? 0 : 1;
  }
  if (!strcmp(mode, "framediff")) {
    // Measure the dirty-rect ceiling: what fraction of obs pixels change frame-to-frame?
    const size_t N = (size_t)OBS * OBS * 3;
    std::vector<uint8_t> prev(N), cur(N);
    p5::setKeysDown(nullptr, 0); frameCount = 0; setFrame(0);
    resetGame(seed); setFrame(++frameCount); call0(jsDraw);
    p5::render_obs_rgb(prev.data());
    double sumFrac = 0; long cnt = 0, identical = 0;
    double sc, lv; bool term; const char* nm;
    for (long i = 0; i < nsteps; i++) {
      stepEnv(action_at(i), sc, lv, term, nm);
      p5::render_obs_rgb(cur.data());
      size_t changed = 0; for (size_t k = 0; k < N; k++) if (cur[k] != prev[k]) changed++;
      sumFrac += (double)changed / N; cnt++;
      if (changed == 0) identical++;
      prev.swap(cur);
      if (term) { resetGame(seed + (uint32_t)i + 1); setFrame(++frameCount); call0(jsDraw); p5::render_obs_rgb(prev.data()); }
    }
    printf("%-40s avg pixel-change/frame = %5.1f%%   identical-frames = %ld/%ld\n",
           gamePath, cnt ? 100.0 * sumFrac / cnt : 0.0, identical, cnt);
    return 0;
  }
  if (!strcmp(mode, "serve")) {
    // Binary request/response protocol for the Python env (qjs_env.py).
    //  request  (5 bytes): [cmd:u8][arg:i32le]   cmd 0=reset(arg=seed) 1=step(arg=action) 2=close
    //  response: [reward:f64][term:u8][trunc:u8][gs:u8][score:f64][lives:f64] + obs(OBS*OBS*3)
    const int maxSteps = 2000;
    long steps = 0; double lastScore = 0;
    const size_t OBSN = (size_t)OBS * OBS * 3;
    std::vector<uint8_t> resp(27 + OBSN);
    freopen(nullptr, "rb", stdin); freopen(nullptr, "wb", stdout);
    unsigned char req[5];
    while (fread(req, 1, 5, stdin) == 5) {
      uint8_t cmd = req[0];
      int32_t arg; memcpy(&arg, req + 1, 4);
      if (cmd == 2) break;  // close
      double reward = 0, score = 0, lives = 0; uint8_t term = 0, trunc = 0; const char* name = "PLAYING";
      if (cmd == 0) {  // reset
        p5::setKeysDown(nullptr, 0); frameCount = 0; setFrame(0);
        resetGame((uint32_t)arg); setFrame(++frameCount); call0(jsDraw);
        JSValue st = JS_Call(ctx, jsState, JS_UNDEFINED, 0, nullptr);
        JSValue sc = JS_GetPropertyStr(ctx, st, "score"); JS_ToFloat64(ctx, &score, sc); JS_FreeValue(ctx, sc);
        JSValue lv = JS_GetPropertyStr(ctx, st, "lives"); JS_ToFloat64(ctx, &lives, lv); JS_FreeValue(ctx, lv);
        JSValue gs = JS_GetPropertyStr(ctx, st, "gameState"); const char* s = JS_ToCString(ctx, gs);
        static char last[32]; last[0]=0; if (s) { strncpy(last, s, 31); last[31]=0; } name = last;
        JS_FreeCString(ctx, s); JS_FreeValue(ctx, gs); JS_FreeValue(ctx, st);
        steps = 0; lastScore = score;
      } else {  // step
        bool t; stepEnv(arg, score, lives, t, name); steps++;
        term = t ? 1 : 0; trunc = (!t && steps >= maxSteps) ? 1 : 0;
        reward = score - lastScore; lastScore = score;
      }
      double* d = (double*)resp.data();
      d[0] = reward;
      resp[8] = term; resp[9] = trunc; resp[10] = gsIdx(name);
      memcpy(resp.data() + 11, &score, 8); memcpy(resp.data() + 19, &lives, 8);
      p5::render_obs_rgb(resp.data() + 27);
      fwrite(resp.data(), 1, resp.size(), stdout); fflush(stdout);
    }
    JS_FreeValue(ctx, jsSetup); JS_FreeValue(ctx, jsReset); JS_FreeValue(ctx, jsDraw); JS_FreeValue(ctx, jsState);
    JS_FreeValue(ctx, g); JS_FreeContext(ctx); JS_FreeRuntime(rt);
    return 0;
  }

  if (!strcmp(mode, "trace")) {
    // reset(seed)
    p5::setKeysDown(nullptr, 0); frameCount = 0; setFrame(0);
    resetGame(seed); setFrame(++frameCount); call0(jsDraw);
    double score, lives; { JSValue st = JS_Call(ctx, jsState, JS_UNDEFINED, 0, nullptr);
      JSValue sc = JS_GetPropertyStr(ctx, st, "score"); JS_ToFloat64(ctx,&score,sc); JS_FreeValue(ctx,sc);
      JSValue lv = JS_GetPropertyStr(ctx, st, "lives"); JS_ToFloat64(ctx,&lives,lv); JS_FreeValue(ctx,lv);
      JSValue gs = JS_GetPropertyStr(ctx, st, "gameState"); const char* s=JS_ToCString(ctx,gs);
      printf("reset seed=%u score=%g lives=%g state=%s obshash=%llu\n", seed, score, lives, s?s:"?", (unsigned long long)obshash());
      JS_FreeCString(ctx,s); JS_FreeValue(ctx,gs); JS_FreeValue(ctx,st); }
    double lastScore = score;
    for (long i = 0; i < nsteps; i++) {
      int a = action_at(i); bool term; const char* name;
      stepEnv(a, score, lives, term, name);
      bool trunc = false;
      printf("%ld a=%d reward=%g term=%d trunc=%d score=%g lives=%g state=%s obshash=%llu\n",
             i, a, score - lastScore, term ? 1 : 0, trunc ? 1 : 0, score, lives, name, (unsigned long long)obshash());
      lastScore = score;
      if (term) { frameCount = 0; setFrame(0); resetGame(seed + (uint32_t)i + 1); setFrame(++frameCount); call0(jsDraw);
        JSValue st = JS_Call(ctx, jsState, JS_UNDEFINED, 0, nullptr); JSValue sc = JS_GetPropertyStr(ctx, st, "score"); JS_ToFloat64(ctx,&lastScore,sc); JS_FreeValue(ctx,sc); JS_FreeValue(ctx,st); }
    }
  } else {  // bench
    p5::setKeysDown(nullptr, 0); frameCount = 0; setFrame(0);
    resetGame(1); setFrame(++frameCount); call0(jsDraw);
    auto t0 = std::chrono::steady_clock::now();
    uint32_t rs = 2;
    for (long i = 0; i < nsteps; i++) {
      double score, lives; bool term; const char* name;
      stepEnv(action_at(i), score, lives, term, name);
      p5::render_obs_rgb(obs.data());  // include readback in the frame cost
      if (term) { frameCount = 0; setFrame(0); resetGame(rs++); setFrame(++frameCount); call0(jsDraw); }
    }
    auto t1 = std::chrono::steady_clock::now();
    double secs = std::chrono::duration<double>(t1 - t0).count();
    printf("bench(qjs): %ld steps in %.4fs = %.0f steps/sec\n", nsteps, secs, nsteps / secs);
    if (getenv("QJIT_REPORT")) qjit_report(ctx);
  }

  JS_FreeValue(ctx, jsSetup); JS_FreeValue(ctx, jsReset); JS_FreeValue(ctx, jsDraw); JS_FreeValue(ctx, jsState);
  JS_FreeValue(ctx, g);
  JS_FreeContext(ctx); JS_FreeRuntime(rt);
  return 0;
}
