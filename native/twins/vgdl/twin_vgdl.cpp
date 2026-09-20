// twin_vgdl.cpp — parity/vgdl/src/90_prelude.js in C++ (Colas profile): canvas sized for the largest level at 8px
// cells, vgFitLevel, level = seed % nLevels, the 'tiles' render (statics as one drawTiles kinds grid, movers as
// rects), VG_COLORS for img=colors/NAME, and the `__vgdl` hook shape for the gates. The spec is the twin/ JSON that
// tools/twin_spec.mjs serialised from the same VGDL text the bundle carries.
#include "twin.hpp"
#include "p5.hpp"
#include "engine.hpp"
#include "../common/jsnum.hpp"
#include <cstdio>
#include "vfs.hpp"
namespace twin {
using vgdl::json;

struct RGB { int r, g, b; };
static RGB colorOf(const json& img) {
  static const std::pair<const char*, RGB> C[] = {
    {"LIGHTGRAY", {150, 150, 150}}, {"BLUE", {0, 0, 200}}, {"YELLOW", {250, 250, 0}}, {"BLACK", {0, 0, 0}}, {"ORANGE", {250, 160, 0}},
    {"PURPLE", {128, 0, 128}}, {"BROWN", {140, 120, 100}}, {"PINK", {250, 200, 200}}, {"GREEN", {0, 200, 0}}, {"RED", {200, 0, 0}},
    {"WHITE", {250, 250, 250}}, {"GOLD", {250, 212, 0}}, {"LIGHTRED", {250, 50, 50}}, {"LIGHTORANGE", {250, 200, 100}}, {"LIGHTBLUE", {50, 100, 250}},
    {"LIGHTGREEN", {50, 250, 50}}, {"DARKGRAY", {30, 30, 30}}, {"DARKBLUE", {20, 20, 100}}, {"GRAY", {90, 90, 90}}};
  RGB dflt{128, 128, 128};
  if (!img.is_string()) return dflt;
  std::string s = img.get<std::string>(), name;
  if (s.compare(0, 7, "colors/") == 0) name = s.substr(7);
  else if (s.compare(0, 15, "colored_shapes/") == 0) { name = s.substr(15); size_t u = name.find('_'); if (u != std::string::npos) name = name.substr(0, u); }
  else return dflt;
  size_t sl = name.find('/'); if (sl != std::string::npos) name = name.substr(0, sl);
  for (auto& c : C) if (name == c.first) return c.second;
  return dflt;
}
static RGB rcColorOf(const json& color) {
  static const std::pair<const char*, RGB> C[] = {
    {"GREEN", {129, 199, 132}}, {"BLUE", {25, 118, 210}}, {"RED", {211, 47, 47}}, {"GRAY", {69, 90, 100}}, {"WHITE", {250, 250, 250}},
    {"BROWN", {109, 76, 65}}, {"BLACK", {55, 71, 79}}, {"ORANGE", {230, 81, 0}}, {"YELLOW", {255, 245, 157}}, {"PINK", {255, 138, 128}},
    {"GOLD", {255, 196, 0}}, {"LIGHTRED", {255, 82, 82}}, {"LIGHTORANGE", {255, 112, 67}}, {"LIGHTBLUE", {144, 202, 249}},
    {"LIGHTGREEN", {185, 246, 202}}, {"LIGHTGRAY", {207, 216, 220}}, {"DARKGRAY", {68, 90, 100}}, {"DARKBLUE", {1, 87, 155}}, {"PURPLE", {92, 107, 192}}};
  if (color.is_string()) { std::string s = color.get<std::string>(); for (auto& c : C) if (s == c.first) return c.second; }
  return RGB{140, 20, 140};
}
static const int VG_CELL_MAX = 8;
// p5 key code -> VGDL key, in vgActiveKeys order (ascending VGDL codes): SPACE, UP, DOWN, RIGHT, LEFT
static const int KEYMAP[5][2] = {{32, vgdl::K_SPACE}, {38, vgdl::K_UP}, {40, vgdl::K_DOWN}, {39, vgdl::K_RIGHT}, {37, vgdl::K_LEFT}};

class VgdlTwin : public Twin {
  vgdl::Engine E_; std::vector<std::string> levels_; std::string levelMode_, render_; int levelIndex_ = 0; bool rcrl_ = false;
  std::vector<RGB> colors_; int canvasW_ = 0, canvasH_ = 0, cell_ = 8, offX_ = 0, offY_ = 0, bgType_ = -1, levelIdx_ = 0;
  std::vector<uint16_t> kinds_; std::vector<uint8_t> palette_; std::vector<int> staticN_; int kindsW_ = 0, kindsH_ = 0;
  double score_ = 0, lives_ = 1; std::string gameState_ = "PLAYING"; bool prepared_ = false;
  std::vector<std::vector<int>> actionKeys_;   // action index -> VGDL keys (from the sidecar's held codes)
 public:
  VgdlTwin(const json& spec, int block, std::vector<std::string> levels, const GameInfo& info, bool rcrl, const std::vector<std::string>& groupOrder) : levels_(std::move(levels)), rcrl_(rcrl) {
    levelMode_ = info.level_mode; render_ = info.render; levelIndex_ = info.level_index;
    if (rcrl_) E_.rcInit(spec, block, groupOrder); else E_.init(spec, block);
    for (auto& t : E_.types) colors_.push_back(rcrl_ ? rcColorOf(t.args.contains("color") ? t.args["color"] : json()) : colorOf(t.args.contains("img") ? t.args["img"] : json()));
    int W = 0, H = 0;
    for (auto& L : levels_) { int h = 0, w = 0; size_t p = 0; while (p <= L.size()) { size_t q = L.find('\n', p); if (q == std::string::npos) q = L.size(); if (q > p) { h++; if ((int)(q - p) > w) w = (int)(q - p); } p = q + 1; } if (h > H) H = h; if (w > W) W = w; }
    canvasW_ = W * VG_CELL_MAX; canvasH_ = H * VG_CELL_MAX;
    for (auto& held : info.actions_held) { std::vector<int> ks; for (auto& m : KEYMAP) for (int c : held) if (c == m[0]) ks.push_back(m[1]); actionKeys_.push_back(ks); }
    prepared_ = true;
  }
  void fitLevel() {
    cell_ = std::max(1, (int)std::floor(std::min((double)canvasW_ / E_.W, (double)canvasH_ / E_.H)));
    offX_ = (int)std::floor((canvasW_ - E_.W * cell_) / 2.0); offY_ = (int)std::floor((canvasH_ - E_.H * cell_) / 2.0);
  }
  void pickBackground() {
    bgType_ = -1;
    if (render_ == "tiles") { tilesReset(); return; }
    if (render_ != "fast") return;
    for (size_t a = 0; a < E_.types.size(); a++) {
      auto& t = E_.types[a];
      if (!t.isStatic || t.n != E_.W * E_.H) continue;
      bool ok = true; for (auto& e : E_.spec.interactions) if (e.actor == t.key || e.actee == t.key) { ok = false; break; }
      for (auto& st : t.stypes) for (auto& e : E_.spec.interactions) if (e.actor == st || e.actee == st) ok = false;
      if (ok) { bgType_ = (int)a; return; }
    }
  }
  void tilesReset() {
    size_t nT = E_.types.size();
    palette_.assign((nT + 1) * 4, 0);
    for (size_t a = 0; a < nT; a++) { RGB c = colors_[a]; palette_[(a + 1) * 4] = c.r; palette_[(a + 1) * 4 + 1] = c.g; palette_[(a + 1) * 4 + 2] = c.b; palette_[(a + 1) * 4 + 3] = 255; }
    kindsW_ = E_.W; kindsH_ = E_.H; kinds_.assign((size_t)E_.W * E_.H, 0); staticN_.assign(nT, -1);
    tilesRebuild();
  }
  void tilesRebuild() {
    std::fill(kinds_.begin(), kinds_.end(), 0);
    for (size_t a = 0; a < E_.types.size(); a++) {
      auto& t = E_.types[a]; staticN_[a] = t.isStatic ? t.n : -1;
      if (!t.isStatic) continue;
      for (int k = 0; k < t.n; k++) { int i = t.live[k]; int c = t.cell[i]; if (c >= 0) kinds_[c] = (uint16_t)(a + 1); }
    }
  }
  void renderTiles() {
    p5::background(0); p5::noStroke();
    bool changed = false;
    for (size_t a = 0; a < E_.types.size(); a++) { auto& t = E_.types[a]; if (t.isStatic && t.n != staticN_[a]) { changed = true; break; } }
    if (changed) tilesRebuild();
    p5::drawTiles(kinds_.data(), kindsW_, kindsH_, palette_.data(), 1, (int)E_.types.size() + 1, offX_, offY_, kindsW_ * cell_, kindsH_ * cell_);
    double s = (double)cell_ / E_.B;
    for (size_t a = 0; a < E_.types.size(); a++) {
      auto& t = E_.types[a]; if (t.isStatic || t.n == 0) continue;
      RGB c = colors_[a]; p5::fill(c.r, c.g, c.b);
      for (int k = 0; k < t.n; k++) { int i = t.live[k]; p5::rect(offX_ + t.x[i] * s, offY_ + t.y[i] * s, cell_, cell_); }
    }
  }
  void render() {
    if (render_ == "tiles") { renderTiles(); return; }
    double s = (double)cell_ / E_.B;
    if (bgType_ >= 0) { RGB c = colors_[bgType_]; p5::background(c.r, c.g, c.b); } else p5::background(0);
    p5::noStroke();
    for (size_t a = 0; a < E_.types.size(); a++) {
      if ((int)a == bgType_) continue;
      auto& t = E_.types[a]; if (t.n == 0) continue;
      RGB c = colors_[a];
      if (render_ == "fast") p5::fill(c.r, c.g, c.b);
      for (int k = 0; k < t.n; k++) { int i = t.live[k]; if (render_ != "fast") p5::fill(c.r, c.g, c.b); p5::rect(offX_ + t.x[i] * s, offY_ + t.y[i] * s, cell_, cell_); }
    }
  }
  void setup() override { p5::createCanvas(canvasW_, canvasH_); }
  void resetLevel(int idx, uint32_t seed) {
    levelIdx_ = idx; if (rcrl_) E_.rcReset(levels_[idx], seed); else E_.reset(levels_[idx], seed); fitLevel(); pickBackground(); score_ = 0; lives_ = 1; gameState_ = "PLAYING";
  }
  void resetGame(uint32_t seed) override { resetLevel(levelMode_ == "fixed" ? levelIndex_ : (int)(seed % (uint32_t)levels_.size()), seed); }
  void hookReset(uint32_t seed, int level) override { if (level < 0) resetGame(seed); else resetLevel(level, seed); }
  std::vector<int> activeKeys() const { std::vector<int> k; for (auto& m : KEYMAP) if (p5::keyIsDown(m[0])) k.push_back(m[1]); return k; }
  void draw() override {
    if (!E_.ended) { if (rcrl_) E_.rcTick(activeKeys(), false); else E_.tick(activeKeys()); }
    score_ = E_.score;
    if (E_.ended) gameState_ = E_.won ? "WIN" : "GAMEOVER";
    render();
  }
  int hookStep(int action) override {
    const std::vector<int>& ks = action >= 0 && action < (int)actionKeys_.size() ? actionKeys_[action] : std::vector<int>();
    if (rcrl_) E_.rcTick(ks, false); else E_.tick(ks);   // __vgdl.tickKeys(keys): [] is NOOP (avatar skipped in rcrl)
    return 0;
  }
  GameState getGameState() override { GameState g; g.score = score_; g.lives = lives_; g.gameState = gameState_; return g; }
  std::string snapshot() const override {
    // JSON.stringify({...state(), sprites: snapshot()}) = {"t":..,"score":..,"ended":..,"won":..,"sprites":[..]}
    return "{\"t\":" + std::to_string(E_.time) + ",\"score\":" + jsnum(E_.score) + ",\"ended\":" + (E_.ended ? "true" : "false") + ",\"won\":" + (E_.won ? "true" : "false") + ",\"sprites\":" + E_.snapshotJson() + "}";
  }
};

std::unique_ptr<Twin> make_vgdl_twin(const GameInfo& info, std::string& err) {
  std::string path = info.dir + "/twin/" + info.corpus + "/" + info.game + ".json";
  std::string text;
  if (!readFile(path, text)) { err = "vgdl: no twin spec at " + path + " (run tools/twin_spec.mjs)"; return nullptr; }
  json j; try { j = json::parse(text); } catch (const std::exception& e) { err = std::string("vgdl: bad twin spec: ") + e.what(); return nullptr; }
  std::string profile = j.value("profile", "colas");
  if (profile != "colas" && profile != "rcrl") { err = "vgdl: unknown profile '" + profile + "'"; return nullptr; }
  std::vector<std::string> levels; for (auto& L : j["levels"]) levels.push_back(L.get<std::string>());
  if (levels.empty()) { err = "vgdl: no levels for " + info.game; return nullptr; }
  std::vector<std::string> groupOrder; if (j.contains("groupOrder") && j["groupOrder"].is_array()) for (auto& k : j["groupOrder"]) groupOrder.push_back(k.get<std::string>());
  return std::unique_ptr<Twin>(new VgdlTwin(j["spec"], j.value("block_size", 1), std::move(levels), info, profile == "rcrl", groupOrder));
}
}
