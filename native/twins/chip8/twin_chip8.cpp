// twin_chip8.cpp — parity/chip8/src/90_prelude.js in C++: keypad key codes, one draw() = one env step, GAMEOVER at
// terminated, the 64x32 display as two-colour tiles in the middle band of a 256x256 canvas, __chip8.snap() shape.
#include "twin.hpp"
#include "p5.hpp"
#include "env.hpp"
#include <cstdio>
#include "vfs.hpp"
namespace twin {
using chip8::Env;

static const int KEYCODES[16] = {88, 49, 50, 51, 81, 87, 69, 65, 83, 68, 90, 67, 52, 82, 70, 86};
static const int CANVAS = 256;

class Chip8Twin : public Twin {
  Env env_; double score_ = 0; std::string gameState_ = "PLAYING";
  uint16_t kinds_[chip8::W * chip8::H]; uint8_t palette_[8] = {0, 0, 0, 255, 0, 255, 0, 255};
 public:
  Chip8Twin(const chip8::Def& d, std::vector<uint8_t> rom) { chip8::create(env_, d, std::move(rom)); }
  void setup() override { p5::createCanvas(CANVAS, CANVAS); }
  void resetGame(uint32_t seed) override { chip8::reset(env_, seed); score_ = env_.score; gameState_ = "PLAYING"; }
  int actionFromKeys() const { for (size_t i = 0; i < env_.def.action_set.size(); i++) if (p5::keyIsDown(KEYCODES[env_.def.action_set[i]])) return (int)i; return env_.noop; }
  void render() {
    p5::background(0, 0, 0);
    const uint8_t* d = env_.cpu.display;
    for (int x = 0; x < chip8::W; x++) { int o = x * chip8::H; for (int y = 0; y < chip8::H; y++) kinds_[y * chip8::W + x] = d[o + y]; }
    p5::drawTiles(kinds_, chip8::W, chip8::H, palette_, 1, 2, 0, CANVAS / 4, CANVAS, CANVAS / 2);
  }
  void draw() override {
    if (gameState_ == "PLAYING") { chip8::stepEnv(env_, actionFromKeys()); score_ = env_.score; if (env_.terminated) gameState_ = "GAMEOVER"; }
    render();
  }
  int hookStep(int action) override { chip8::stepEnv(env_, action); return 0; }   // __chip8.step: c8EnvStep, nothing else
  GameState getGameState() override { GameState g; g.score = score_; g.lives = 1; g.gameState = gameState_; return g; }
  std::string snapshot() const override {
    // JSON.stringify(__chip8.snap()): key order and JS number formatting matter (the goldens hash this text)
    nlohmann::ordered_json s; const chip8::Cpu& c = env_.cpu;
    auto num = [](double v) -> nlohmann::ordered_json { if (v == std::floor(v) && std::fabs(v) < 9e15) return (long long)v; return v; };
    s["t"] = env_.time; s["pc"] = c.pc; s["I"] = c.I; s["V"] = std::vector<int>(c.V, c.V + 16); s["sp"] = c.sp;
    s["stack"] = std::vector<int>(c.stack, c.stack + 16); s["delay"] = c.delay; s["sound"] = c.sound;
    s["keypad"] = std::vector<int>(c.keypad, c.keypad + 16); s["display"] = chip8::displayHex(c);
    s["rng"] = std::vector<long long>{(long long)c.rng[0], (long long)c.rng[1]}; s["score"] = num(env_.score); s["reward"] = num(env_.reward);
    s["terminated"] = env_.terminated; s["truncated"] = env_.truncated;
    return s.dump();
  }
};

std::unique_ptr<Twin> make_chip8_twin(const GameInfo& info, std::string& err) {
  chip8::Def d;
  if (!chip8::loadDef(info.dir + "/games/" + info.game + ".json", d, err)) return nullptr;
  std::string romText;
  if (!readFile(info.dir + "/roms/" + d.j["rom"].get<std::string>(), romText)) { err = "chip8: cannot open ROM for " + info.game; return nullptr; }
  std::vector<uint8_t> rom(romText.begin(), romText.end());
  return std::unique_ptr<Twin>(new Chip8Twin(d, std::move(rom)));
}
}
