// vec_host.cpp — the vec_* C ABI over native twins. The STRUCTURE of native/qjs/qjs_vec_host.cpp (one process, N envs,
// a fixed thread pool with contiguous shards, a per-worker-flag spin barrier with hybrid parking, SAME_STEP
// autoreset with the three seed modes, frame_skip / render_skip, pixel or symbolic observations written straight
// into the caller's slab) with the QuickJS context replaced by a Twin. Loaded by src/playtrain/runtime/
// native_vec_env.py through `lib_path`; the async (send/recv) family is not implemented.
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include "twin.hpp"
#include "p5.hpp"
#include "raster_abi.h"

using twin::Twin;

static inline void cpu_relax() {
#if defined(__aarch64__) || defined(__arm__)
  asm volatile("yield");
#elif defined(__x86_64__) || defined(__i386__)
  asm volatile("pause");
#endif
}

static int default_threads() {
  int hw = (int)std::thread::hardware_concurrency();
  return hw > 0 ? hw : 1;
}

// Discrete action table: held key codes per action (the sidecar's `held`, or vec_set_actions' flat table). The
// press key, when given, is unioned into the held set like action_table.hpp does.
struct Actions {
  std::vector<std::vector<int>> held;
  int n() const { return (int)held.size(); }
  int clamp(int a) const { return a < 0 ? 0 : (a >= n() ? n() - 1 : a); }
  bool install(const int32_t* held_in, const int32_t* press_in, int n_actions, int max_held) {
    if (!held_in || n_actions < 1 || max_held < 0 || max_held > 14) return false;
    std::vector<std::vector<int>> h(n_actions);
    for (int a = 0; a < n_actions; a++) {
      for (int k = 0; k < max_held; k++) { int c = held_in[a * max_held + k]; if (c >= 0) h[a].push_back(c); }
      if (press_in && press_in[a] >= 0) h[a].push_back(press_in[a]);
    }
    held = std::move(h);
    return true;
  }
};

struct Env {
  void* rstate = nullptr;
  void* p5state = nullptr;
  std::unique_ptr<Twin> twin;
  int frameCount = 0;
  long steps = 0;
  double lastScore = 0;
  bool ok = true;
  std::string err;
  inline void select() { rs_state_select(rstate); p5::selectState(p5state); }
};

struct alignas(128) WorkerCtl { std::atomic<uint64_t> done{0}; };

struct VecHost {
  twin::GameInfo info;
  Actions actions;
  std::vector<Env> envs;
  int num_envs = 0, obs_size = 0, obs_bytes = 0, max_steps = 2000, autoreset = 0;
  int obs_symbolic_dim = 0;
  int frame_skip = 1, render_skip = 0;
  int seed_mode = 0; uint32_t fixed_seed = 0; std::vector<int32_t> seed_pool; std::vector<uint64_t> rng;
  int nthreads = 1;
  std::vector<std::thread> pool;
  std::vector<int> shard_start;
  alignas(128) std::atomic<uint64_t> go{0};
  std::vector<WorkerCtl> done;
  std::atomic<bool> stop{false};
  alignas(128) std::atomic<int> parked{0};
  std::mutex park_mu; std::condition_variable park_cv;
  int cmd = 0;   // 0 step, 1 reset, 2 init
  const int32_t* in_actions = nullptr; const int32_t* in_seeds = nullptr;
  uint8_t* out_obs = nullptr; float* out_rew = nullptr; uint8_t* out_term = nullptr; uint8_t* out_trunc = nullptr;
};

static std::string g_last_error;

static void env_init(VecHost* H, Env& e, int idx) {
  (void)idx;
  e.rstate = rs_state_new();
  e.p5state = p5::newState();
  e.select();
  p5::setRasterRes(H->obs_size);
  std::string err;
  e.twin = twin::make_twin(H->info, err);
  if (!e.twin) { e.ok = false; e.err = err; return; }
  e.twin->setup();
}

static inline bool read_state(Env& e, double& score, double& lives, uint8_t& gsIdx) {
  twin::GameState st = e.twin->getGameState();
  score = st.score; lives = st.lives;
  const std::string& g = st.gameState;
  gsIdx = g == "PLAYING" ? 0 : g == "WIN" ? 1 : g == "GAMEOVER" ? 2 : g == "EXIT" ? 3 : 4;
  return g == "WIN" || g == "EXIT" || g == "GAMEOVER";
}

static void write_obs(VecHost* H, Env& e, int idx) {
  uint8_t* dst = H->out_obs + (size_t)idx * H->obs_bytes;
  if (H->obs_symbolic_dim <= 0) { p5::render_obs_rgb(dst); return; }
  memset(dst, 0, (size_t)H->obs_bytes);
  e.twin->getObservation((float*)dst, H->obs_symbolic_dim);
}

// mirrors qjs_vec_host env_reset: resetGame(seed), then one draw() (the reset's NOOP frame), read state, write obs
static void env_reset(VecHost* H, Env& e, int idx, uint32_t seed) {
  e.select();
  p5::setKeysDown(nullptr, 0);
  e.frameCount = 0;
  e.twin->resetGame(seed);
  e.frameCount = 1;
  p5::frameBegin(); e.twin->draw(); p5::frameEnd();
  double score = 0, lives = 0; uint8_t gs = 0;
  read_state(e, score, lives, gs);
  e.steps = 0; e.lastScore = score;
  write_obs(H, e, idx);
}

static inline uint32_t autoreset_seed(VecHost* H, Env& e, int idx) {
  switch (H->seed_mode) {
    case 1: return H->fixed_seed;
    case 2: { uint64_t& s = H->rng[idx]; s += 0x9E3779B97F4A7C15ULL; uint64_t z = s;
      z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL; z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL; z ^= z >> 31;
      return (uint32_t)H->seed_pool[z % H->seed_pool.size()]; }
    default: return (uint32_t)(idx * 100003u + (uint32_t)e.steps + 1u);
  }
}

static void env_step(VecHost* H, Env& e, int idx, int action) {
  e.select();
  const std::vector<int>& held = H->actions.held[H->actions.clamp(action)];
  p5::setKeysDown(held.empty() ? nullptr : held.data(), (int)held.size());
  double score = 0, lives = 0; uint8_t gs = 0; bool term = false, trunc = false;
  for (int k = 0; k < H->frame_skip; k++) {
    // render_skip: the JS host no-ops draw calls on non-final ticks; twins draw once per frame anyway, so here the
    // intermediate frames simply are not read back (the final tick's frame is what render_obs_rgb sees).
    e.frameCount++;
    p5::frameBegin(); e.twin->draw(); p5::frameEnd();
    term = read_state(e, score, lives, gs);
    e.steps++;
    trunc = (!term && e.steps >= H->max_steps);
    if (term || trunc) break;
  }
  double reward = score - e.lastScore; e.lastScore = score;
  H->out_rew[idx] = (float)reward; H->out_term[idx] = term ? 1 : 0; H->out_trunc[idx] = trunc ? 1 : 0;
  write_obs(H, e, idx);
  if (H->autoreset && (term || trunc)) env_reset(H, e, idx, autoreset_seed(H, e, idx));
}

static void run_shard(VecHost* H, int t) {
  int lo = H->shard_start[t], hi = H->shard_start[t + 1];
  for (int i = lo; i < hi; i++) {
    Env& e = H->envs[i];
    if (H->cmd == 2) env_init(H, e, i);
    else if (!e.ok) continue;
    else if (H->cmd == 1) env_reset(H, e, i, (uint32_t)H->in_seeds[i]);
    else env_step(H, e, i, H->in_actions[i]);
  }
}

static const int kParkCheckSpins = 4096;
static const auto kParkAfter = std::chrono::milliseconds(5);
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
    uint64_t g; int spins = 0; std::chrono::steady_clock::time_point t0{};
    while ((g = H->go.load(std::memory_order_acquire)) == seen) {
      if (H->stop.load(std::memory_order_acquire)) return;
      if (!park_due(spins, t0)) { cpu_relax(); continue; }
      std::unique_lock<std::mutex> lk(H->park_mu);
      H->parked.fetch_add(1, std::memory_order_seq_cst);
      while (H->go.load(std::memory_order_acquire) == seen && !H->stop.load(std::memory_order_acquire))
        H->park_cv.wait_for(lk, std::chrono::milliseconds(100));
      H->parked.fetch_sub(1, std::memory_order_relaxed);
    }
    if (H->stop.load(std::memory_order_acquire)) return;
    run_shard(H, t);
    seen = g;
    H->done[t].done.store(g, std::memory_order_release);
  }
}

static inline void wake_parked(VecHost* H) {
  if (H->parked.load(std::memory_order_acquire) > 0) { { std::lock_guard<std::mutex> lk(H->park_mu); } H->park_cv.notify_all(); }
}

static void dispatch(VecHost* H) {
  int T = H->nthreads;
  if (T <= 1) { run_shard(H, 0); return; }
  uint64_t g = H->go.fetch_add(1, std::memory_order_release) + 1;
  wake_parked(H);
  run_shard(H, 0);
  for (int t = 1; t < T; t++) while (H->done[t].done.load(std::memory_order_acquire) != g) cpu_relax();
}

#if defined(__GNUC__)
#pragma GCC visibility push(default)
#endif
extern "C" {

const char* vec_last_error() { return g_last_error.c_str(); }
void vec_close(void* h);

const char* vec_error(void* h) {
  if (!h) return nullptr;
  VecHost* H = (VecHost*)h;
  for (auto& e : H->envs) if (!e.ok) { g_last_error = e.err; return g_last_error.c_str(); }
  return nullptr;
}

void* vec_create(const char* game_path, int num_envs, int obs_size, int max_steps, int num_threads, int autoreset) {
  VecHost* H = new VecHost();
  std::string err;
  if (!twin::read_game_info(game_path, H->info, err)) { g_last_error = err; fprintf(stderr, "%s\n", err.c_str()); delete H; return nullptr; }
  H->actions.held = H->info.actions_held;
  if (H->actions.n() == 0) H->actions.held = {{}};
  H->num_envs = num_envs; H->obs_size = obs_size; H->obs_bytes = obs_size * obs_size * 3;
  H->max_steps = max_steps > 0 ? max_steps : 2000; H->autoreset = autoreset;
  int T = num_threads > 0 ? num_threads : default_threads();
  if (T > num_envs) T = num_envs; if (T < 1) T = 1;
  H->nthreads = T;
  H->envs.resize(num_envs);
  H->shard_start.resize(T + 1);
  for (int t = 0; t <= T; t++) H->shard_start[t] = (int)((long)t * num_envs / T);
  H->done = std::vector<WorkerCtl>(T);
  H->pool.resize(T);
  for (int t = 1; t < T; t++) H->pool[t] = std::thread(worker_loop, H, t);
  H->cmd = 2; dispatch(H);
  for (auto& e : H->envs) if (!e.ok) { g_last_error = e.err; fprintf(stderr, "twin_vec: env init failed: %s\n", e.err.c_str()); vec_close(H); return nullptr; }
  g_last_error.clear();
  return H;
}

int vec_obs_bytes(void* h) { return h ? ((VecHost*)h)->obs_bytes : 0; }
int vec_num_threads(void* h) { return h ? ((VecHost*)h)->nthreads : 0; }

int vec_set_obs_symbolic(void* h, int dim) {
  if (!h) return 0;
  VecHost* H = (VecHost*)h;
  if (dim <= 0) { H->obs_symbolic_dim = 0; H->obs_bytes = H->obs_size * H->obs_size * 3; return 1; }
  for (auto& e : H->envs) if (!e.twin || e.twin->symbolicDim() <= 0) return 0;
  H->obs_symbolic_dim = dim; H->obs_bytes = dim * (int)sizeof(float);
  return 1;
}

void vec_reset(void* h, const int32_t* seeds, uint8_t* obs) { VecHost* H = (VecHost*)h; H->cmd = 1; H->in_seeds = seeds; H->out_obs = obs; dispatch(H); }

void vec_step(void* h, const int32_t* actions, uint8_t* obs, float* rew, uint8_t* term, uint8_t* trunc) {
  VecHost* H = (VecHost*)h; H->cmd = 0; H->in_actions = actions; H->out_obs = obs; H->out_rew = rew; H->out_term = term; H->out_trunc = trunc; dispatch(H);
}

void vec_reset_subset(void* h, const int32_t* ids, const int32_t* seeds, int count, uint8_t* obs) {
  VecHost* H = (VecHost*)h; H->out_obs = obs;
  for (int k = 0; k < count; k++) { int i = ids[k]; if (H->envs[i].ok) env_reset(H, H->envs[i], i, (uint32_t)seeds[k]); }
}

int vec_set_actions(void* h, const int32_t* held, const int32_t* press, int n_actions, int max_held) {
  VecHost* H = (VecHost*)h; if (!H) return 0;
  if (!H->actions.install(held, press, n_actions, max_held)) { fprintf(stderr, "twin_vec: vec_set_actions rejected\n"); return 0; }
  return 1;
}

void vec_set_frame_skip(void* h, int k) { ((VecHost*)h)->frame_skip = k > 1 ? k : 1; }
void vec_set_render_skip(void* h, int on) { ((VecHost*)h)->render_skip = on ? 1 : 0; }
void vec_set_group_mode(void* h) { (void)h; fprintf(stderr, "twin_vec: group mode (async host) is not implemented\n"); }

void vec_set_autoreset_seeds(void* h, int mode, const int32_t* pool, int count, uint64_t seed_arg) {
  VecHost* H = (VecHost*)h;
  if (mode == 2 && (!pool || count <= 0)) { fprintf(stderr, "twin_vec: seed mode 2 needs a non-empty pool\n"); return; }
  H->seed_mode = mode;
  if (mode == 1) H->fixed_seed = (uint32_t)seed_arg;
  if (mode == 2) { H->seed_pool.assign(pool, pool + count); H->rng.resize(H->num_envs);
    for (int i = 0; i < H->num_envs; i++) H->rng[i] = seed_arg * 0x9E3779B97F4A7C15ULL + (uint64_t)(i + 1) * 0xBF58476D1CE4E5B9ULL; }
}

void vec_close(void* h) {
  if (!h) return;
  VecHost* H = (VecHost*)h;
  H->stop.store(true, std::memory_order_release);
  H->go.fetch_add(1, std::memory_order_release);
  wake_parked(H);
  for (int t = 1; t < (int)H->pool.size(); t++) if (H->pool[t].joinable()) H->pool[t].join();
  for (auto& e : H->envs) { e.twin.reset(); if (e.p5state) p5::freeState(e.p5state); if (e.rstate) rs_state_free(e.rstate); }
  delete H;
}

// ---- ABI symbols the Python loader binds unconditionally but this host does not implement ----
// The async (send/recv) family and the analog / box-space input paths belong to the QuickJS host; here they exist so
// ctypes can bind them, and say so if called. vec_create_async returns nullptr with the reason in vec_last_error.
static void* unsupported_create(const char* what) { g_last_error = std::string("twin_vec: ") + what + " is not implemented by the twin host"; fprintf(stderr, "%s\n", g_last_error.c_str()); return nullptr; }
void* vec_create_async(const char*, int, int, int, int, int) { return unsupported_create("vec_create_async"); }
void* vec_create_async_multi(const char**, int, int, int, int, int) { return unsupported_create("vec_create_async_multi"); }
void vec_async_setup(void*, uint8_t*, float*, uint8_t*, uint8_t*) {}
void vec_async_reset(void*, const int32_t*) {}
void vec_send(void*, const int32_t*, const int32_t*, int) {}
int vec_recv(void*, int, int32_t*) { return 0; }
void vec_wait_ids(void*, const int32_t*, int) {}
int vec_set_action_analog(void*, const uint16_t*, const uint8_t*, const uint32_t*, const uint16_t*) { fprintf(stderr, "twin_vec: analog actions are not implemented\n"); return 0; }
int vec_set_input_map(void*, const int32_t*, const int32_t*, int) { fprintf(stderr, "twin_vec: box-space input maps are not implemented\n"); return 0; }
void vec_step_q(void*, const uint16_t*, uint8_t*, float*, uint8_t*, uint8_t*) { fprintf(stderr, "twin_vec: vec_step_q without an input map\n"); }

// ---- debug accessors for twin_host (not part of the Python ABI) ----
int twin_debug_state(void* h, int idx, double* score, double* lives, char* gs, int gs_len) {
  VecHost* H = (VecHost*)h; if (!H || idx < 0 || idx >= H->num_envs) return 0;
  Env& e = H->envs[idx]; e.select();
  twin::GameState st = e.twin->getGameState();
  *score = st.score; *lives = st.lives; snprintf(gs, gs_len, "%s", st.gameState.c_str());
  return 1;
}
const char* twin_debug_snapshot(void* h, int idx) {
  static thread_local std::string buf;
  VecHost* H = (VecHost*)h; if (!H || idx < 0 || idx >= H->num_envs) return "";
  Env& e = H->envs[idx]; e.select();
  buf = e.twin->snapshot();
  return buf.c_str();
}
int twin_debug_n_actions(void* h) { return h ? ((VecHost*)h)->actions.n() : 0; }
// Hook-style reset: resetGame(seed) with NO draw, like the families' gate hooks (`__chip8.reset`, `__ps.reset`), so
// `twin_host snap` lines up step for step with the JS snapshots the goldens hash.
void twin_debug_reset(void* h, int idx, uint32_t seed) {
  VecHost* H = (VecHost*)h; if (!H || idx < 0 || idx >= H->num_envs) return;
  Env& e = H->envs[idx]; e.select(); p5::setKeysDown(nullptr, 0); e.twin->resetGame(seed); e.steps = 0;
  e.lastScore = e.twin->getGameState().score;
}

}  // extern "C"
#if defined(__GNUC__)
#pragma GCC visibility pop
#endif
