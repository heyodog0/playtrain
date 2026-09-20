// vm.cpp — engine.js's runtime, line for line where it matters (see vm.hpp). Index layout is the engine's:
// index = x * height + y; delta_index(dir) = dx * height + dy.
#include "vm.hpp"
#include <algorithm>
#include <cmath>
namespace ps {
static BV toBV(const json& j) { BV v; for (const auto& x : j) v.push_back((int32_t)x.get<long long>()); return v; }
static const int DIR_DELTA[17][2] = {{0, 0}, {0, -1}, {0, 1}, {0, 0}, {-1, 0}, {0, 0}, {0, 0}, {0, 0}, {1, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}};
static bool dirKnown(int m) { return m == 1 || m == 2 || m == 4 || m == 8 || m == 15 || m == 16 || m == 3; }

bool State::load(const json& j, std::string& err) {
  try {
    SO = j["STRIDE_OBJ"]; SM = j["STRIDE_MOV"]; LAYER_COUNT = j["LAYER_COUNT"]; objectCount = j["objectCount"];
    idDict.clear(); for (const auto& n : j["idDict"]) idDict.push_back(n.is_string() ? n.get<std::string>() : "");
    objLayer.assign(idDict.size(), 0); for (const auto& o : j["objects"]) { int id = o["id"]; if (id >= 0 && id < (int)objLayer.size()) objLayer[id] = o["layer"]; }
    layerMasks.clear(); for (const auto& m : j["layerMasks"]) layerMasks.push_back(toBV(m));
    playerAggregate = j["playerMask"][0].get<bool>(); playerMask = toBV(j["playerMask"][1]);
    const json& md = j["metadata"];
    run_rules_on_level_start = md.contains("run_rules_on_level_start"); require_player_movement = md.contains("require_player_movement");
    noundo = md.contains("noundo"); norestart = md.contains("norestart");
    hasFlick = md.contains("flickscreen") && md["flickscreen"].is_array(); if (hasFlick) { flick[0] = md["flickscreen"][0]; flick[1] = md["flickscreen"][1]; }
    hasZoom = md.contains("zoomscreen") && md["zoomscreen"].is_array(); if (hasZoom) { zoom[0] = md["zoomscreen"][0]; zoom[1] = md["zoomscreen"][1]; }
    if (j.contains("bgcolor") && j["bgcolor"].is_string()) bgcolor = j["bgcolor"];
    objects.clear(); for (const auto& o : j["objects"]) { Obj x; x.name = o["name"]; x.id = o["id"]; x.layer = o["layer"]; if (o["colors"].is_array()) for (const auto& c : o["colors"]) x.colors.push_back(c.is_string() ? c.get<std::string>() : ""); if (o["sprite"].is_array()) for (const auto& row : o["sprite"]) { std::vector<int> r; for (const auto& v : row) r.push_back(v.is_number() ? v.get<int>() : -1); x.sprite.push_back(r); } objects.push_back(x); }
    rigid = j["rigid"].get<bool>();
    rigidGroupIndex_to_GroupIndex.clear(); for (const auto& x : j["rigidGroupIndex_to_GroupIndex"]) rigidGroupIndex_to_GroupIndex.push_back(x.is_null() ? -1 : x.get<int>());
    groupNumber_to_RigidGroupIndex.clear(); for (auto it = j["groupNumber_to_RigidGroupIndex"].begin(); it != j["groupNumber_to_RigidGroupIndex"].end(); ++it) groupNumber_to_RigidGroupIndex[std::stoi(it.key())] = it.value().get<int>();
    winconditions.clear(); for (const auto& w : j["winconditions"]) { Win x; x.kind = w[0]; x.f1 = toBV(w[1]); x.f2 = toBV(w[2]); x.aggr1 = w[3].get<bool>(); x.aggr2 = w[4].get<bool>(); winconditions.push_back(x); }
    levels.clear(); for (const auto& l : j["levels"]) { LevelDef d; if (l.contains("message")) { d.message = true; d.messageText = l["message"].is_string() ? l["message"].get<std::string>() : ""; } else { d.width = l["width"]; d.height = l["height"]; for (const auto& x : l["objects"]) d.objects.push_back((int32_t)x.get<long long>()); } levels.push_back(d); }
    auto loadRules = [&](const json& groups, std::vector<std::vector<Rule>>& out) {
      out.clear();
      for (const auto& g : groups) { std::vector<Rule> grp;
        for (const auto& r : g) { Rule R; R.dir = r["dir"]; R.hasRep = r["hasRep"]; R.line = r["line"]; for (const auto& e : r["ell"]) R.ell.push_back(e); R.group = r["group"]; R.rigid = r["rigid"]; R.random = r["random"];
          for (const auto& c : r["commands"]) { std::vector<std::string> cmd; for (const auto& x : c) cmd.push_back(x.is_string() ? x.get<std::string>() : x.is_null() ? "" : x.dump()); R.commands.push_back(cmd); }
          for (const auto& m : r["crm"]) R.crm.push_back(toBV(m)); for (const auto& m : r["crmm"]) R.crmm.push_back(toBV(m)); R.ruleMask = toBV(r["ruleMask"]);
          for (const auto& row : r["patterns"]) { std::vector<Cell> cells;
            for (const auto& c : row) { Cell C; if (c.is_null()) { C.ellipsis = true; cells.push_back(C); continue; }
              C.op = toBV(c["op"]); C.om = toBV(c["om"]); C.mp = toBV(c["mp"]); C.mm = toBV(c["mm"]); for (const auto& a : c["aop"]) C.aop.push_back(toBV(a));
              if (!c["rep"].is_null()) { const json& p = c["rep"]; C.hasRep = true; C.rep.oc = toBV(p["oc"]); C.rep.os = toBV(p["os"]); C.rep.mc = toBV(p["mc"]); C.rep.ms = toBV(p["ms"]); C.rep.mlm = toBV(p["mlm"]); C.rep.rem = toBV(p["rem"]); C.rep.rdm = toBV(p["rdm"]); }
              cells.push_back(C); }
            R.patterns.push_back(cells); }
          grp.push_back(R); }
        out.push_back(grp); }
    };
    loadRules(j["rules"], rules); loadRules(j["lateRules"], lateRules);
    loopPoint.clear(); for (auto it = j["loopPoint"].begin(); it != j["loopPoint"].end(); ++it) loopPoint[std::stoi(it.key())] = it.value().get<int>();
    lateLoopPoint.clear(); for (auto it = j["lateLoopPoint"].begin(); it != j["lateLoopPoint"].end(); ++it) lateLoopPoint[std::stoi(it.key())] = it.value().get<int>();
    auto sfx = [&](const json& e) { SfxEntry s; s.objectMask = toBV(e["objectMask"]); if (e.contains("directionMask") && !e["directionMask"].is_null()) s.directionMask = toBV(e["directionMask"]); if (e.contains("layer") && e["layer"].is_number()) s.layer = e["layer"]; s.seed = e["seed"].is_string() ? e["seed"].get<std::string>() : e["seed"].dump(); return s; };
    const json& X = j["sfx"]; sfxCreation.clear(); sfxDestruction.clear(); sfxMovementFailure.clear(); sfxMovement.clear();
    for (const auto& e : X["creation"]) sfxCreation.push_back(sfx(e)); for (const auto& e : X["destruction"]) sfxDestruction.push_back(sfx(e));
    for (const auto& e : X["movementFailure"]) sfxMovementFailure.push_back(sfx(e)); for (const auto& l : X["movement"]) { std::vector<SfxEntry> v; for (const auto& e : l) v.push_back(sfx(e)); sfxMovement.push_back(v); }
    while ((int)sfxMovement.size() < LAYER_COUNT) sfxMovement.push_back({});
  } catch (const std::exception& e) { err = std::string("ps state: ") + e.what(); return false; }
  return true;
}

// ---------- level plumbing ----------
void VM::setState(const State* s) { S = s; sfxCreateMask.assign(S->SO, 0); sfxDestroyMask.assign(S->SO, 0); backups.clear(); hasRestartTarget = false; hasUsedCheckpoint = false; winning = false; againing = false; messagetext.clear(); }
void VM::rebuildLevelArrays() {
  level.n_tiles = level.width * level.height;
  level.movements.assign((size_t)level.n_tiles * S->SM, 0);
  level.rigidMovementAppliedMask.clear(); level.rigidGroupIndexMask.clear();
  level.rowCellContents.assign(level.height, BV(S->SO, 0)); level.rowCellContents_Movements.assign(level.height, BV(S->SM, 0));
  level.colCellContents.assign(level.width, BV(S->SO, 0)); level.colCellContents_Movements.assign(level.width, BV(S->SM, 0));
  level.mapCellContents.assign(S->SO, 0); level.mapCellContents_Movements.assign(S->SM, 0);
  if (S->rigid) { level.rigidMovementAppliedMask.assign(level.n_tiles, BV(S->SM, 0)); level.rigidGroupIndexMask.assign(level.n_tiles, BV(S->SM, 0)); }
}
Backup VM::backupLevel() const { Backup b; b.dat = level.objects; b.width = level.width; b.height = level.height; b.ofd = oldflickscreendat; return b; }
static void applyDiff(const Backup& diff, std::vector<int32_t>& objs) {
  size_t index = 0;
  while (index < diff.dat.size()) {
    int start = diff.dat[index], len = diff.dat[index + 1];
    if (len == 0) break;
    for (int j = 0; j < len; j++) objs[start + j] = diff.dat[index + 2 + j];
    index += 2 + len;
  }
}
static Backup unconsolidateDiff(const Backup& before, const Backup& after) {
  if (!before.diff) return before;
  Backup b; b.dat = after.dat; applyDiff(before, b.dat); b.width = before.width; b.height = before.height; b.ofd = before.ofd; return b;
}
static Backup consolidateDiff(const Backup& before, const Backup& after) {
  if (before.width != after.width || before.height != after.height || before.dat.size() != after.dat.size()) return before;
  if (before.diff || after.diff) return before;
  if (before.dat.size() < 1024) return before;
  std::vector<int32_t> result(128, 0); size_t position = 0; bool chain = false; size_t chainStart = 0;
  for (size_t i = 0; i < before.dat.size(); i++) {
    if (!chain) {
      if (before.dat[i] != after.dat[i]) { chain = true; chainStart = position; if (result.size() < position + 4) result.resize(result.size() * 2, 0); result[position] = (int32_t)i; result[position + 1] = 1; result[position + 2] = before.dat[i]; position += 3; }
    } else {
      if (before.dat[i] != after.dat[i]) { if (position + 1 >= result.size()) { if (result.size() < position + 4) result.resize(result.size() * 2, 0); } result[chainStart + 1]++; result[position] = before.dat[i]; position++; }
      else chain = false;
    }
  }
  Backup b; b.diff = true; b.dat = result; b.width = before.width; b.height = before.height; b.ofd = before.ofd; return b;
}
void VM::addUndoState(const Backup& b) {
  backups.push_back(b);
  if (backups.size() > 2 && !backups[backups.size() - 1].diff) backups[backups.size() - 3] = consolidateDiff(backups[backups.size() - 3], backups[backups.size() - 2]);
}
void VM::restoreLevel(const Backup& lev) {
  oldflickscreendat = lev.ofd;
  if (lev.diff) applyDiff(lev, level.objects); else level.objects = lev.dat;
  if (level.width != lev.width || level.height != lev.height) { level.width = lev.width; level.height = lev.height; level.n_tiles = lev.width * lev.height; rebuildLevelArrays(); }
  else {
    for (int i = 0; i < level.n_tiles; i++) level.movements[i] = 0;   // engine.js zeroes n_tiles entries, not n_tiles * STRIDE_MOV
    if (S->rigid) for (int i = 0; i < level.n_tiles; i++) { std::fill(level.rigidMovementAppliedMask[i].begin(), level.rigidMovementAppliedMask[i].end(), 0); std::fill(level.rigidGroupIndexMask[i].begin(), level.rigidGroupIndexMask[i].end(), 0); }
    for (auto& r : level.rowCellContents) std::fill(r.begin(), r.end(), 0);
    for (auto& c : level.colCellContents) std::fill(c.begin(), c.end(), 0);
  }
  againing = false; level.commandQueue.clear(); level.commandQueueSourceRules.clear(); level.commandMessage.clear();
}
bool VM::backupDiffers() const {
  if (backups.empty()) return true;
  const Backup& bak = backups.back();
  if (bak.diff) return bak.dat.size() != 0 && bak.dat[1] != 0;
  for (size_t i = 0; i < level.objects.size(); i++) if (level.objects[i] != bak.dat[i]) return true;
  return false;
}
void VM::doRestart(bool force) {
  if (restarting) return;
  if (!force && S->norestart) return;
  if (againing) doUndo(force, true);
  restarting = true;
  if (!force) addUndoState(backupLevel());
  if (hasRestartTarget) restoreLevel(restartTarget);
  if (S->run_rules_on_level_start) processInput(-1, true);
  level.commandQueue.clear(); level.commandQueueSourceRules.clear(); level.commandMessage.clear();
  restarting = false;
}
void VM::doUndo(bool force, bool ignoreDuplicates) {
  if (S->noundo && !force) return;
  if (ignoreDuplicates) while (!backupDiffers()) backups.pop_back();
  if (!backups.empty()) { Backup b = backups.back(); restoreLevel(b); backups.pop_back(); }
}
void VM::loadLevelFromLevelDat(const LevelDef* dat, const std::string* seed) {
  std::string sd = seed ? *seed : std::string("0.0000000000000000");   // JS: (Math.random() + Date.now()).toString(); unseeded games are not gated
  rng.init(sd);
  titleScreen = false; againing = false;
  if (!dat) return;
  if (!dat->message) {
    textMode = false;
    level.width = dat->width; level.height = dat->height; level.objects = dat->objects; rebuildLevelArrays();
    if (S->hasFlick) oldflickscreendat = {0, 0, std::min(S->flick[0], level.width), std::min(S->flick[1], level.height)};
    else if (S->hasZoom) oldflickscreendat = {0, 0, std::min(S->zoom[0], level.width), std::min(S->zoom[1], level.height)};
    level.commandQueue.clear(); level.commandQueueSourceRules.clear(); level.commandMessage.clear();
    backups.clear(); restartTarget = backupLevel(); hasRestartTarget = true;
    if (S->run_rules_on_level_start) { runrulesonlevelstart_phase = true; processInput(-1, true); runrulesonlevelstart_phase = false; }
  } else {
    textMode = true;   // drawMessageScreen
  }
}
void VM::loadLevelFromState(int levelIndex, const std::string* seed) {
  curlevel = levelIndex;
  loadLevelFromLevelDat(levelIndex >= 0 && levelIndex < (int)S->levels.size() ? &S->levels[levelIndex] : nullptr, seed);
}
void VM::compileLoad(int levelIndex, const std::string* seed) {
  // setGameState(state, ["loadLevel", i], seed)
  winning = false; againing = false; backups.clear(); oldflickscreendat.clear();
  sfxCreateMask.assign(S->SO, 0); sfxDestroyMask.assign(S->SO, 0);
  curlevel = levelIndex; titleScreen = false; textMode = false;
  loadLevelFromState(levelIndex, seed);
  soundHistory.clear();   // clearInputHistory() at the end of compile()
}

// ---------- players / movement ----------
std::vector<int> VM::getPlayerPositions() const {
  std::vector<int> r; const int32_t* o = level.objects.data();
  for (int i = 0; i < level.n_tiles; i++) { const int32_t* c = o + (size_t)i * S->SO; if (S->playerAggregate ? bvSubset(S->playerMask, c) : !bvClearIn(S->playerMask, c)) r.push_back(i); }
  return r;
}
void VM::moveEntitiesAtIndex(int pos, const BV& entityMask, int dirMask) {
  int SO = S->SO, SM = S->SM; const int32_t* cell = level.objects.data() + (size_t)pos * SO;
  BV movementMask(level.movements.begin() + (size_t)pos * SM, level.movements.begin() + (size_t)(pos + 1) * SM);
  for (int i = 0; i < S->objectCount; i++) if (bvGet(entityMask, i) && (cell[i >> 5] & (int32_t)(1u << (i & 31)))) bvShiftOr(movementMask, dirMask, 5 * S->objLayer[i]);
  for (int i = 0; i < SM; i++) level.movements[(size_t)pos * SM + i] = movementMask[i];
  int col = pos / level.height, row = pos % level.height;
  for (int i = 0; i < SM; i++) { level.colCellContents_Movements[col][i] |= movementMask[i]; level.rowCellContents_Movements[row][i] |= movementMask[i]; level.mapCellContents_Movements[i] |= movementMask[i]; }
}
std::vector<int> VM::startMovement(int dir) {
  std::vector<int> pp = getPlayerPositions();
  for (int p : pp) moveEntitiesAtIndex(p, S->playerMask, dir);
  return pp;
}
void VM::calculateRowColMasks() {
  int SO = S->SO, SM = S->SM;
  std::fill(level.mapCellContents.begin(), level.mapCellContents.end(), 0); std::fill(level.mapCellContents_Movements.begin(), level.mapCellContents_Movements.end(), 0);
  for (auto& c : level.colCellContents) std::fill(c.begin(), c.end(), 0); for (auto& c : level.colCellContents_Movements) std::fill(c.begin(), c.end(), 0);
  for (auto& r : level.rowCellContents) std::fill(r.begin(), r.end(), 0); for (auto& r : level.rowCellContents_Movements) std::fill(r.begin(), r.end(), 0);
  for (int i = 0; i < level.width; i++) for (int j = 0; j < level.height; j++) {
    int index = j + i * level.height; const int32_t* c = level.objects.data() + (size_t)index * SO; const int32_t* m = level.movements.data() + (size_t)index * SM;
    for (int w = 0; w < SO; w++) { level.mapCellContents[w] |= c[w]; level.rowCellContents[j][w] |= c[w]; level.colCellContents[i][w] |= c[w]; }
    for (int w = 0; w < SM; w++) { level.mapCellContents_Movements[w] |= m[w]; level.rowCellContents_Movements[j][w] |= m[w]; level.colCellContents_Movements[i][w] |= m[w]; }
  }
}
int VM::deltaIndex(int dir) const { return dirKnown(dir) ? DIR_DELTA[dir][0] * level.height + DIR_DELTA[dir][1] : 0; }

// ---------- matching ----------
bool VM::cellMatches(const Cell& c, int i) const {
  const int32_t* co = level.objects.data() + (size_t)i * S->SO; const int32_t* cm = level.movements.data() + (size_t)i * S->SM;
  int n = std::max(S->SO, S->SM);
  for (int w = 0; w < n; w++) {
    int32_t op = w < S->SO ? c.op[w] : 0, om = w < S->SO ? c.om[w] : 0, mp = w < S->SM ? c.mp[w] : 0, mm = w < S->SM ? c.mm[w] : 0;
    if (op && (co[w] & op) != op) return false;
    if (om && (co[w] & om)) return false;
    if (mp && (cm[w] & mp) != mp) return false;
    if (mm && (cm[w] & mm)) return false;
  }
  for (const BV& a : c.aop) { int32_t acc = 0; for (int w = 0; w < S->SO; w++) if (a[w]) acc |= (co[w] & a[w]); if (!acc) return false; }
  return true;
}
bool VM::rowMatches0(const std::vector<Cell>& row, int i, int d) const {
  for (size_t k = 0; k < row.size(); k++) if (!cellMatches(row[k], i + (int)k * d)) return false;
  return true;
}
void VM::rowMatches1(const std::vector<Cell>& row, int i, int kmax, int kmin, int d, std::vector<std::vector<int>>& out) const {
  size_t e = 0; while (e < row.size() && !row[e].ellipsis) e++;
  for (size_t c = 0; c < e; c++) if (!cellMatches(row[c], i + (int)c * d)) return;
  for (int k = kmin; k < kmax; k++) {
    bool ok = true;
    for (size_t c = e + 1; c < row.size() && ok; c++) if (!cellMatches(row[c], i + d * (k + (int)c - 1))) ok = false;
    if (ok) out.push_back({i, k});
  }
}
void VM::rowMatches2(const std::vector<Cell>& row, int i, int kmax, int kmin, int k1max, int k1min, int k2max, int k2min, int d, std::vector<std::vector<int>>& out) const {
  int e1 = -1, e2 = -1; for (size_t c = 0; c < row.size(); c++) if (row[c].ellipsis) { if (e1 < 0) e1 = (int)c; else { e2 = (int)c; break; } }
  for (int c = 0; c < e1; c++) if (!cellMatches(row[c], i + c * d)) return;
  for (int k1 = k1min; k1 < k1max; k1++) {
    bool ok = true; for (int c = e1 + 1; c < e2 && ok; c++) if (!cellMatches(row[c], i + d * (k1 + c - 1))) ok = false;
    if (!ok) continue;
    for (int k2 = k2min; k1 + k2 < kmax && k2 < k2max; k2++) {
      bool ok2 = true; for (int c = e2 + 1; c < (int)row.size() && ok2; c++) if (!cellMatches(row[c], i + d * (k1 + k2 + c - 2))) ok2 = false;
      if (ok2) out.push_back({i, k1, k2});
    }
  }
}
// matchCellRow / matchCellRowWildCard: out receives [i] tuples (ell 0) or [i,k..] tuples
bool VM::matchRow(const Rule& r, int ri, int d, std::vector<std::vector<int>>& out) const {
  const std::vector<Cell>& row = r.patterns[ri]; int ell = r.ell[ri];
  if (!bvSubset(r.crm[ri], level.mapCellContents.data()) || !bvSubset(r.crmm[ri], level.mapCellContents_Movements.data())) return false;
  int xmin = 0, xmax = level.width, ymin = 0, ymax = level.height;
  int len = (int)row.size() - (ell == 0 ? 0 : ell);
  switch (r.dir) { case 1: ymin += len - 1; break; case 2: ymax -= len - 1; break; case 4: xmin += len - 1; break; case 8: xmax -= len - 1; break; default: break; }
  bool horizontal = r.dir > 2;
  auto tryCell = [&](int x, int y) {
    int i = x * level.height + y;
    if (ell == 0) { if (rowMatches0(row, i, d)) out.push_back({i}); return; }
    int kmax = 0;
    if (r.dir == 4) kmax = x - len + 2; else if (r.dir == 8) kmax = level.width - (x + len) + 1; else if (r.dir == 2) kmax = level.height - (y + len) + 1; else if (r.dir == 1) kmax = y - len + 2;
    if (ell == 1) rowMatches1(row, i, kmax, 0, d, out); else rowMatches2(row, i, kmax, 0, kmax, 0, kmax, 0, d, out);
  };
  if (horizontal) {
    for (int y = ymin; y < ymax; y++) { if (!bvSubset(r.crm[ri], level.rowCellContents[y].data()) || !bvSubset(r.crmm[ri], level.rowCellContents_Movements[y].data())) continue; for (int x = xmin; x < xmax; x++) tryCell(x, y); }
  } else {
    for (int x = xmin; x < xmax; x++) { if (!bvSubset(r.crm[ri], level.colCellContents[x].data()) || !bvSubset(r.crmm[ri], level.colCellContents_Movements[x].data())) continue; for (int y = ymin; y < ymax; y++) tryCell(x, y); }
  }
  return !out.empty();
}
bool VM::findMatches(const Rule& r, std::vector<std::vector<std::vector<int>>>& matches) const {
  matches.clear();
  if (!bvSubset(r.ruleMask, level.mapCellContents.data())) return false;
  int d = deltaIndex(r.dir);
  for (size_t ri = 0; ri < r.patterns.size(); ri++) { std::vector<std::vector<int>> m; if (!matchRow(r, (int)ri, d, m)) { matches.clear(); return false; } matches.push_back(std::move(m)); }
  return true;
}
// generateTuples: for each row, for each value, for each existing tuple -> tuple + value (first row varies fastest)
static std::vector<std::vector<std::vector<int>>> generateTuples(const std::vector<std::vector<std::vector<int>>>& lists) {
  std::vector<std::vector<std::vector<int>>> tuples(1);
  for (const auto& row : lists) { std::vector<std::vector<std::vector<int>>> nt; for (const auto& val : row) for (const auto& t : tuples) { auto n = t; n.push_back(val); nt.push_back(std::move(n)); } tuples = std::move(nt); }
  return tuples;
}

// ---------- replacement ----------
bool VM::replaceCell(const Cell& c, const Rule& rule, int idx) {
  if (!c.hasRep) return false;
  int SO = S->SO, SM = S->SM; const Replacement& rep = c.rep;
  BV objectsSet = rep.os, objectsClear = rep.oc, movementsSet = rep.ms, movementsClear(SM);
  for (int i = 0; i < SM; i++) movementsClear[i] = rep.mc[i] | rep.mlm[i];
  if (!bvZero(rep.rem)) {
    std::vector<int> choices; for (int i = 0; i < 32 * SO; i++) if (bvGet(rep.rem, i)) choices.push_back(i);
    int rand = choices[(size_t)std::floor(rng.uniform() * choices.size())];
    int layer = S->objLayer[rand];
    bvSet(objectsSet, rand); for (int i = 0; i < SO; i++) objectsClear[i] |= S->layerMasks[layer][i];
    bvShiftOr(movementsClear, 0x1f, 5 * layer);
  }
  if (!bvZero(rep.rdm)) {
    for (int layer = 0; layer < S->LAYER_COUNT; layer++) if (bvGet(rep.rdm, 5 * layer)) { int randomDir = (int)std::floor(rng.uniform() * 4); bvSet(movementsSet, randomDir + 5 * layer); }
  }
  int32_t* cell = level.objects.data() + (size_t)idx * SO; int32_t* mov = level.movements.data() + (size_t)idx * SM;
  BV oldCell(cell, cell + SO), cur(SO), oldMov(mov, mov + SM), curMov(SM);
  for (int i = 0; i < SO; i++) cur[i] = (oldCell[i] & ~objectsClear[i]) | objectsSet[i];
  for (int i = 0; i < SM; i++) curMov[i] = (oldMov[i] & ~movementsClear[i]) | movementsSet[i];
  bool rigidchange = false;
  if (rule.rigid) {
    auto it = S->groupNumber_to_RigidGroupIndex.find(rule.group); int rgi = (it == S->groupNumber_to_RigidGroupIndex.end() ? 0 : it->second) + 1;
    BV rigidMask(SM, 0); for (int layer = 0; layer < S->LAYER_COUNT; layer++) bvShiftOr(rigidMask, rgi, layer * 5);
    for (int i = 0; i < SM; i++) rigidMask[i] &= rep.mlm[i];
    BV scratchA(SM, 0), scratchB(SM, 0);
    BV& curRGI = S->rigid ? level.rigidGroupIndexMask[idx] : scratchA; BV& curRMA = S->rigid ? level.rigidMovementAppliedMask[idx] : scratchB;
    if (!bvSubset(rigidMask, curRGI.data()) && !bvSubset(rep.mlm, curRMA.data())) {
      for (int i = 0; i < SM; i++) { curRGI[i] |= rigidMask[i]; curRMA[i] |= rep.mlm[i]; }
      rigidchange = true;
    }
  }
  if (oldCell == cur && oldMov == curMov && !rigidchange) return false;
  for (int i = 0; i < SO; i++) { sfxCreateMask[i] |= cur[i] & ~oldCell[i]; sfxDestroyMask[i] |= oldCell[i] & ~cur[i]; }
  for (int i = 0; i < SO; i++) cell[i] = cur[i];
  for (int i = 0; i < SM; i++) mov[i] = curMov[i];
  int col = idx / level.height, row = idx % level.height;
  for (int i = 0; i < SM; i++) { level.colCellContents_Movements[col][i] |= curMov[i]; level.rowCellContents_Movements[row][i] |= curMov[i]; level.mapCellContents_Movements[i] |= curMov[i]; }
  for (int i = 0; i < SO; i++) { level.colCellContents[col][i] |= cur[i]; level.rowCellContents[row][i] |= cur[i]; level.mapCellContents[i] |= cur[i]; }
  return true;
}
bool VM::applyAt(const Rule& r, const std::vector<std::vector<int>>& tuple, bool check, int delta) {
  if (check) {
    for (size_t ri = 0; ri < r.patterns.size(); ri++) {
      const auto& t = tuple[ri]; std::vector<std::vector<int>> tmp;
      if (r.ell[ri] == 0) { if (!rowMatches0(r.patterns[ri], t[0], delta)) return false; }
      else if (r.ell[ri] == 1) { rowMatches1(r.patterns[ri], t[0], t[1] + 1, t[1], delta, tmp); if (tmp.empty()) return false; }
      else { rowMatches2(r.patterns[ri], t[0], t[1] + t[2] + 1, t[1] + t[2], t[1] + 1, t[1], t[2] + 1, t[2], delta, tmp); if (tmp.empty()) return false; }
    }
  }
  bool result = false;
  for (size_t ri = 0; ri < r.patterns.size(); ri++) {
    int ellipseIndex = 0; int currentIndex = tuple[ri][0];
    for (const Cell& c : r.patterns[ri]) {
      if (c.ellipsis) { int k = tuple[ri][1 + ellipseIndex]; ellipseIndex++; currentIndex += delta * k; }
      else { bool ch = replaceCell(c, r, currentIndex); result = ch || result; currentIndex += delta; }
    }
  }
  return result;
}
void VM::queueCommands(const Rule& r) {
  if (r.commands.empty()) return;
  auto has = [&](const char* s) { return std::find(level.commandQueue.begin(), level.commandQueue.end(), s) != level.commandQueue.end(); };
  bool preCancel = has("cancel"), preRestart = has("restart"), curCancel = false, curRestart = false;
  for (const auto& c : r.commands) { if (c[0] == "cancel") curCancel = true; else if (c[0] == "restart") curRestart = true; }
  if (preCancel) return;
  if (preRestart && !curCancel) return;
  if (curCancel || curRestart) { level.commandQueue.clear(); level.commandQueueSourceRules.clear(); level.commandMessage.clear(); messagetext.clear(); }
  for (const auto& c : r.commands) {
    if (std::find(level.commandQueue.begin(), level.commandQueue.end(), c[0]) != level.commandQueue.end()) continue;
    level.commandQueue.push_back(c[0]); level.commandQueueSourceRules.push_back(&r);
    if (c[0] == "message") messagetext = c.size() > 1 ? c[1] : "";
  }
}
bool VM::tryApply(const Rule& r) {
  int delta = deltaIndex(r.dir);
  std::vector<std::vector<std::vector<int>>> matches;
  if (!findMatches(r, matches)) return false;
  bool result = false;
  if (r.hasRep) { auto tuples = generateTuples(matches); for (size_t ti = 0; ti < tuples.size(); ti++) { bool ok = applyAt(r, tuples[ti], ti > 0, delta); result = ok || result; } }
  queueCommands(r);
  return result;
}
bool VM::applyRandomRuleGroup(const std::vector<Rule>& g) {
  std::vector<std::pair<int, std::vector<std::vector<int>>>> matches;
  for (size_t ri = 0; ri < g.size(); ri++) { std::vector<std::vector<std::vector<int>>> m; if (findMatches(g[ri], m)) for (auto& t : generateTuples(m)) matches.push_back({(int)ri, t}); }
  if (matches.empty()) return false;
  auto& match = matches[(size_t)std::floor(rng.uniform() * matches.size())];
  const Rule& rule = g[match.first];
  bool modified = applyAt(rule, match.second, false, deltaIndex(rule.dir));
  queueCommands(rule);
  return modified;
}
bool VM::applyRuleGroup(const std::vector<Rule>& g) {
  if (g[0].random) return applyRandomRuleGroup(g);
  const int MAX_LOOP_COUNT = 200; bool hasChanges = false, madeChange = true; int loopcount = 0;
  while (madeChange && loopcount++ < MAX_LOOP_COUNT) {
    madeChange = false; size_t consecutiveFailures = 0;
    for (size_t ri = 0; ri < g.size(); ri++) { if (tryApply(g[ri])) { madeChange = true; consecutiveFailures = 0; } else { consecutiveFailures++; if (consecutiveFailures == g.size()) break; } }
    if (madeChange) hasChanges = true;
  }
  return hasChanges;
}
void VM::applyRules(const std::vector<std::vector<Rule>>& rules, const std::map<int, int>& loopPoint, std::vector<uint8_t>* banned) {
  bool loopPropagated = false; int loopCount = 0; size_t gi = 0; const size_t N = rules.size();
  while (gi < N) {
    if (!banned || gi >= banned->size() || !(*banned)[gi]) loopPropagated = applyRuleGroup(rules[gi]) || loopPropagated;
    auto lp = loopPoint.find((int)gi);
    if (loopPropagated && lp != loopPoint.end()) { gi = lp->second; loopPropagated = false; if (++loopCount > 200) break; continue; }
    gi++;
    lp = loopPoint.find((int)gi);
    if (gi == N && loopPropagated && lp != loopPoint.end()) { gi = lp->second; loopPropagated = false; if (++loopCount > 200) break; }
  }
}

// ---------- movement resolution ----------
bool VM::repositionEntitiesOnLayer(int idx, int layer, int dirMask) {
  if (!dirKnown(dirMask)) return false;   // dirMasksDelta[dirMask] undefined: the JS would throw; no gated game does this
  int dx = DIR_DELTA[dirMask][0], dy = DIR_DELTA[dirMask][1];
  int tx = idx / level.height, ty = idx % level.height, maxx = level.width - 1, maxy = level.height - 1;
  if ((tx == 0 && dx < 0) || (tx == maxx && dx > 0) || (ty == 0 && dy < 0) || (ty == maxy && dy > 0)) return false;
  int target = idx + dy + dx * level.height; int SO = S->SO, SM = S->SM;
  const BV& layerMask = S->layerMasks[layer];
  BV targetMask(level.objects.begin() + (size_t)target * SO, level.objects.begin() + (size_t)(target + 1) * SO);
  BV sourceMask(level.objects.begin() + (size_t)idx * SO, level.objects.begin() + (size_t)(idx + 1) * SO);
  if (bvAnyCommon(layerMask, targetMask) && dirMask != 16) return false;
  for (const SfxEntry& o : S->sfxMovement[layer]) {
    if (bvAnyCommon(o.objectMask, sourceMask)) {
      BV movementMask(level.movements.begin() + (size_t)idx * SM, level.movements.begin() + (size_t)(idx + 1) * SM);
      if (bvAnyCommon(movementMask, o.directionMask) && std::find(seedsToPlay_CanMove.begin(), seedsToPlay_CanMove.end(), o.seed) == seedsToPlay_CanMove.end()) seedsToPlay_CanMove.push_back(o.seed);
    }
  }
  BV moving = sourceMask; for (int i = 0; i < SO; i++) { sourceMask[i] &= ~layerMask[i]; moving[i] &= layerMask[i]; targetMask[i] |= moving[i]; }
  for (int i = 0; i < SO; i++) level.objects[(size_t)idx * SO + i] = sourceMask[i];
  for (int i = 0; i < SO; i++) level.objects[(size_t)target * SO + i] = targetMask[i];
  int col = target / level.height, row = target % level.height;
  for (int i = 0; i < SO; i++) { level.colCellContents[col][i] |= moving[i]; level.rowCellContents[row][i] |= moving[i]; }
  return true;
}
bool VM::repositionEntitiesAtCell(int idx) {
  int SM = S->SM; BV movementMask(level.movements.begin() + (size_t)idx * SM, level.movements.begin() + (size_t)(idx + 1) * SM);
  if (bvZero(movementMask)) return false;
  bool moved = false;
  for (int layer = 0; layer < S->LAYER_COUNT; layer++) {
    int32_t layerMovement = bvGetShiftOr(movementMask, 0x1f, 5 * layer);
    if (layerMovement != 0) { if (repositionEntitiesOnLayer(idx, layer, layerMovement)) { bvShiftClear(movementMask, layerMovement, 5 * layer); moved = true; } }
  }
  for (int i = 0; i < SM; i++) level.movements[(size_t)idx * SM + i] = movementMask[i];
  int col = idx / level.height, row = idx % level.height;
  for (int i = 0; i < SM; i++) { level.colCellContents_Movements[col][i] |= movementMask[i]; level.rowCellContents_Movements[row][i] |= movementMask[i]; level.mapCellContents_Movements[i] |= movementMask[i]; }
  return moved;
}
bool VM::resolveMovements(std::vector<uint8_t>& banned) {
  bool moved = true;
  while (moved) { moved = false; for (int i = 0; i < level.n_tiles; i++) moved = repositionEntitiesAtCell(i) || moved; }
  bool doUndo = false; int SO = S->SO, SM = S->SM;
  for (int i = 0; i < level.n_tiles; i++) {
    BV cellMask(level.objects.begin() + (size_t)i * SO, level.objects.begin() + (size_t)(i + 1) * SO);
    BV movementMask(level.movements.begin() + (size_t)i * SM, level.movements.begin() + (size_t)(i + 1) * SM);
    if (!bvZero(movementMask)) {
      if (S->rigid) {
        const BV& rma = level.rigidMovementAppliedMask[i];
        if (!bvZero(rma)) {
          for (int w = 0; w < SM; w++) movementMask[w] &= rma[w];
          if (!bvZero(movementMask)) {
            for (int j = 0; j < S->LAYER_COUNT; j++) {
              int32_t layerSection = bvGetShiftOr(movementMask, 0x1f, 5 * j);
              if (layerSection != 0) {
                int rgi = bvGetShiftOr(level.rigidGroupIndexMask[i], 0x1f, 5 * j) - 1;
                int groupIndex = rgi >= 0 && rgi < (int)S->rigidGroupIndex_to_GroupIndex.size() ? S->rigidGroupIndex_to_GroupIndex[rgi] : -1;
                if (groupIndex >= 0) { if ((size_t)groupIndex >= banned.size()) banned.resize(groupIndex + 1, 0); if (banned[groupIndex] != 1) { banned[groupIndex] = 1; doUndo = true; } }
                break;
              }
            }
          }
        }
      }
      for (const SfxEntry& o : S->sfxMovementFailure) {
        if (bvAnyCommon(cellMask, o.objectMask) && bvAnyCommon(o.directionMask, movementMask) && std::find(seedsToPlay_CantMove.begin(), seedsToPlay_CantMove.end(), o.seed) == seedsToPlay_CantMove.end()) seedsToPlay_CantMove.push_back(o.seed);
      }
    }
    for (int j = 0; j < SM; j++) level.movements[(size_t)i * SM + j] = 0;
    if (S->rigid) { std::fill(level.rigidGroupIndexMask[i].begin(), level.rigidGroupIndexMask[i].end(), 0); std::fill(level.rigidMovementAppliedMask[i].begin(), level.rigidMovementAppliedMask[i].end(), 0); }
  }
  return doUndo;
}

// ---------- the turn ----------
bool VM::processInput(int dirIn, bool dontDoWin, bool dontModify) {
  againing = false;
  Backup bak = backupLevel(); int inputindex = dirIn; std::vector<int> playerPositions;
  if (dirIn >= 0) { int dir = 0; switch (dirIn) { case 0: dir = 1; break; case 1: dir = 4; break; case 2: dir = 2; break; case 3: dir = 8; break; case 4: dir = 16; break; default: dir = 0; } playerPositions = startMovement(dir); }
  std::vector<uint8_t> bannedGroup(S->rules.size(), 0);
  level.commandQueue.clear(); level.commandQueueSourceRules.clear(); level.commandMessage.clear();
  bool rigidloop = false;
  std::vector<int32_t> startObjects = level.objects, startMovementsV = level.movements;
  std::fill(sfxCreateMask.begin(), sfxCreateMask.end(), 0); std::fill(sfxDestroyMask.begin(), sfxDestroyMask.end(), 0);
  seedsToPlay_CanMove.clear(); seedsToPlay_CantMove.clear();
  calculateRowColMasks();
  int i = 0;
  do {
    rigidloop = false; i++;
    applyRules(S->rules, S->loopPoint, &bannedGroup);
    bool shouldUndo = resolveMovements(bannedGroup);
    if (shouldUndo) {
      rigidloop = true;
      level.objects = startObjects; level.movements = startMovementsV;
      // the rigid masks were zeroed for every tile by resolveMovements; the JS restores the (zeroed) objects
      if (S->rigid) for (int t = 0; t < level.n_tiles; t++) { std::fill(level.rigidGroupIndexMask[t].begin(), level.rigidGroupIndexMask[t].end(), 0); std::fill(level.rigidMovementAppliedMask[t].begin(), level.rigidMovementAppliedMask[t].end(), 0); }
      level.commandQueue.clear(); level.commandQueueSourceRules.clear(); level.commandMessage.clear();
      std::fill(sfxCreateMask.begin(), sfxCreateMask.end(), 0); std::fill(sfxDestroyMask.begin(), sfxDestroyMask.end(), 0);
      seedsToPlay_CanMove.clear();
    } else {
      applyRules(S->lateRules, S->lateLoopPoint, nullptr);
    }
  } while (i < 50 && rigidloop);
  if (!playerPositions.empty() && S->require_player_movement) {
    bool somemoved = false;
    for (int pos : playerPositions) { if (bvClearIn(S->playerMask, level.objects.data() + (size_t)pos * S->SO)) { somemoved = true; break; } }
    if (!somemoved) { addUndoState(bak); doUndo(true, false); messagetext.clear(); textMode = false; return false; }
  }
  bool modified = processCommandQueue(bak, dontModify, dontDoWin, inputindex);
  if (winning) againing = false;
  return modified;
}
void VM::playSounds() {
  for (auto& s : seedsToPlay_CantMove) soundHistory.push_back(s);
  for (auto& s : seedsToPlay_CanMove) soundHistory.push_back(s);
  for (const SfxEntry& e : S->sfxCreation) if (bvAnyCommon(sfxCreateMask, e.objectMask)) soundHistory.push_back(e.seed);
  for (const SfxEntry& e : S->sfxDestruction) if (bvAnyCommon(sfxDestroyMask, e.objectMask)) soundHistory.push_back(e.seed);
}
bool VM::processCommandQueue(const Backup& bak, bool dontModify, bool dontDoWin, int inputDir) {
  auto has = [&](const char* s) { return std::find(level.commandQueue.begin(), level.commandQueue.end(), s) != level.commandQueue.end(); };
  auto outputCommands = [&]() { if (!unitTesting && has("message")) { textMode = true; titleScreen = false; } };   // processOutputCommands: showTempMessage
  if (has("cancel")) { if (!dontModify) outputCommands(); bool commandsLeft = level.commandQueue.size() > 1; addUndoState(bak); doUndo(true, false); return commandsLeft; }
  if (has("restart")) { if (!dontModify) outputCommands(); addUndoState(bak); if (!dontModify) doRestart(true); }
  bool modified = false;
  for (size_t k = 0; k < level.objects.size(); k++) {
    if (level.objects[k] != bak.dat[k]) {
      if (dontModify) { addUndoState(bak); doUndo(true, false); return true; }
      if (inputDir != -1) addUndoState(bak); else if (!backups.empty()) backups.back() = unconsolidateDiff(backups.back(), bak);
      modified = true; break;
    }
  }
  if (dontModify && (has("win") || has("restart"))) return true;
  if (!dontModify) { playSounds(); outputCommands(); }
  if (!textMode) checkWin(dontDoWin);
  if (!winning) {
    if (has("checkpoint")) { restartTarget = backupLevel(); hasRestartTarget = true; hasUsedCheckpoint = true; }
    if (has("again") && modified) {
      std::string oldMessage = messagetext;
      if (processInput(-1, true, true)) againing = true;
      messagetext = oldMessage;
    }
  }
  level.commandQueue.clear(); level.commandQueueSourceRules.clear(); level.commandMessage.clear();
  return modified;
}
void VM::checkWin(bool dontDoWin) {
  if (std::find(level.commandQueue.begin(), level.commandQueue.end(), "win") != level.commandQueue.end()) { if (!dontDoWin) doWin(); return; }
  if (S->winconditions.empty()) return;
  bool passed = true;
  for (const auto& wc : S->winconditions) {
    auto f1 = [&](const int32_t* c) { return wc.aggr1 ? bvSubset(wc.f1, c) : !bvClearIn(wc.f1, c); };
    auto f2 = [&](const int32_t* c) { return wc.aggr2 ? bvSubset(wc.f2, c) : !bvClearIn(wc.f2, c); };
    bool rulePassed = true;
    if (wc.kind == -1) { for (int i = 0; i < level.n_tiles; i++) { const int32_t* c = level.objects.data() + (size_t)i * S->SO; if (f1(c) && f2(c)) { rulePassed = false; break; } } }
    else if (wc.kind == 0) { bool any = false; for (int i = 0; i < level.n_tiles; i++) { const int32_t* c = level.objects.data() + (size_t)i * S->SO; if (f1(c) && f2(c)) { any = true; break; } } if (!any) rulePassed = false; }
    else { for (int i = 0; i < level.n_tiles; i++) { const int32_t* c = level.objects.data() + (size_t)i * S->SO; if (f1(c) && !f2(c)) { rulePassed = false; break; } } }
    if (!rulePassed) passed = false;
  }
  if (passed && !dontDoWin) doWin();
}
void VM::doWin() {
  if (winning) return;
  againing = false;
  if (unitTesting) { nextLevel(); return; }
  winning = true;
}
void VM::goToTitleScreen() { againing = false; messagetext.clear(); titleScreen = true; textMode = true; }
void VM::nextLevel() {
  againing = false; messagetext.clear();
  if (curlevel > (int)S->levels.size()) curlevel = (int)S->levels.size() - 1;
  if (titleScreen) { loadLevelFromState(curlevel, nullptr); }
  else {
    if (hasUsedCheckpoint) hasUsedCheckpoint = false;
    if (curlevel < (int)S->levels.size() - 1) { curlevel++; textMode = false; titleScreen = false; loadLevelFromState(curlevel, nullptr); }
    else { curlevel = 0; goToTitleScreen(); }
  }
  if (S->hasFlick) oldflickscreendat = {0, 0, std::min(S->flick[0], level.width), std::min(S->flick[1], level.height)};
}

// ---------- gates ----------
std::string VM::levelString() const {
  std::string out; std::map<std::string, int> seen; int n = 0;
  for (int y = 0; y < level.height; y++) {
    for (int x = 0; x < level.width; x++) {
      int idx = x + y * level.width; const int32_t* c = level.objects.data() + (size_t)idx * S->SO;
      std::vector<std::string> objs;
      for (int bit = 0; bit < 32 * S->SO; bit++) if (c[bit >> 5] & (int32_t)(1u << (bit & 31))) objs.push_back(bit < (int)S->idDict.size() ? S->idDict[bit] : "undefined");
      std::sort(objs.begin(), objs.end());
      std::string key; for (size_t k = 0; k < objs.size(); k++) { if (k) key += " "; key += objs[k]; }
      auto it = seen.find(key);
      if (it == seen.end()) { seen[key] = n++; out += key + ":"; it = seen.find(key); }
      out += std::to_string(it->second) + ",";
    }
    out += "\n";
  }
  return out;
}
void VM::runTestLoop(const std::vector<json>& inputs) {
  while (againing) { againing = false; processInput(-1); }
  for (const json& v : inputs) {
    if (v.is_string()) { std::string s = v.get<std::string>(); if (s == "undo") doUndo(false, true); else if (s == "restart") doRestart(false); else if (s == "tick") processInput(-1); }
    else processInput(v.get<int>());
    while (againing) { againing = false; processInput(-1); }
  }
}
}
