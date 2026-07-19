// game.hpp — the fixed lifecycle contract every compiled game twin exposes.
// Mirrors the JS games' required interface (game-env.mjs loadGame checks):
//   setup(), resetGame(seed), draw(), getGameState() -> {score,lives,gameState}.
// One game is linked per native binary; the harness (env.hpp) drives these.
#ifndef NODE_GYM_GAME_HPP
#define NODE_GYM_GAME_HPP

#include <cstdint>

namespace game {

struct State {
  double score;
  double lives;
  const char* gameState;  // "PLAYING" | "WIN" | "GAMEOVER" | "EXIT" | ...
};

void setup();
void resetGame(uint32_t seed);
void draw();
State getGameState();

}  // namespace game

#endif  // NODE_GYM_GAME_HPP
