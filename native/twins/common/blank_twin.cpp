// blank_twin.cpp — the ABI proof: a black 64x64 canvas, score 0, lives 1, PLAYING forever (the host truncates at
// max_steps). Selected with TWIN_BLANK=1 for any family.
#include "twin.hpp"
#include "p5.hpp"

namespace twin {

class BlankTwin : public Twin {
 public:
  void setup() override { p5::createCanvas(64, 64); }
  void resetGame(uint32_t) override {}
  void draw() override { p5::background(0); }
  GameState getGameState() override { return GameState{}; }
  std::string snapshot() const override { return "{\"blank\":true}"; }
};

std::unique_ptr<Twin> make_blank_twin(const GameInfo&, std::string&) { return std::unique_ptr<Twin>(new BlankTwin()); }

}  // namespace twin
