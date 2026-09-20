// twin_ps.cpp — parity/puzzlescript/src/90_prelude.js in C++ over the rule VM: compile once (the serialised state),
// level = playable[seed % n] (or the fixed level), String(seed) as the RC4 seed, one processInput + again loop per
// step (NOOP does nothing), WIN at `winning`, the 5x5 tile atlas render (cell = object ids ascending, composited over
// the background colour) in one drawTiles call at the flick/zoom viewport, the multihot symbolic observation, and
// the `__ps` hook shapes (snap, tiles) for the gates.
#include "twin.hpp"
#include "p5.hpp"
#include "vm.hpp"
#include "../common/jsnum.hpp"
#include <algorithm>
#include <cstdio>
#include "vfs.hpp"
#include <map>
namespace twin {
using ps::json;
static const int PS_CELL = 5;
static const int PS_ACTION_KEYS[5] = {38, 37, 40, 39, 32};   // UP LEFT DOWN RIGHT ACTION
static const int PS_NOOP = 5;
static bool hexToRgb(const std::string& hex, int rgb[3]) {
  if (hex.size() < 4 || hex[0] != '#') return false;
  std::string h = hex.size() == 4 ? std::string{hex[1], hex[1], hex[2], hex[2], hex[3], hex[3]} : hex.substr(1, 6);
  if (h.size() < 6) return false;
  auto hx = [](const std::string& s) -> int { char* e = nullptr; long v = strtol(s.c_str(), &e, 16); return (e && *e == 0) ? (int)v : 0; };   // parseInt(hex,16): NaN -> 0 through Uint8Array
  rgb[0] = hx(h.substr(0, 2)); rgb[1] = hx(h.substr(2, 2)); rgb[2] = hx(h.substr(4, 2)); return true;
}

class PsTwin : public Twin {
  ps::State S_; ps::VM vm_; json def_; std::vector<int> playable_; std::string levelMode_; int fixedLevel_ = 0;
  int bg_[3] = {0, 0, 0}; int canvasW_ = 0, canvasH_ = 0; uint32_t seed_ = 0; int levelIdx_ = -1;
  double score_ = 0, lives_ = 1; std::string gameState_ = "PLAYING";
  std::vector<uint16_t> kinds_; int kindsW_ = 0, kindsH_ = 0;
  std::vector<std::vector<uint8_t>> atlasTiles_; std::map<std::string, int> atlasIndex_; std::vector<std::string> atlasKeys_; std::vector<uint8_t> atlas_; bool atlasDirty_ = true;
  int symObjects_ = 0, symMW_ = 0, symMH_ = 0, symDim_ = 0;
 public:
  PsTwin(const json& state, const json& def, std::string& err) : def_(def) {
    if (!S_.load(state, err)) return;
    vm_.unitTesting = false; vm_.setState(&S_);
    for (const auto& i : def["playable_levels"]) playable_.push_back(i.get<int>());
    levelMode_ = def.value("level_mode", "seed"); fixedLevel_ = def.contains("level") && def["level"].is_number() ? def["level"].get<int>() : 0;
    if (def.contains("symbolic")) { const json& s = def["symbolic"]; symObjects_ = s.value("objects", 0); symMW_ = s.value("max_width", 0); symMH_ = s.value("max_height", 0); symDim_ = s.value("dim", 0); }
    // psCompile: compile(["loadLevel", playable[0]], text, "0") + agains; canvas from flick/zoom or the largest playable level
    std::string zero = "0"; vm_.compileLoad(playable_.empty() ? 0 : playable_[0], &zero); runAgains();
    if (!hexToRgb(S_.bgcolor, bg_)) { bg_[0] = bg_[1] = bg_[2] = 0; }
    int W = 0, H = 0;
    if (S_.hasFlick) { W = S_.flick[0]; H = S_.flick[1]; } else if (S_.hasZoom) { W = S_.zoom[0]; H = S_.zoom[1]; }
    else for (int i : playable_) if (i >= 0 && i < (int)S_.levels.size()) { W = std::max(W, S_.levels[i].width); H = std::max(H, S_.levels[i].height); }
    canvasW_ = W * PS_CELL; canvasH_ = H * PS_CELL;
  }
  int runAgains() { int n = 0; while (vm_.againing) { vm_.againing = false; vm_.processInput(-1); n++; } return n; }
  void setup() override { p5::createCanvas(canvasW_, canvasH_); }
  void loadLevel(int idx, uint32_t seed) {
    vm_.oldflickscreendat.clear(); vm_.winning = false; vm_.againing = false; vm_.textMode = false; vm_.messagetext.clear();
    std::string sd = std::to_string(seed); vm_.loadLevelFromState(idx, &sd); runAgains();
  }
  void resetGame(uint32_t seed) override {
    seed_ = seed;
    levelIdx_ = levelMode_ == "fixed" ? fixedLevel_ : playable_[seed % (uint32_t)playable_.size()];
    loadLevel(levelIdx_, seed_);
    score_ = 0; lives_ = 1; gameState_ = "PLAYING";
    atlasTiles_.clear(); atlasIndex_.clear(); atlasKeys_.clear(); atlas_.clear(); atlasDirty_ = true;
  }
  int actionFromKeys() const { for (int i = 0; i < 5; i++) if (p5::keyIsDown(PS_ACTION_KEYS[i])) return i; return PS_NOOP; }
  int step(int a) { if (a == PS_NOOP || a < 0 || a > 4) return 0; vm_.processInput(a); return runAgains(); }
  // ---- render ----
  void viewport(int& mini, int& minj, int& maxi, int& maxj) {
    int W = vm_.level.width, H = vm_.level.height; mini = 0; minj = 0; maxi = W; maxj = H;
    if (S_.hasFlick || S_.hasZoom) {
      int sw = S_.hasFlick ? S_.flick[0] : S_.zoom[0], sh = S_.hasFlick ? S_.flick[1] : S_.zoom[1];
      std::vector<int> pp = playerPositions();
      if (!pp.empty()) {
        int px = pp[0] / H, py = pp[0] % H;
        if (S_.hasFlick) { mini = (px / sw) * sw; minj = (py / sh) * sh; maxi = std::min(mini + sw, W); maxj = std::min(minj + sh, H); }
        else { mini = std::max(std::min(px - sw / 2, W - sw), 0); minj = std::max(std::min(py - sh / 2, H - sh), 0); maxi = std::min(mini + sw, W); maxj = std::min(minj + sh, H); }
        vm_.oldflickscreendat = {mini, minj, maxi, maxj};
      } else if (!vm_.oldflickscreendat.empty()) { mini = vm_.oldflickscreendat[0]; minj = vm_.oldflickscreendat[1]; maxi = vm_.oldflickscreendat[2]; maxj = vm_.oldflickscreendat[3]; }
      else { maxi = std::min(sw, W); maxj = std::min(sh, H); }
    }
  }
  std::vector<int> playerPositions() const {
    std::vector<int> r; const int32_t* o = vm_.level.objects.data();
    for (int i = 0; i < vm_.level.n_tiles; i++) { const int32_t* c = o + (size_t)i * S_.SO; if (S_.playerAggregate ? ps::bvSubset(S_.playerMask, c) : !ps::bvClearIn(S_.playerMask, c)) r.push_back(i); }
    return r;
  }
  std::vector<uint8_t> compositeTile(const std::vector<int>& ids) const {
    std::vector<uint8_t> t(PS_CELL * PS_CELL * 4);
    for (int p = 0; p < PS_CELL * PS_CELL; p++) { t[p * 4] = bg_[0]; t[p * 4 + 1] = bg_[1]; t[p * 4 + 2] = bg_[2]; t[p * 4 + 3] = 255; }
    for (int k : ids) {
      if (k < 0 || k >= (int)S_.objects.size()) continue; const ps::State::Obj& sp = S_.objects[k];
      for (int j = 0; j < PS_CELL; j++) for (int i = 0; i < PS_CELL; i++) {
        if (j >= (int)sp.sprite.size() || i >= (int)sp.sprite[j].size()) continue;
        int v = sp.sprite[j][i]; if (v < 0) continue;
        int rgb[3]; if (v >= (int)sp.colors.size() || !hexToRgb(sp.colors[v], rgb)) continue;
        int o = (j * PS_CELL + i) * 4; t[o] = rgb[0]; t[o + 1] = rgb[1]; t[o + 2] = rgb[2];
      }
    }
    return t;
  }
  int tileFor(const std::vector<int>& ids) {
    std::string key; for (size_t k = 0; k < ids.size(); k++) { if (k) key += ","; key += std::to_string(ids[k]); }
    auto it = atlasIndex_.find(key); if (it != atlasIndex_.end()) return it->second;
    int idx = (int)atlasTiles_.size(); atlasIndex_[key] = idx; atlasKeys_.push_back(key); atlasTiles_.push_back(compositeTile(ids)); atlasDirty_ = true; return idx;
  }
  void cellIds(int pos, std::vector<int>& ids) const { ids.clear(); const int32_t* c = vm_.level.objects.data() + (size_t)pos * S_.SO; for (int k = 0; k < S_.objectCount; k++) if (c[k >> 5] & (int32_t)(1u << (k & 31))) ids.push_back(k); }
  void render() {
    p5::background(bg_[0], bg_[1], bg_[2]);
    if (vm_.level.objects.empty()) return;
    int mini, minj, maxi, maxj; viewport(mini, minj, maxi, maxj);
    int w = maxi - mini, h = maxj - minj; if (w <= 0 || h <= 0) return;
    if (kindsW_ != w || kindsH_ != h) { kinds_.assign((size_t)w * h, 0); kindsW_ = w; kindsH_ = h; }
    std::vector<int> ids;
    for (int i = mini; i < maxi; i++) for (int j = minj; j < maxj; j++) { cellIds(j + i * vm_.level.height, ids); kinds_[(size_t)(j - minj) * w + (i - mini)] = (uint16_t)tileFor(ids); }
    if (atlasDirty_) { atlas_.resize(atlasTiles_.size() * PS_CELL * PS_CELL * 4); for (size_t t = 0; t < atlasTiles_.size(); t++) std::copy(atlasTiles_[t].begin(), atlasTiles_[t].end(), atlas_.begin() + t * PS_CELL * PS_CELL * 4); atlasDirty_ = false; }
    int x = (int)std::floor((canvasW_ - w * PS_CELL) / 2.0), y = (int)std::floor((canvasH_ - h * PS_CELL) / 2.0);
    p5::drawTiles(kinds_.data(), w, h, atlas_.data(), PS_CELL, (int)atlasTiles_.size(), x, y, w * PS_CELL, h * PS_CELL);
  }
  void draw() override {
    if (levelIdx_ < 0) resetGame(0);
    if (gameState_ == "PLAYING") { step(actionFromKeys()); if (vm_.winning) { score_ = 1; gameState_ = "WIN"; } }
    render();
  }
  int hookStep(int action) override { int n = step(action); if (vm_.winning) { score_ = 1; gameState_ = "WIN"; } return n; }
  GameState getGameState() override { GameState g; g.score = score_; g.lives = lives_; g.gameState = gameState_; return g; }
  int symbolicDim() const override { return symDim_; }
  void getObservation(float* out, int dim) override {
    std::fill(out, out + dim, 0.0f);
    if (vm_.level.objects.empty()) return;
    int W = vm_.level.width, H = vm_.level.height;
    for (int x = 0; x < W && x < symMW_; x++) for (int y = 0; y < H && y < symMH_; y++) {
      const int32_t* c = vm_.level.objects.data() + (size_t)(y + x * H) * S_.SO;
      for (int k = 0; k < symObjects_; k++) if (c[k >> 5] & (int32_t)(1u << (k & 31))) { int idx = (k * symMH_ + y) * symMW_ + x; if (idx < dim) out[idx] = 1.0f; }
    }
  }
  std::string snapshot() const override {
    // JSON.stringify(__ps.snap()) key order: level, objects, curlevel, winning, againing, textMode, messagetext, backups, movements_zero, rng{i,j,s}, width, height
    std::string s = "{\"level\":" + json(vm_.levelString()).dump() + ",\"objects\":[";
    for (size_t k = 0; k < vm_.level.objects.size(); k++) { if (k) s += ","; s += std::to_string(vm_.level.objects[k]); }
    s += "],\"curlevel\":" + std::to_string(vm_.curlevel) + ",\"winning\":" + (vm_.winning ? "true" : "false") + ",\"againing\":" + (vm_.againing ? "true" : "false") + ",\"textMode\":" + (vm_.textMode ? "true" : "false");
    s += ",\"messagetext\":" + json(vm_.messagetext).dump() + ",\"backups\":" + std::to_string(vm_.backups.size());
    bool mz = true; for (int32_t v : vm_.level.movements) if (v) { mz = false; break; }
    s += ",\"movements_zero\":" + std::string(mz ? "true" : "false") + ",\"rng\":{\"i\":" + std::to_string(vm_.rng.i) + ",\"j\":" + std::to_string(vm_.rng.j) + ",\"s\":[";
    for (int k = 0; k < 256; k++) { if (k) s += ","; s += std::to_string(vm_.rng.s[k]); }
    s += "]},\"width\":" + std::to_string(vm_.level.width) + ",\"height\":" + std::to_string(vm_.level.height) + "}";
    return s;
  }
  std::string renderSnapshot() override {
    render(); int mini, minj, maxi, maxj; viewport(mini, minj, maxi, maxj);
    std::string s = "{\"viewport\":[" + std::to_string(mini) + "," + std::to_string(minj) + "," + std::to_string(maxi) + "," + std::to_string(maxj) + "],\"kinds\":[";
    for (size_t k = 0; k < (size_t)kindsW_ * kindsH_; k++) { if (k) s += ","; s += std::to_string(kinds_[k]); }
    s += "],\"keys\":["; for (size_t k = 0; k < atlasKeys_.size(); k++) { if (k) s += ","; s += json(atlasKeys_[k]).dump(); }
    s += "],\"w\":" + std::to_string(kindsW_) + ",\"h\":" + std::to_string(kindsH_) + "}";
    return s;
  }
};

std::unique_ptr<Twin> make_puzzlescript_twin(const GameInfo& info, std::string& err) {
  std::string sp = info.dir + "/twin/state/ps_" + info.game + ".json", dp = info.dir + "/games/" + info.game + ".json";
  std::string st, dt;
  if (!readFile(sp, st)) { err = "puzzlescript: no twin state at " + sp + " (run tools/twin_state.mjs --games)"; return nullptr; }
  if (!readFile(dp, dt)) { err = "puzzlescript: no game def at " + dp; return nullptr; }
  json state, def; try { state = json::parse(st); def = json::parse(dt); } catch (const std::exception& e) { err = std::string("puzzlescript: bad JSON: ") + e.what(); return nullptr; }
  std::unique_ptr<PsTwin> t(new PsTwin(state, def, err));
  if (!err.empty()) return nullptr;
  return std::unique_ptr<Twin>(t.release());
}
}
