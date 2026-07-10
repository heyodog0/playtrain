// main.cpp — driver for a native game twin. Two modes:
//   trace  <seed> <nsteps>   per-step: idx reward term trunc score lives state obshash
//   bench  <episodes> <nsteps>   throughput (steps/sec), auto-resetting episodes
//
// The action sequence is a fixed deterministic formula (act = (i*3+1)%8) so the
// JS reference driver can reproduce it exactly for the differential gate.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <vector>
#include <chrono>

#include "env.hpp"

static const int OBS = 64;

// FNV-1a 64-bit over the obs bytes — a compact byte-exact frame fingerprint.
static uint64_t fnv1a(const uint8_t* p, size_t n) {
  uint64_t h = 1469598103934665603ULL;
  for (size_t i = 0; i < n; i++) { h ^= p[i]; h *= 1099511628211ULL; }
  return h;
}

static inline int action_at(long i) { return (int)((i * 3 + 1) % 8); }

int main(int argc, char** argv) {
  const char* mode = argc > 1 ? argv[1] : "trace";
  const size_t obsBytes = (size_t)OBS * OBS * 3;
  std::vector<uint8_t> obs(obsBytes);

  if (std::strcmp(mode, "trace") == 0) {
    uint32_t seed = argc > 2 ? (uint32_t)strtoul(argv[2], nullptr, 10) : 12345u;
    long nsteps = argc > 3 ? atol(argv[3]) : 300;

    nodegym::Env env(OBS, OBS, /*maxSteps*/ 100000, /*frameSkip*/ 1);
    env.init();
    env.reset(seed, obs.data());
    game::State st0 = game::getGameState();
    printf("reset seed=%u score=%g lives=%g state=%s obshash=%llu\n",
           seed, st0.score, st0.lives, st0.gameState,
           (unsigned long long)fnv1a(obs.data(), obsBytes));

    for (long i = 0; i < nsteps; i++) {
      int a = action_at(i);
      auto r = env.step(a, obs.data());
      printf("%ld a=%d reward=%g term=%d trunc=%d score=%g lives=%g state=%s obshash=%llu\n",
             i, a, r.reward, r.terminated ? 1 : 0, r.truncated ? 1 : 0,
             r.state.score, r.state.lives, r.state.gameState,
             (unsigned long long)fnv1a(obs.data(), obsBytes));
      if (r.terminated || r.truncated) { env.reset(seed + (uint32_t)i + 1, obs.data()); }
    }
    return 0;
  }

  if (std::strcmp(mode, "bench") == 0) {
    long episodes = argc > 2 ? atol(argv[2]) : 0;      // 0 => run nsteps flat
    long nsteps = argc > 3 ? atol(argv[3]) : 2000000;
    (void)episodes;

    nodegym::Env env(OBS, OBS, /*maxSteps*/ 2000, /*frameSkip*/ 1);
    env.init();
    env.reset(1u, obs.data());

    auto t0 = std::chrono::steady_clock::now();
    long done = 0;
    uint32_t rs = 2;
#if defined(NO_RENDER) || defined(NO_OBS)
    uint8_t* obsPtr = nullptr;  // NO_RENDER: logic only; NO_OBS: rasterize but skip readback
#else
    uint8_t* obsPtr = obs.data();
#endif
    for (long i = 0; i < nsteps; i++) {
      auto r = env.step(action_at(i), obsPtr);
      done++;
      if (r.terminated || r.truncated) env.reset(rs++, obs.data());
    }
    auto t1 = std::chrono::steady_clock::now();
    double secs = std::chrono::duration<double>(t1 - t0).count();
    printf("bench: %ld steps in %.4fs = %.0f steps/sec\n", done, secs, done / secs);
    return 0;
  }

  fprintf(stderr, "unknown mode: %s\n", mode);
  return 1;
}
