// bigfish.cpp — hand-written C++ port of examples/games/js/bigfish.js.
//
// This is the REFERENCE TARGET for the JS->C++ transpiler: it fixes the lowering
// conventions the codegen must reproduce.
//   - each object-literal shape        -> a struct (Player{x,y,r,speed}, Fish{x,y,r,vx})
//   - dynamic array                    -> std::vector<T> (push/splice/for-of/index)
//   - mulberry32 closure               -> js::Mulberry32 functor (recognized idiom)
//   - gameState string                 -> const char* (compared by strcmp / assigned literal)
//   - Math.* / p5 math                 -> js:: helpers
//   - RNG CALL ORDER is preserved exactly, statement for statement, so the native
//     trajectory is bit-identical to V8's.
#include <vector>
#include <cstring>
#include "../runtime/p5.hpp"
#include "../runtime/game.hpp"
#include "../runtime/jsmath.h"

namespace game {

// ---- module globals (mirror the JS top-level lets/consts) ----
static int score = 0;
static int lives = 0;
static const char* gameState = "PLAYING";
static js::Mulberry32 rng;      // assigned in resetGame
static bool rngReady = false;

struct Player { double x, y, r, speed; };
struct Fish   { double x, y, r, vx; };

static Player player;
static std::vector<Fish> fishes;
static int fishEaten = 0;
static const int FISH_QUOTA = 30;

static void resetLevel() {
  player = {200, 200, 15, 5};
  fishes.clear();
  if (rngReady) {
    for (int i = 0; i < 4; i++) {
      double r = 8 + js::pow(rng(), 1.4) * 30;
      double y = r + rng() * (400 - 2 * r);
      bool movesRight = rng() < 0.5;
      double x = movesRight ? rng() * 400 : (400 - rng() * 400);
      double vx = (1.5 + rng() * 3.5) * (movesRight ? 1 : -1);
      fishes.push_back(Fish{x, y, r, vx});
    }
  }
}

void resetGame(uint32_t seed) {
  rng = js::Mulberry32(seed);
  rngReady = true;
  score = 0;
  lives = 3;
  gameState = "PLAYING";
  fishEaten = 0;
  resetLevel();
}

void setup() {
  p5::createCanvas(400, 400);
  p5::noStroke();
}

State getGameState() {
  return State{(double)score, (double)lives, gameState};
}

void draw() {
  using namespace p5;
  if (std::strcmp(gameState, "PLAYING") != 0) return;

  // Player movement
  if (keyIsDown(37)) player.x -= player.speed;
  if (keyIsDown(39)) player.x += player.speed;
  if (keyIsDown(38)) player.y -= player.speed;
  if (keyIsDown(40)) player.y += player.speed;

  // Clamp player to screen
  player.x = js::max(player.r, js::min(width() - player.r, player.x));
  player.y = js::max(player.r, js::min(height() - player.r, player.y));

  // Spawn fish
  if (rng() < 0.04) {
    double r = 8 + js::pow(rng(), 1.4) * 42;
    double y = r + rng() * (height() - 2 * r);
    bool movesRight = rng() < 0.5;
    double x = movesRight ? -r : width() + r;
    double vx = (1.5 + rng() * 3.5) * (movesRight ? 1 : -1);
    fishes.push_back(Fish{x, y, r, vx});
  }

  // Update fishes and check collisions
  for (int i = (int)fishes.size() - 1; i >= 0; i--) {
    Fish& f = fishes[i];
    f.x += f.vx;

    // Remove if fully off screen
    if ((f.vx > 0 && f.x - f.r > width()) || (f.vx < 0 && f.x + f.r < 0)) {
      fishes.erase(fishes.begin() + i);
      continue;
    }

    // Collision check
    double dx = f.x - player.x;
    double dy = f.y - player.y;
    double distSq = dx * dx + dy * dy;
    double rSum = f.r + player.r;

    if (distSq < rSum * rSum) {
      if (f.r >= player.r) {
        // Player eaten by larger fish
        lives--;
        if (lives <= 0) {
          gameState = "GAMEOVER";
        } else {
          resetLevel();
          break;  // Stop processing further collisions this frame
        }
      } else {
        // Player eats smaller fish
        score++;
        fishEaten++;
        player.r += 1.5;
        fishes.erase(fishes.begin() + i);

        if (fishEaten >= FISH_QUOTA) {
          score += 10;  // Completion bonus
          gameState = "WIN";
        }
      }
    }
  }

#ifndef NO_RENDER
  // Render
  background(0.0);

  // Draw fishes
  for (Fish& f : fishes) {
    if (f.r < player.r) {
      fill(0, 255, 0);  // Green: smaller, safe to eat
    } else {
      fill(255, 0, 0);  // Red: larger, dangerous
    }
    ellipse(f.x, f.y, f.r * 2, f.r * 2);
  }

  // Draw player
  fill(0, 100, 255);  // Blue
  ellipse(player.x, player.y, player.r * 2, player.r * 2);

  // Draw lives HUD (visual only)
  fill(0, 100, 255);
  for (int i = 0; i < lives; i++) {
    rect(10 + i * 20, 10, 12, 12);
  }
#endif  // NO_RENDER
}

}  // namespace game
