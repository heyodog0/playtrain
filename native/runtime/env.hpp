// env.hpp — native reimplementation of GameEnv (runtime/p5/game-env.mjs).
// Same action vocabulary, seeding, obs, reward (score-delta), and terminal
// semantics, so a native trajectory is comparable frame-for-frame to the JS env.
#ifndef NODE_GYM_ENV_HPP
#define NODE_GYM_ENV_HPP

#include <cstdint>
#include <cstring>

#include "p5.hpp"
#include "game.hpp"

namespace nodegym {

// GAME_TEMPLATE action mapping (game-env.mjs ACTIONS):
// 0=NOOP 1=LEFT 2=RIGHT 3=UP 4=DOWN 5=D(SPACE) 6=LEFT+D 7=RIGHT+D
struct Action { int held[2]; int nHeld; int press; };  // press <0 => none
static const Action ACTIONS[8] = {
  {{},        0, -1}, // NOOP
  {{37},      1, -1}, // LEFT
  {{39},      1, -1}, // RIGHT
  {{38},      1, -1}, // UP
  {{40},      1, -1}, // DOWN
  {{},        0, 32}, // D
  {{37},      1, 32}, // LEFT_D
  {{39},      1, 32}, // RIGHT_D
};

struct StepResult {
  double reward;
  bool terminated;
  bool truncated;
  game::State state;
};

inline bool isTerminal(const char* s) {
  return std::strcmp(s, "WIN") == 0 || std::strcmp(s, "EXIT") == 0 ||
         std::strcmp(s, "GAMEOVER") == 0;
}

class Env {
 public:
  int obsW, obsH;
  int maxSteps;
  int frameSkip;
  long steps = 0;
  double episodeReturn = 0;
  double lastScore = 0;
  uint32_t seed = 0;

  Env(int obsWidth = 64, int obsHeight = 64, int maxSteps_ = 2000, int frameSkip_ = 1)
      : obsW(obsWidth), obsH(obsHeight), maxSteps(maxSteps_),
        frameSkip(frameSkip_ < 1 ? 1 : frameSkip_) {}

  // Must be called once before reset (mirrors game-env: setRasterRes then load).
  void init() {
    p5::setRasterRes(obsW);
    game::setup();
    game::resetGame(0);
    p5::tick();
    game::draw();
  }

  void reset(uint32_t s, uint8_t* obsOut) {
    seed = s;
    steps = 0;
    episodeReturn = 0;
    p5::setKeysDown(nullptr, 0);
    p5::resetFrameCount();
    game::resetGame(seed);
    p5::tick();
    game::draw();
    lastScore = game::getGameState().score;
    if (obsOut) p5::render_obs_rgb(obsOut);
  }

  StepResult step(int actionIndex, uint8_t* obsOut) {
    const Action& a = ACTIONS[(actionIndex >= 0 && actionIndex < 8) ? actionIndex : 0];
    int codes[3];
    int n = 0;
    for (int i = 0; i < a.nHeld; i++) codes[n++] = a.held[i];
    if (a.press >= 0) codes[n++] = a.press;  // press held for this frame (mirrors simulateKeyPress)
    p5::setKeysDown(codes, n);

    game::State st{};
    bool terminated = false, truncated = false;
    for (int i = 0; i < frameSkip; i++) {
      p5::tick();
      game::draw();
      steps++;
      st = game::getGameState();
      terminated = isTerminal(st.gameState);
      truncated = !terminated && steps >= maxSteps;
      if (terminated || truncated) break;
    }
    double reward = st.score - lastScore;
    lastScore = st.score;
    episodeReturn += reward;
    if (obsOut) p5::render_obs_rgb(obsOut);
    return {reward, terminated, truncated, st};
  }
};

}  // namespace nodegym

#endif  // NODE_GYM_ENV_HPP
