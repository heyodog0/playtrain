// engine.hpp — the VGDL engine, Colas / infer-vgdl profile: parity/vgdl/src/30_engine.js line for line. State lives
// in per-type arrays with a cell grid per type; update order, kill/create deferral, RNG draw order and effect pass
// order follow core.py:tick as the JS does. Positions are pixels (cell * B).
#pragma once
#include <cmath>
#include <cstdint>
#include <map>
#include <string>
#include <vector>
#include "mt19937.hpp"
#include "../third_party/json.hpp"
namespace vgdl {
using json = nlohmann::json;
constexpr int K_UP = 273, K_DOWN = 274, K_RIGHT = 275, K_LEFT = 276, K_SPACE = 32;
struct Engine;
struct Type;
using Updater = void (*)(Engine&, Type&, int);
struct Type {
  int idx = 0; std::string key, cls; json args; std::vector<std::string> stypes;
  bool isStatic = false, onlyActive = false, hasOrient = false;
  double ox0 = 1, oy0 = 0, speed = NAN, cooldown = 0;
  std::string avatar; const std::vector<std::vector<int>>* acts = nullptr;
  bool flicker = false; double limit = 1; bool spawn = false; double prob = 1, total = 0;
  bool hasStype = false; std::string stype; bool hasAmmo = false; std::string ammo;
  bool chaser = false, fleeing = false, isResource = false; double value = 1; std::string resType;
  bool singleton = false, aligned = true, inert = false, jpDirty = false;
  Updater upd = nullptr;
  // RC_RL profile (35_rcrl.js) fields
  bool oriented = false, bomber = false, random = false, isAvatarCls = false, hasProb = false; double spawnCooldown = 1; int rcEffId = -1;
  int cap = 0, n = 0; std::vector<int> live, freeList;
  std::vector<int> x, y, lx, ly, lastmove; std::vector<double> ox, oy;
  std::vector<int> age, counter; std::vector<uint8_t> killed; std::vector<int> jpT, jpI, seq, jump, next, cell;
  std::vector<std::map<std::string, double>> res;
  std::vector<int> head;
};
struct Effect {
  std::string actor, actee, name; double score = 0; json args; int rcId = -1;   // rcId: RC_EFFECTS index, -1 = unknown
  void (*fn)(Engine&, Type*, int, Type*, int, const json&) = nullptr;
  Type* A = nullptr; Type* P = nullptr;
};
struct Termination { std::string type; json args; };
struct Spec { json j; std::vector<std::string> keys; std::map<char, std::vector<std::string>> charMap; std::vector<Effect> interactions; std::vector<Termination> terminations; std::vector<std::string> singletons; };
using Group = std::vector<std::pair<Type*, int>>;
struct Engine {
  Spec spec; int B = 1, W = 0, H = 0, SW = 0, SH = 0;
  std::vector<Type> types; std::map<std::string, Type*> byKey;
  long time = 0; double score = 0; bool ended = false, won = false;
  std::vector<int> keys;
  std::vector<int> killList; std::vector<std::string> createKeys; std::vector<int> createXY;
  struct ResChange { int t, i; std::string r; double v; }; std::vector<ResChange> resChanges;
  int seq = 0; bool ssOn = false; std::map<std::string, Group> ss; std::map<std::string, double> resLimits;
  std::vector<Effect*> stepBacks, moveEffs, nonMove;
  MT rng; std::vector<int> cand; std::vector<int> n0;
  // RC_RL profile state (35_rcrl.js)
  bool rcrl = false; std::vector<Effect*> rcEffects; std::vector<Termination*> rcTerms; std::vector<std::string> groupOrder;
  std::map<std::string, std::vector<Type*>> rcMembers; long spriteBonusT = -1, timeoutBonusT = -1; int avatarT = -1;
  // API (Colas)
  void init(const json& specJson, int blockSize);
  void reset(const std::string& levelStr, uint32_t seed);
  void tick(const std::vector<int>& keysDown);
  // API (RC_RL): rcInit builds the sprite_order types; rcTick(keys, isNull) — isNull = the soft-reset step
  void rcInit(const json& specJson, int blockSize, const std::vector<std::string>& groupOrder);
  void rcReset(const std::string& levelStr, uint32_t seed);
  void rcTick(const std::vector<int>& keysDown, bool isNull);
  void rcEvents(); void rcFlush(); void rcCheckTerminations(); int rcCreate(const std::string& key, int x, int y);
  int rcNumSprites(const std::string& st); const std::vector<Type*>& rcMemberTypes(const std::string& st);
  std::string snapshotJson() const;            // the JSON.stringify of the hook's snapshot rows (sprites only)
  // internals shared with the updaters / effects
  int create(const std::string& key, int x, int y, bool skipSingleton = false);
  void kill(Type& t, int i);
  void setPos(Type& t, int i, int x, int y);
  Type* typeOf(const std::string& st) { auto it = byKey.find(st); return it == byKey.end() ? nullptr : it->second; }
  const Group& group(const std::string& st);
  int numSprites(const std::string& st);
  void updatePosition(Type& t, int i, double dx, double dy);
  void active(Type& t, int i, double vx, double vy, double speedOverride = NAN);
  void baseUpdate(Type& t, int i);
  std::vector<int> readAction(const std::vector<std::vector<int>>& acts) const;
  void collectType(Type& t, int i, Type& P);
  void applyEffect(Effect& e);
  void buildLevel(const std::string& levelStr);
  void flush();
  void checkTerminations();
  bool contains(const Type& t, int i) const { return t.x[i] >= 0 && t.y[i] >= 0 && t.x[i] + B <= SW && t.y[i] + B <= SH; }
  bool overlap(const Type& a, int ai, const Type& p, int pi) const {
    if (B == 1) return a.x[ai] == p.x[pi] && a.y[ai] == p.y[pi];
    return a.x[ai] < p.x[pi] + B && a.x[ai] + B > p.x[pi] && a.y[ai] < p.y[pi] + B && a.y[ai] + B > p.y[pi];
  }
  Group scratchGroup;
};
double resGet(const Type& t, int i, const std::string& r);
void makeType(Type& t, int idx, const std::string& key, const json& def);   // engine.cpp: vgMakeType
Updater colasUpdaterBase();
void resSet(Type& t, int i, const std::string& r, double v);
}
