// twin.hpp — the interface a native twin implements. A twin IS the JS bundle's prelude, in C++:
// setup() creates the canvas, resetGame(seed) loads an episode, draw() is one PlayTrain frame (read the held keys
// through p5::keyIsDown exactly as the JS prelude does, step the game, issue the same p5 draw calls), getGameState()
// is the contract's {score, lives, gameState}. The host (vec_host.cpp) owns per-env rasterizer + p5 state, the
// thread pool, autoreset and the observation slab, and never looks inside a twin.
#pragma once
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace twin {

struct GameState {
  double score = 0, lives = 1;
  std::string gameState = "PLAYING";   // PLAYING | WIN | GAMEOVER | EXIT
};

class Twin {
 public:
  virtual ~Twin() {}
  virtual void setup() = 0;                       // p5::createCanvas(...)
  virtual void resetGame(uint32_t seed) = 0;
  virtual void draw() = 0;                        // one frame: input -> step -> p5 draw calls
  virtual GameState getGameState() = 0;
  virtual int symbolicDim() const { return 0; }   // > 0: getObservation exists
  virtual void getObservation(float* out, int dim) { (void)out; (void)dim; }
  virtual std::string snapshot() const { return "{}"; }   // the family hook's snap() shape, JSON
  // The family hook's step (`__chip8.step(a)`, `__ps.step(a)`): the ENV step with an action index, no draw, no
  // PlayTrain episode bookkeeping. The lockstep and golden gates drive this; draw() is what the host drives.
  virtual void hookStep(int action) { (void)action; }
};

// What the registry learns from the bundle's sidecar (<bundle>.json).
struct GameInfo {
  std::string family, game, dir;                  // dir = the family directory (dist/..)
  std::vector<std::vector<int>> actions_held;     // sidecar actions[i].held key codes
  std::vector<std::string> action_names;
  int symbolic_dim = 0;                           // sidecar obs.symbolic, 0 if none
};

// registry.cpp: read the sidecar, build the family's twin. Returns nullptr and sets err on failure.
bool read_game_info(const std::string& game_path, GameInfo& info, std::string& err);
std::unique_ptr<Twin> make_twin(const GameInfo& info, std::string& err);

// Family factories (each family's twin_*.cpp defines one; absent families are nullptr-returning stubs).
std::unique_ptr<Twin> make_blank_twin(const GameInfo& info, std::string& err);
std::unique_ptr<Twin> make_chip8_twin(const GameInfo& info, std::string& err);
std::unique_ptr<Twin> make_vgdl_twin(const GameInfo& info, std::string& err);
std::unique_ptr<Twin> make_puzzlescript_twin(const GameInfo& info, std::string& err);

}  // namespace twin
