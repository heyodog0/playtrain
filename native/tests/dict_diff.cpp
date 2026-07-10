// dict_diff.cpp — native side of the js::Object differential test. Mirrors
// dict_diff.mjs op-for-op using js::Object; prints the same order-sensitive
// checksum after each op. Compare with `node dict_diff.mjs`.
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <chrono>
#include "../runtime/jsvalue.h"

// bench: simulate a cavequest-style per-frame dict workload with NESTED boxed
// object values ({role,visualId,cooldown}) — churn a few entries, then a full
// for..in pass reading+mutating cooldown (the real hot path). Reports ns/frame
// so it can be compared against the ~5000 ns/frame rasterizer cost.
static int bench_main(long frames, int steady, double churnP) {
  js::Mulberry32 rng(1);
  js::Object drops;
  // seed steady-state entries
  for (int i = 0; i < steady; i++) {
    auto o = js::newObject();
    o->set("role", js::Value((double)(i % 5)));
    o->set("visualId", js::Value((double)(i % 7)));
    o->set("cooldown", js::Value((double)(10 + i % 20)));
    drops.set(std::to_string(i % 8) + "," + std::to_string(i / 8), js::Value(o));
  }
  volatile double sink = 0;
  auto t0 = std::chrono::steady_clock::now();
  for (long f = 0; f < frames; f++) {
    // churn: occasionally place/remove a drop (real gameplay is intermittent)
    if (rng() < churnP) {
      int a = (int)js::floor(rng() * 8), b = (int)js::floor(rng() * 8);
      std::string k = std::to_string(a) + "," + std::to_string(b);
      auto o = js::newObject();
      o->set("role", js::Value((double)a));
      o->set("visualId", js::Value((double)b));
      o->set("cooldown", js::Value(30.0));
      drops.set(k, js::Value(o));
      if (rng() < 0.5) drops.del(std::to_string((int)js::floor(rng() * 8)) + "," + std::to_string((int)js::floor(rng() * 8)));
    }
    // for..in cooldown decrement pass (the per-frame hot loop)
    for (const std::string& key : drops.keys()) {
      js::Value d = drops.get(key);
      double cd = d.obj->get("cooldown").toNum();
      if (cd > 0) d.obj->set("cooldown", js::Value(cd - 1));
      sink += d.obj->get("visualId").toNum();  // render would read this in order
    }
  }
  auto t1 = std::chrono::steady_clock::now();
  double ns = std::chrono::duration<double, std::nano>(t1 - t0).count() / frames;
  printf("dict-bench: %ld frames, steady=%d entries, %.1f ns/frame (%.0f frames/sec) sink=%g\n",
         frames, steady, ns, 1e9 / ns, (double)sink);
  return 0;
}

static uint32_t fold(uint32_t h, uint32_t x) { return (uint32_t)js::imul((int32_t)(h ^ x), (int32_t)16777619u); }

int main(int argc, char** argv) {
  if (argc > 1 && std::strcmp(argv[1], "bench") == 0) {
    long frames = argc > 2 ? atol(argv[2]) : 2000000;
    int steady = argc > 3 ? atoi(argv[3]) : 20;
    double churnP = argc > 4 ? atof(argv[4]) : 1.0;
    return bench_main(frames, steady, churnP);
  }
  uint32_t seed = argc > 1 ? (uint32_t)strtoul(argv[1], nullptr, 10) : 1u;
  long nsteps = argc > 2 ? atol(argv[2]) : 5000;
  js::Mulberry32 rng(seed);
  js::Object obj;

  auto checksum = [&]() -> uint32_t {
    uint32_t h = 2166136261u, pos = 0;
    for (const std::string& k : obj.keys()) {
      h = fold(h, pos);
      for (char c : k) h = fold(h, (uint32_t)(unsigned char)c);
      h = fold(h, (uint32_t)(int32_t)obj.get(k).toNum());  // value int32
      pos++;
    }
    return h;
  };

  for (long step = 0; step < nsteps; step++) {
    double roll = rng();
    if (roll < 0.4) {
      double k = js::floor(rng() * 25);
      obj.set(js::Value::numKey(k), js::Value(js::floor(rng() * 1000)));
    } else if (roll < 0.7) {
      double a = js::floor(rng() * 8), b = js::floor(rng() * 8);
      std::string key = js::Value::numKey(a) + "," + js::Value::numKey(b);
      obj.set(key, js::Value(js::floor(rng() * 1000)));
    } else if (roll < 0.85) {
      double k = js::floor(rng() * 25);
      obj.del(js::Value::numKey(k));
    } else {
      double a = js::floor(rng() * 8), b = js::floor(rng() * 8);
      obj.del(js::Value::numKey(a) + "," + js::Value::numKey(b));
    }
    printf("%ld n=%zu h=%u\n", step, obj.size(), checksum());
  }
  return 0;
}
