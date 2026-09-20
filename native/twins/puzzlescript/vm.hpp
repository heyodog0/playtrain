// vm.hpp — the PuzzleScript rule VM: engine.js's runtime (processInput, applyRules, matching, applyAt/replace,
// resolveMovements, commands, checkWin, undo/restart backups, RC4) over the compiled state that
// parity/puzzlescript/tools/twin_state.mjs serialised. Never parses PuzzleScript text.
#pragma once
#include <cstdint>
#include <map>
#include <string>
#include <vector>
#include "rc4.hpp"
#include "../third_party/json.hpp"
namespace ps {
using json = nlohmann::json;
using BV = std::vector<int32_t>;
constexpr int MAXW = 64;   // max BitVec words (2048 objects, 320 layers; one reference test has more than 1024 objects): fixed-size scratch, no heap in the step path
// A row's matches, flat: stride 1 (index) for 0 ellipses, 2 (index,k) for 1, 3 (index,k1,k2) for 2
struct RowMatches { int stride = 1; std::vector<int> flat; int count() const { return (int)flat.size() / stride; } };
struct Replacement { BV oc, os, mc, ms, mlm, rem, rdm; };
struct Cell { bool ellipsis = false; BV op, om, mp, mm; std::vector<BV> aop; bool hasRep = false; Replacement rep; };
struct Rule {
  int dir = 0; std::vector<std::vector<Cell>> patterns; bool hasRep = false; int line = 0; std::vector<int> ell; int group = 0; bool rigid = false;
  std::vector<std::vector<std::string>> commands; bool random = false; std::vector<BV> crm, crmm; BV ruleMask;
};
struct SfxEntry { BV objectMask, directionMask; int layer = -1; std::string seed; };
struct LevelDef { bool message = false; std::string messageText; int width = 0, height = 0; std::vector<int32_t> objects; };
struct State {
  int SO = 1, SM = 1, LAYER_COUNT = 1, objectCount = 0; std::vector<std::string> idDict; std::vector<int> objLayer;
  std::vector<BV> layerMasks; bool playerAggregate = false; BV playerMask;
  bool run_rules_on_level_start = false, require_player_movement = false, noundo = false, norestart = false;
  bool hasFlick = false, hasZoom = false; int flick[2] = {0, 0}, zoom[2] = {0, 0}; std::string bgcolor = "#000000";
  struct Obj { std::string name; int id = 0, layer = 0; std::vector<std::string> colors; std::vector<std::vector<int>> sprite; }; std::vector<Obj> objects;
  bool rigid = false; std::vector<int> rigidGroupIndex_to_GroupIndex; std::map<int, int> groupNumber_to_RigidGroupIndex;
  struct Win { int kind; BV f1, f2; bool aggr1, aggr2; }; std::vector<Win> winconditions;
  std::vector<LevelDef> levels; std::vector<std::vector<Rule>> rules, lateRules; std::map<int, int> loopPoint, lateLoopPoint;
  std::vector<SfxEntry> sfxCreation, sfxDestruction, sfxMovementFailure; std::vector<std::vector<SfxEntry>> sfxMovement;
  bool load(const json& j, std::string& err);
};
struct Backup { bool diff = false; std::vector<int32_t> dat; int width = 0, height = 0; std::vector<int> ofd; };
struct Level {
  int width = 0, height = 0, n_tiles = 0; std::vector<int32_t> objects, movements;
  std::vector<BV> rigidMovementAppliedMask, rigidGroupIndexMask, rowCellContents, rowCellContents_Movements, colCellContents, colCellContents_Movements;
  BV mapCellContents, mapCellContents_Movements;
  std::vector<std::string> commandQueue; std::vector<const Rule*> commandQueueSourceRules; std::vector<std::string> commandMessage;
};
class VM {
 public:
  const State* S = nullptr; Level level; RC4 rng; bool unitTesting = true;
  // engine globals
  int curlevel = 0; bool winning = false, againing = false, textMode = true, titleScreen = true, restarting = false, runrulesonlevelstart_phase = false;
  std::vector<int> oldflickscreendat; std::string messagetext; std::vector<Backup> backups; Backup restartTarget; bool hasRestartTarget = false, hasUsedCheckpoint = false;
  BV sfxCreateMask, sfxDestroyMask; std::vector<std::string> seedsToPlay_CanMove, seedsToPlay_CantMove, soundHistory;
  // API
  void setState(const State* s);
  void compileLoad(int levelIndex, const std::string* seed);          // compile(["loadLevel", i], text, seed): the load part
  void loadLevelFromState(int levelIndex, const std::string* seed);
  bool processInput(int dir, bool dontDoWin = false, bool dontModify = false);
  void doUndo(bool force, bool ignoreDuplicates);
  void doRestart(bool force);
  std::string levelString() const;                                     // debug.js convertLevelToString
  void runTestLoop(const std::vector<json>& inputs);                   // testingFrameWork.js runTest's input loop
 private:
  // level plumbing
  void rebuildLevelArrays(); Backup backupLevel() const; void restoreLevel(const Backup& b); void addUndoState(const Backup& b); bool backupDiffers() const;
  void loadLevelFromLevelDat(const LevelDef* dat, const std::string* seed);
  void nextLevel(); void doWin(); void goToTitleScreen(); void checkWin(bool dontDoWin); bool processCommandQueue(const Backup& bak, bool dontModify, bool dontDoWin, int inputDir);
  void playSounds();
  // rules
  void calculateRowColMasks(); std::vector<int> getPlayerPositions() const; void moveEntitiesAtIndex(int pos, const BV& entityMask, int dirMask);
  std::vector<int> startMovement(int dir);
  bool cellMatches(const Cell& c, int i) const;
  bool rowMatches0(const std::vector<Cell>& row, int i, int d) const;
  void rowMatches1(const std::vector<Cell>& row, int i, int kmax, int kmin, int d, std::vector<int>& out) const;
  void rowMatches2(const std::vector<Cell>& row, int i, int kmax, int kmin, int k1max, int k1min, int k2max, int k2min, int d, std::vector<int>& out) const;
  bool matchRow(const Rule& r, int ri, int d, RowMatches& out) const;
  bool findMatches(const Rule& r, std::vector<RowMatches>& matches) const;
  // tuple = one entry per row: pointer into that row's flat storage (stride per row)
  bool applyAt(const Rule& r, const int* const* tuple, bool check, int d);
  std::vector<RowMatches> scratchMatches_; std::vector<int> scratchTuple_; std::vector<const int*> scratchPtrs_; std::vector<int32_t> startObjects_, startMovements_;
  bool replaceCell(const Cell& c, const Rule& r, int idx);
  bool tryApply(const Rule& r); void queueCommands(const Rule& r);
  bool applyRandomRuleGroup(const std::vector<Rule>& g); bool applyRuleGroup(const std::vector<Rule>& g);
  void applyRules(const std::vector<std::vector<Rule>>& rules, const std::map<int, int>& loopPoint, std::vector<uint8_t>* banned);
  bool resolveMovements(std::vector<uint8_t>& banned); bool repositionEntitiesAtCell(int idx); bool repositionEntitiesOnLayer(int idx, int layer, int dirMask);
  int deltaIndex(int dir) const;
  BV& mapMov() { return level.mapCellContents_Movements; }
};
// BitVec helpers (bitvec.js semantics on int32 words)
inline bool bvSubset(const BV& a, const int32_t* arr) { for (size_t i = 0; i < a.size(); i++) if ((a[i] & arr[i]) != a[i]) return false; return true; }   // bitsSetInArray
inline bool bvClearIn(const BV& a, const int32_t* arr) { for (size_t i = 0; i < a.size(); i++) if (a[i] & arr[i]) return false; return true; }        // bitsClearInArray
inline bool bvAnyCommon(const BV& a, const BV& b) { for (size_t i = 0; i < a.size(); i++) if (a[i] & b[i]) return true; return false; }
inline bool bvZero(const BV& a) { for (int32_t v : a) if (v != 0) return false; return true; }
inline bool bvGet(const BV& a, int ind) { return (a[ind >> 5] & (int32_t)(1u << (ind & 31))) != 0; }
inline void bvSet(BV& a, int ind) { a[ind >> 5] |= (int32_t)(1u << (ind & 31)); }
inline void bvShiftOr(BV& a, int32_t mask, int shift) {
  int inner = shift & 31, outer = shift >> 5; a[outer] |= (int32_t)((uint32_t)mask << inner);
  if (inner > 27) a[outer + 1] |= (int32_t)(mask >> (32 - inner));
}
inline void bvShiftClear(BV& a, int32_t mask, int shift) {
  int inner = shift & 31, outer = shift >> 5; a[outer] &= ~(int32_t)((uint32_t)mask << inner);
  if (inner > 27) a[outer + 1] &= ~(int32_t)((uint32_t)mask >> (32 - inner));
}
inline int32_t bvGetShiftOr(const BV& a, int32_t mask, int shift) {
  int inner = shift & 31, outer = shift >> 5; int32_t ret = (int32_t)((uint32_t)a[outer] >> inner);
  if (inner > 27) ret |= (int32_t)((uint32_t)a[outer + 1] << (32 - inner));
  return ret & mask;
}
}
