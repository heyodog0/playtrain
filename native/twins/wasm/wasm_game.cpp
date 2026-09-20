// wasm_game.cpp — the .wasm game's exports (the PlayTrain contract, C ABI): pt_setup, pt_reset(seed), pt_draw,
// pt_score, pt_lives, pt_state (a C string), pt_obs_dim, pt_observation (float32 buffer). The twin is the same class
// the native host runs; its data files are embedded (vfs.cpp, TWIN_WASM). PT_GAME_NAME names the bundle.
#include "twin.hpp"
#include <cstring>
#include <memory>
#include <string>
#include <vector>
#ifndef PT_GAME_NAME
#error "PT_GAME_NAME must be defined"
#endif
#define KEEP extern "C" __attribute__((used, visibility("default")))
extern "C" { __attribute__((import_module("env"), import_name("pt_abort"))) void pt_abort(const char*); }
namespace {
std::unique_ptr<twin::Twin> g_twin; twin::GameInfo g_info; std::string g_state; std::vector<float> g_obs; bool g_ready = false;
void ensure() {
  if (g_ready) return;
  std::string err;
  if (!twin::read_game_info(std::string("/game/dist/") + PT_GAME_NAME + ".js", g_info, err)) { pt_abort(err.c_str()); return; }
  g_twin = twin::make_twin(g_info, err);
  if (!g_twin) { pt_abort(err.c_str()); return; }
  g_ready = true;
}
}
KEEP void pt_setup() { ensure(); g_twin->setup(); }
KEEP void pt_reset(unsigned int seed) { ensure(); g_twin->resetGame(seed); }
KEEP void pt_draw() { ensure(); g_twin->draw(); }
KEEP double pt_score() { ensure(); return g_twin->getGameState().score; }
KEEP double pt_lives() { ensure(); return g_twin->getGameState().lives; }
KEEP const char* pt_state() { ensure(); g_state = g_twin->getGameState().gameState; return g_state.c_str(); }
KEEP int pt_obs_dim() { ensure(); return g_twin->symbolicDim(); }
KEEP const float* pt_observation() { ensure(); int d = g_twin->symbolicDim(); g_obs.assign(d > 0 ? d : 1, 0.0f); if (d > 0) g_twin->getObservation(g_obs.data(), d); return g_obs.data(); }
