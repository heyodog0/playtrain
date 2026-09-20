// twin_host.cpp — CLI over the twin vec host, one env, for the gates.
//   twin_host <bundle.js> trace <seed> <n>     reference_trace.mjs / qjs_host trace format (byte-diffable)
//   twin_host <bundle.js> bench <seed> <n>     steps/s with observation readback, like qjs_host bench
//   twin_host <bundle.js> snap  <seed> <a,b,..>  per-step JSON snapshots (the family hook's snap() shape), one per line
// Env TWIN_OBS_MODE=symbolic selects symbolic observations when the sidecar declares them.
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

extern "C" {
void* vec_create(const char*, int, int, int, int, int);
int vec_obs_bytes(void*); int vec_set_obs_symbolic(void*, int);
void vec_reset(void*, const int32_t*, uint8_t*);
void vec_step(void*, const int32_t*, uint8_t*, float*, uint8_t*, uint8_t*);
void vec_close(void*); const char* vec_error(void*); const char* vec_last_error();
int twin_debug_state(void*, int, double*, double*, char*, int);
const char* twin_debug_snapshot(void*, int);
int twin_debug_n_actions(void*);
void twin_debug_reset(void*, int, uint32_t);
}

// ECMAScript Number.prototype.toString for the values a game reports: shortest round-trip decimal.
static void jsnum(double v, char* out, size_t n) {
  if (v == 0) { snprintf(out, n, "0"); return; }
  if (std::isnan(v)) { snprintf(out, n, "NaN"); return; }
  if (std::isinf(v)) { snprintf(out, n, v > 0 ? "Infinity" : "-Infinity"); return; }
  if (v == std::floor(v) && std::fabs(v) < 1e21) { snprintf(out, n, "%.0f", v); return; }
  for (int p = 1; p <= 17; p++) { char b[64]; snprintf(b, sizeof b, "%.*g", p, v); if (strtod(b, nullptr) == v) { snprintf(out, n, "%s", b); return; } }
  snprintf(out, n, "%.17g", v);
}

static uint64_t fnv1a(const uint8_t* p, size_t n) { uint64_t h = 1469598103934665603ULL; for (size_t i = 0; i < n; i++) { h ^= p[i]; h *= 1099511628211ULL; } return h; }

int main(int argc, char** argv) {
  if (argc < 4) { fprintf(stderr, "usage: twin_host <bundle.js> trace|bench|snap <seed> <n|actions>\n"); return 2; }
  const char* game = argv[1]; const char* mode = argv[2];
  uint32_t seed = (uint32_t)strtoul(argv[3], nullptr, 10);
  void* h = vec_create(game, 1, 64, 100000, 1, 0);
  if (!h) { fprintf(stderr, "twin_host: %s\n", vec_last_error()); return 1; }
  const char* om = getenv("TWIN_OBS_MODE");
  if (om && !strcmp(om, "symbolic")) {
    // the sidecar's obs.symbolic is what the registry read; ask the host through the same API Python uses
    char* end = nullptr; int dim = 0; const char* sd = getenv("TWIN_SYMBOLIC_DIM"); if (sd) dim = (int)strtol(sd, &end, 10);
    if (dim <= 0 || !vec_set_obs_symbolic(h, dim)) { fprintf(stderr, "twin_host: symbolic mode needs TWIN_SYMBOLIC_DIM and a twin with getObservation\n"); return 1; }
  }
  int nA = twin_debug_n_actions(h); if (nA < 1) nA = 1;
  int ob = vec_obs_bytes(h);
  std::vector<uint8_t> obs(ob); float rew = 0; uint8_t term = 0, trunc = 0;
  int32_t s32 = (int32_t)seed, a32 = 0;
  double score = 0, lives = 0; char gs[32]; char sb[40], lb[40], rb[40];
  auto state = [&]() { twin_debug_state(h, 0, &score, &lives, gs, sizeof gs); };
  vec_reset(h, &s32, obs.data()); state();
  if (const char* e = vec_error(h)) { fprintf(stderr, "twin_host: %s\n", e); return 1; }
  if (!strcmp(mode, "trace")) {
    long n = strtol(argv[4], nullptr, 10);
    jsnum(score, sb, sizeof sb); jsnum(lives, lb, sizeof lb);
    printf("reset seed=%u score=%s lives=%s state=%s obshash=%llu\n", seed, sb, lb, gs, (unsigned long long)fnv1a(obs.data(), obs.size()));
    double last = score;
    for (long i = 0; i < n; i++) {
      a32 = (int32_t)((i * 3 + 1) % nA);
      vec_step(h, &a32, obs.data(), &rew, &term, &trunc); state();
      jsnum(score - last, rb, sizeof rb); jsnum(score, sb, sizeof sb); jsnum(lives, lb, sizeof lb);
      printf("%ld a=%d reward=%s term=%d trunc=0 score=%s lives=%s state=%s obshash=%llu\n", i, a32, rb, term ? 1 : 0, sb, lb, gs, (unsigned long long)fnv1a(obs.data(), obs.size()));
      last = score;
      if (term) { s32 = (int32_t)(seed + (uint32_t)i + 1); vec_reset(h, &s32, obs.data()); state(); last = score; }
    }
  } else if (!strcmp(mode, "bench")) {
    long n = strtol(argv[4], nullptr, 10); uint32_t rs = 2;
    auto t0 = std::chrono::steady_clock::now();
    for (long i = 0; i < n; i++) {
      a32 = (int32_t)((i * 3 + 1) % nA);
      vec_step(h, &a32, obs.data(), &rew, &term, &trunc);
      if (term) { s32 = (int32_t)(rs++); vec_reset(h, &s32, obs.data()); }
    }
    double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    printf("bench(twin): %ld steps in %.4fs = %.0f steps/sec\n", n, secs, n / secs);
  } else if (!strcmp(mode, "snap")) {
    twin_debug_reset(h, 0, seed);                     // the hook's reset: no NOOP frame
    printf("%s\n", twin_debug_snapshot(h, 0));
    const char* p = argv[4];
    while (p && *p) { a32 = (int32_t)strtol(p, (char**)&p, 10); if (*p == ',') p++;
      vec_step(h, &a32, obs.data(), &rew, &term, &trunc);
      printf("%s\n", twin_debug_snapshot(h, 0)); }
  } else { fprintf(stderr, "unknown mode %s\n", mode); return 2; }
  if (const char* e = vec_error(h)) { fprintf(stderr, "twin_host: %s\n", e); return 1; }
  vec_close(h);
  return 0;
}
