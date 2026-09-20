// registry.cpp — bundle path -> sidecar -> family/game -> twin. The sidecar (dist/<name>.json) names the family and
// the game; the family directory is dist/.. and holds games/*.json, roms/, and the serialised specs the twins load.
#include "twin.hpp"
#include "vfs.hpp"
#include <cstdlib>
#include <fstream>
#include <sstream>
#include "../third_party/json.hpp"

namespace twin {

static std::string dirname_of(const std::string& p) {
  size_t i = p.find_last_of('/');
  return i == std::string::npos ? std::string(".") : p.substr(0, i);
}

bool read_game_info(const std::string& game_path, GameInfo& info, std::string& err) {
  std::string side_path = game_path;
  if (side_path.size() > 3 && side_path.compare(side_path.size() - 3, 3, ".js") == 0) side_path = side_path.substr(0, side_path.size() - 3) + ".json";
  else side_path += ".json";
  std::string text;
  if (!readFile(side_path, text)) { err = "twin: no sidecar at " + side_path; return false; }
  nlohmann::json side;
  try { side = nlohmann::json::parse(text); } catch (const std::exception& e) { err = std::string("twin: bad sidecar JSON: ") + e.what(); return false; }
  info.family = side.value("family", "");
  info.game = side.value("game", "");
  info.corpus = side.value("corpus", ""); info.level_mode = side.value("level_mode", "seed"); info.render = side.value("render", "tiles");
  info.level_index = side.contains("level_index") && side["level_index"].is_number() ? side["level_index"].get<int>() : 0;
  info.dir = dirname_of(dirname_of(game_path));
  info.actions_held.clear(); info.action_names.clear();
  if (side.contains("actions")) for (const auto& a : side["actions"]) {
    std::vector<int> held; if (a.contains("held")) for (const auto& k : a["held"]) held.push_back(k.get<int>());
    info.actions_held.push_back(held); info.action_names.push_back(a.value("name", ""));
  }
  info.symbolic_dim = 0;
  if (side.contains("obs") && side["obs"].contains("symbolic") && side["obs"]["symbolic"].is_number()) info.symbolic_dim = side["obs"]["symbolic"].get<int>();
  if (info.family.empty()) { err = "twin: sidecar has no family: " + side_path; return false; }
  return true;
}

std::unique_ptr<Twin> make_twin(const GameInfo& info, std::string& err) {
  if (getenv("TWIN_BLANK")) return make_blank_twin(info, err);
  std::unique_ptr<Twin> t;
  if (info.family == "chip8") t = make_chip8_twin(info, err);
  else if (info.family == "vgdl") t = make_vgdl_twin(info, err);
  else if (info.family == "puzzlescript") t = make_puzzlescript_twin(info, err);
  else { err = "twin: no twin for family '" + info.family + "'"; return nullptr; }
  if (!t && err.empty()) err = "twin: family '" + info.family + "' has no twin yet";
  return t;
}

// Families without a twin yet: stubs the real twin_*.cpp files replace (each defines its own factory; the
// build script compiles exactly one definition per family).
#ifndef TWIN_HAVE_CHIP8
std::unique_ptr<Twin> make_chip8_twin(const GameInfo&, std::string& err) { err = "twin: chip8 twin not built"; return nullptr; }
#endif
#ifndef TWIN_HAVE_VGDL
std::unique_ptr<Twin> make_vgdl_twin(const GameInfo&, std::string& err) { err = "twin: vgdl twin not built"; return nullptr; }
#endif
#ifndef TWIN_HAVE_PUZZLESCRIPT
std::unique_ptr<Twin> make_puzzlescript_twin(const GameInfo&, std::string& err) { err = "twin: puzzlescript twin not built"; return nullptr; }
#endif

}  // namespace twin
