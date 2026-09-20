// rcrl.cpp — parity/vgdl/src/35_rcrl.js line for line: the tomov/RC_RL (fmri branch, Tsividis-lineage py-vgdl,
// Python 2) semantics profile over the same sprite tables and cell grids as engine.cpp. Update in sprite_order with
// the avatar last, (lastmove+1) % cooldown gating, fixpoint collision loop over new pairs with class-sorted effects,
// time incremented after the update, avatar-loss-first terminations with bonuses, Python 2 random.choice as
// int(random()*n), avatar skipped on NOOP. See the JS header comment; the reference run is tests/oracle_rcrl.py.
#include "engine.hpp"
#include <algorithm>
#include <memory>
#include <unordered_map>
#include <unordered_set>
namespace vgdl {
static const int BASEDIRS[4][2] = {{0, -1}, {-1, 0}, {0, 1}, {1, 0}};
struct RcClass { bool is_static = false, is_resource = false, flicker = false, oriented = false, spawn = false, bomber = false, random = false, chaser = false, fleeing = false; double value = NAN, limit = NAN, speed = NAN; const char* avatar = nullptr; };
static RcClass rcClass(const std::string& c) {
  RcClass d;
  if (c == "Immovable") d.is_static = true;
  else if (c == "Resource") { d.value = 1; d.limit = 2; d.is_resource = true; }
  else if (c == "ResourcePack") { d.is_static = true; d.value = 1; d.limit = 2; d.is_resource = true; }
  else if (c == "Flicker") { d.flicker = true; d.limit = 20; }
  else if (c == "OrientedFlicker") { d.flicker = true; d.limit = 20; d.oriented = true; d.speed = 0; }
  else if (c == "Portal") d.is_static = true;
  else if (c == "SpawnPoint") { d.is_static = true; d.spawn = true; }
  else if (c == "RandomNPC") { d.speed = 1; d.random = true; }
  else if (c == "OrientedSprite") d.oriented = true;
  else if (c == "Missile") { d.oriented = true; d.speed = 1; }
  else if (c == "Bomber") { d.oriented = true; d.speed = 1; d.spawn = true; d.bomber = true; }
  else if (c == "Chaser") { d.speed = 1; d.chaser = true; }
  else if (c == "Fleeing") { d.speed = 1; d.chaser = true; d.fleeing = true; }
  else if (c == "MovingAvatar") { d.speed = 1; d.avatar = "moving"; }
  else if (c == "HorizontalAvatar") { d.speed = 1; d.avatar = "horizontal"; }
  else if (c == "FlakAvatar") { d.speed = 1; d.avatar = "flak"; }
  else if (c == "OrientedAvatar") { d.speed = 1; d.avatar = "oriented"; d.oriented = true; }
  else if (c == "ShootAvatar") { d.speed = 1; d.avatar = "shoot"; d.oriented = true; }
  return d;
}
static bool has(const json& a, const char* k) { return a.is_object() && a.contains(k) && !a[k].is_null(); }
static double num(const json& v) { return v.is_number() ? v.get<double>() : v.is_boolean() ? (v.get<bool>() ? 1 : 0) : NAN; }
static bool truthy(const json& v) { if (v.is_null()) return false; if (v.is_boolean()) return v.get<bool>(); if (v.is_number()) { double d = v.get<double>(); return d != 0 && !std::isnan(d); } if (v.is_string()) return !v.get<std::string>().empty(); return true; }
static std::string strOf(const json& v) { return v.is_string() ? v.get<std::string>() : v.dump(); }
static int32_t i32(double v) { if (std::isnan(v) || std::isinf(v)) return 0; double t = std::trunc(v); double m = std::fmod(t, 4294967296.0); if (m < 0) m += 4294967296.0; return (int32_t)(uint32_t)m; }
static inline bool incl(const std::vector<int>& a, int v) { return std::find(a.begin(), a.end(), v) != a.end(); }
static int rcChoice(Engine& E, int n) { return (int)std::floor(E.rng.random() * n); }

enum RcEff { E_NOTHING, E_KILLSPRITE, E_CHANGESCORE, E_TRANSFORMTO, E_STEPBACK, E_UNDOALL, E_BOUNCEFORWARD, E_REVERSEDIRECTION, E_TURNAROUND, E_WRAPAROUND,
  E_KILLIFOTHERHASMORE, E_KILLIFHASMORE, E_KILLIFHASLESS, E_KILLIFOTHERHASLESS, E_KILLIFALIVE, E_CHANGERESOURCE, E_COLLECTRESOURCE, E_KILLIFFROMABOVE };
static const char* RC_EFF_NAMES[] = {"nothing", "killSprite", "changeScore", "transformTo", "stepBack", "undoAll", "bounceForward", "reverseDirection", "turnAround", "wrapAround",
  "killIfOtherHasMore", "killIfHasMore", "killIfHasLess", "killIfOtherHasLess", "killIfAlive", "changeResource", "collectResource", "killIfFromAbove"};
static int rcEffId(const std::string& n) { for (int k = 0; k < (int)(sizeof RC_EFF_NAMES / sizeof *RC_EFF_NAMES); k++) if (n == RC_EFF_NAMES[k]) return k; return -1; }
static bool rcNoMove(int id) { switch (id) { case E_NOTHING: case E_KILLSPRITE: case E_CHANGESCORE: case E_TRANSFORMTO: case E_KILLIFOTHERHASMORE: case E_KILLIFHASMORE: case E_KILLIFHASLESS: case E_KILLIFOTHERHASLESS: case E_KILLIFALIVE: case E_CHANGERESOURCE: case E_COLLECTRESOURCE: case E_KILLIFFROMABOVE: return true; default: return false; } }

// ---------- init ----------
void Engine::rcInit(const json& s, int blockSize, const std::vector<std::string>& gorder) {
  rcrl = true; spec.j = s; B = blockSize ? blockSize : 30;
  spec.keys.clear(); for (const auto& k : s["keys"]) spec.keys.push_back(k.get<std::string>());
  spec.charMap.clear(); for (auto it = s["charMap"].begin(); it != s["charMap"].end(); ++it) { std::string ch = it.key(); if (ch.size() != 1) continue; std::vector<std::string> ks; for (const auto& k : it.value()) ks.push_back(k.get<std::string>()); spec.charMap[ch[0]] = ks; }
  spec.singletons.clear(); if (s.contains("singletons")) for (const auto& k : s["singletons"]) spec.singletons.push_back(k.get<std::string>());
  spec.terminations.clear(); for (const auto& t : s["terminations"]) { Termination tm; tm.type = t.value("type", ""); tm.args = t.contains("args") ? t["args"] : json::object(); spec.terminations.push_back(tm); }
  json defs = s["defs"];
  if (!defs.contains("wall")) { defs["wall"] = json::object(); defs["wall"]["cls"] = "Immovable"; defs["wall"]["args"] = json::object(); defs["wall"]["args"]["color"] = "DARKGRAY"; defs["wall"]["stypes"] = json::array({"wall"}); }
  if (!defs.contains("avatar")) { defs["avatar"] = json::object(); defs["avatar"]["cls"] = "MovingAvatar"; defs["avatar"]["args"] = json::object(); defs["avatar"]["stypes"] = json::array({"avatar"}); }
  std::vector<std::string> order = {"wall", "avatar"};
  for (const auto& k : spec.keys) { auto it = std::find(order.begin(), order.end(), k); if (it != order.end()) order.erase(it); order.push_back(k); }
  order.erase(std::remove(order.begin(), order.end(), std::string("avatar")), order.end()); order.push_back("avatar");
  types.clear(); types.resize(order.size()); byKey.clear(); resLimits.clear();
  for (size_t idx = 0; idx < order.size(); idx++) {
    const std::string& k = order[idx]; Type& t = types[idx]; const json& d = defs[k]; const json& A = d["args"];
    makeType(t, (int)idx, k, d);
    RcClass cd = rcClass(t.cls);
    t.isStatic = cd.is_static;
    t.cooldown = (A.contains("cooldown") && truthy(A["cooldown"])) ? num(A["cooldown"]) : 1;
    t.speed = (A.contains("speed") && truthy(A["speed"])) ? num(A["speed"]) : (!std::isnan(cd.speed) ? cd.speed : NAN);
    t.hasOrient = true;
    if (has(A, "orientation") && A["orientation"].is_array() && A["orientation"].size() >= 2) { t.ox0 = num(A["orientation"][0]); t.oy0 = num(A["orientation"][1]); }
    else if (cd.oriented) { t.ox0 = 1; t.oy0 = 0; } else { t.ox0 = 0; t.oy0 = 0; }
    t.oriented = cd.oriented || has(A, "orientation");
    t.flicker = cd.flicker; t.limit = has(A, "limit") ? num(A["limit"]) : (!std::isnan(cd.limit) ? cd.limit : 2);
    t.spawn = cd.spawn; t.bomber = cd.bomber;
    t.spawnCooldown = (A.contains("spawnCooldown") && truthy(A["spawnCooldown"])) ? num(A["spawnCooldown"]) : 1;
    t.hasProb = (A.contains("prob") && truthy(A["prob"])) || cd.spawn; t.prob = (A.contains("prob") && truthy(A["prob"])) ? num(A["prob"]) : (cd.spawn ? 1 : NAN);
    t.total = (A.contains("total") && truthy(A["total"])) ? num(A["total"]) : 0;
    t.random = cd.random; t.chaser = cd.chaser; t.fleeing = cd.fleeing;
    t.avatar = cd.avatar ? cd.avatar : ""; t.isAvatarCls = t.cls.find("Avatar") != std::string::npos;
    t.isResource = cd.is_resource; t.value = has(A, "value") ? num(A["value"]) : 1;
    t.resType = has(A, "res_type") ? strOf(A["res_type"]) : k;
    t.hasStype = has(A, "stype"); t.stype = t.hasStype ? strOf(A["stype"]) : ""; t.hasAmmo = has(A, "ammo"); t.ammo = t.hasAmmo ? strOf(A["ammo"]) : "";
    t.singleton = std::find(spec.singletons.begin(), spec.singletons.end(), k) != spec.singletons.end();
    t.upd = nullptr;   // RC_RL updaters are dispatched on cls in rcTick
    t.inert = t.isStatic && !cd.spawn && !cd.flicker;
    byKey[k] = &t;
  }
  for (auto& t : types) if (t.isResource && has(t.args, "limit")) resLimits[t.resType] = num(t.args["limit"]);
  spec.interactions.clear();
  for (const auto& e : s["interactions"]) {
    Effect f; f.actor = e.value("actor", ""); f.actee = e.value("actee", ""); f.name = e.value("name", ""); if (e.contains("name") && e["name"].is_null()) f.name = "";
    f.score = e.contains("score") ? num(e["score"]) : 0; if (std::isnan(f.score)) f.score = 0; f.args = e.contains("args") ? e["args"] : json::object();
    f.rcId = rcEffId(f.name); f.A = typeOf(f.actor); f.P = f.actee == "EOS" ? nullptr : typeOf(f.actee);
    spec.interactions.push_back(f);
  }
  // effects sorted by class (parseInteractions), stable, descending priority
  auto prio = [](const Effect& e) -> double {
    const std::string& n = e.name;
    if (n == "bounceForward" || n == "stepBack" || n == "wallStop") return 1;
    if (n == "killSprite" || n == "killIfTooFast" || n == "killIfHasMore" || n == "killIfHasLess" || n == "killIfOtherHasMore" || n == "killIfOtherHasLess" || n == "collectResource") return 2;
    if (n == "changeScore" || n == "conveySprite" || n == "changeResource") { bool vnull = !has(e.args, "value"); double v = vnull ? 0 : num(e.args["value"]); return (vnull || v <= 0) ? 3 : 3.5; }
    if (n == "nothing") return 4;
    return 0;
  };
  rcEffects.clear(); for (auto& e : spec.interactions) rcEffects.push_back(&e);
  std::stable_sort(rcEffects.begin(), rcEffects.end(), [&](Effect* a, Effect* b) { return prio(*a) > prio(*b); });
  auto tprio = [](const Termination& t) { return (t.type == "SpriteCounter" && has(t.args, "stype") && strOf(t.args["stype"]) == "avatar" && t.args.contains("win") && t.args["win"].is_boolean() && !t.args["win"].get<bool>()) ? 1 : t.type == "SpriteCounter" ? 2 : 3; };
  rcTerms.clear(); for (auto& t : spec.terminations) rcTerms.push_back(&t);
  std::stable_sort(rcTerms.begin(), rcTerms.end(), [&](Termination* a, Termination* b) { return tprio(*a) < tprio(*b); });
  groupOrder = gorder; rcMembers.clear();
  n0.assign(types.size(), 0);
}

// ---------- sprites ----------
static int rcLiveCount(const Type& t) { int n = 0; for (int k = 0; k < t.n; k++) if (!t.killed[t.live[k]]) n++; return n; }
int Engine::rcNumSprites(const std::string& st) {
  Type* t = typeOf(st); if (t) return rcLiveCount(*t);
  int n = 0; for (auto& ty : types) if (std::find(ty.stypes.begin(), ty.stypes.end(), st) != ty.stypes.end()) n += rcLiveCount(ty);
  return n;
}
int Engine::rcCreate(const std::string& key, int x, int y) {
  Type* t = typeOf(key); if (!t) return -1;
  for (int s = (int)t->stypes.size() - 1; s >= 0; s--) { const std::string& pk = t->stypes[s]; Type* pt = typeOf(pk); if (pt && pt->singleton && rcNumSprites(pk) > 0) return -1; }
  return create(key, x, y, true);
}
const std::vector<Type*>& Engine::rcMemberTypes(const std::string& st) {
  auto it = rcMembers.find(st); if (it != rcMembers.end()) return it->second;
  std::vector<Type*> m; Type* t = typeOf(st);
  if (t) m.push_back(t);
  else if (!groupOrder.empty()) { for (const auto& k : groupOrder) { Type* ty = typeOf(k); if (ty && std::find(ty->stypes.begin(), ty->stypes.end(), st) != ty->stypes.end()) m.push_back(ty); } }
  else { for (auto& ty : types) if (std::find(ty.stypes.begin(), ty.stypes.end(), st) != ty.stypes.end()) m.push_back(&ty); }
  return rcMembers[st] = m;
}
static void rcGetSprites(Engine& E, const std::string& st, Group& out) {
  out.clear(); const auto& types = E.rcMemberTypes(st);
  for (Type* ty : types) for (int k = 0; k < ty->n; k++) { int i = ty->live[k]; if (!ty->killed[i]) out.push_back({ty, i}); }
}
static void rcBuildLevel(Engine& E, const std::string& levelStr) {
  std::vector<std::string> lines; size_t p = 0;
  while (p <= levelStr.size()) { size_t q = levelStr.find('\n', p); if (q == std::string::npos) q = levelStr.size(); if (q > p) lines.push_back(levelStr.substr(p, q - p)); p = q + 1; }
  E.H = (int)lines.size(); E.W = 0; for (auto& l : lines) if ((int)l.size() > E.W) E.W = (int)l.size();
  E.SW = E.W * E.B; E.SH = E.H * E.B;
  for (auto& t : E.types) { t.n = 0; t.freeList.clear(); for (int i = t.cap - 1; i >= 0; i--) t.freeList.push_back(i); t.head.assign((size_t)E.W * E.H, -1); t.aligned = true; }
  E.seq = 0;
  static const std::vector<std::string> WALL = {"wall"}, AVATAR = {"avatar"};
  for (int r = 0; r < (int)lines.size(); r++) {
    const std::string& line = lines[r];
    for (int c = 0; c < (int)line.size(); c++) {
      char ch = line[c]; auto it = E.spec.charMap.find(ch);
      const std::vector<std::string>* ks = it != E.spec.charMap.end() ? &it->second : ch == 'w' ? &WALL : ch == 'A' ? &AVATAR : nullptr;
      if (!ks) continue;
      for (const auto& k : *ks) E.rcCreate(k, c * E.B, r * E.B);
    }
  }
}
void Engine::rcReset(const std::string& levelStr, uint32_t seedv) {
  rng.seed(seedv);
  rcBuildLevel(*this, levelStr);
  time = 0; score = 0; ended = false; won = false;
  killList.clear();
  spriteBonusT = -1; timeoutBonusT = -1;
  Type* av = typeOf("avatar"); avatarT = av ? av->idx : -1;
  rcTick({}, true);   // softReset: one action-less step before the first agent action
}

// ---------- movement ----------
static void rcUpdatePos(Engine& E, Type& t, int i, double ox, double oy, double speed) {
  if (std::fmod((double)t.lastmove[i] + 1, t.cooldown) == 0 && std::fabs(ox) + std::fabs(oy) != 0)
    E.setPos(t, i, i32(t.x[i] + std::trunc(ox * speed)), i32(t.y[i] + std::trunc(oy * speed)));
}
static inline double rcSpeed(const Type& t) { return std::isnan(t.speed) ? 1 : t.speed; }
static void rcPassive(Engine& E, Type& t, int i) { double sp = rcSpeed(t); if (sp != 0) rcUpdatePos(E, t, i, t.ox[i], t.oy[i], sp * E.B); }
static void rcActive(Engine& E, Type& t, int i, double ax, double ay) { double sp = rcSpeed(t); if (sp != 0) rcUpdatePos(E, t, i, ax, ay, sp * E.B); }
static void rcBaseUpdate(Engine& E, Type& t, int i, bool randomNpc) {
  t.lx[i] = t.x[i]; t.ly[i] = t.y[i];
  t.lastmove[i] += 1;
  if (!t.isStatic && !randomNpc) rcPassive(E, t, i);
}
static bool rcReadAction(const Engine& E, int out[2]) {
  const auto& k = E.keys;
  if (incl(k, K_RIGHT)) { out[0] = 1; out[1] = 0; return true; }
  if (incl(k, K_LEFT)) { out[0] = -1; out[1] = 0; return true; }
  if (incl(k, K_UP)) { out[0] = 0; out[1] = -1; return true; }
  if (incl(k, K_DOWN)) { out[0] = 0; out[1] = 1; return true; }
  return false;
}
static void rcKill(Engine& E, Type& t, int i) { E.kill(t, i); }

// ---------- class updates ----------
static void rcUpdMoving(Engine& E, Type& t, int i) { rcBaseUpdate(E, t, i, false); int a[2]; if (rcReadAction(E, a)) rcActive(E, t, i, a[0], a[1]); }
static void rcUpdHorizontal(Engine& E, Type& t, int i) { rcBaseUpdate(E, t, i, false); int a[2]; if (rcReadAction(E, a) && a[1] == 0) rcActive(E, t, i, a[0], a[1]); }
static void rcUpdFlak(Engine& E, Type& t, int i) { rcUpdHorizontal(E, t, i); if (t.hasStype && !t.stype.empty() && incl(E.keys, K_SPACE)) E.rcCreate(t.stype, t.x[i], t.y[i]); }
static void rcUpdOriented(Engine& E, Type& t, int i) {
  double tx = t.ox[i], ty = t.oy[i];
  t.ox[i] = 0; t.oy[i] = 0;
  rcBaseUpdate(E, t, i, false);
  int a[2]; if (rcReadAction(E, a)) rcActive(E, t, i, a[0], a[1]);
  int dx = t.x[i] - t.lx[i], dy = t.y[i] - t.ly[i];
  if (std::abs(dx) + std::abs(dy) > 0) { t.ox[i] = dx; t.oy[i] = dy; } else { t.ox[i] = tx; t.oy[i] = ty; }
}
static bool rcHasAmmo(const Type& t, int i) { if (!t.hasAmmo) return true; auto it = t.res[i].find(t.ammo); return it != t.res[i].end() && it->second > 0; }
static void rcUnit(double x, double y, double out[2]) { double L = std::sqrt(x * x + y * y); if (L > 0) { out[0] = x / L; out[1] = y / L; } else { out[0] = 1; out[1] = 0; } }
static void rcUpdShoot(Engine& E, Type& t, int i) {
  rcUpdOriented(E, t, i);
  if (!rcHasAmmo(t, i)) return;
  if (t.hasStype && !t.stype.empty() && incl(E.keys, K_SPACE)) {
    double u[2]; rcUnit(t.ox[i], t.oy[i], u);
    Type* st = E.typeOf(t.stype);
    int j = E.rcCreate(t.stype, i32(std::trunc(t.lx[i] + u[0] * E.B)), i32(std::trunc(t.ly[i] + u[1] * E.B)));
    if (j >= 0 && st->oriented) { st->ox[j] = u[0]; st->oy[j] = u[1]; }
    if (t.hasAmmo) { auto it = t.res[i].find(t.ammo); if (it != t.res[i].end()) it->second -= 1; }
  }
}
static void rcUpdRandom(Engine& E, Type& t, int i) {
  t.lastmove[i] -= 1;
  rcBaseUpdate(E, t, i, true);
  const int* d = BASEDIRS[rcChoice(E, 4)];
  t.ox[i] = d[0]; t.oy[i] = d[1];
  rcActive(E, t, i, d[0], d[1]);
  t.lastmove[i] += 1;
}
static inline double rcDist(double x1, double y1, double x2, double y2) { return std::sqrt((y1 - y2) * (y1 - y2) + (x1 - x2) * (x1 - x2)); }
static void rcUpdChaser(Engine& E, Type& t, int i) {
  rcBaseUpdate(E, t, i, false);
  Group targets; rcGetSprites(E, t.stype, targets);
  double bestd = 1e100; std::vector<int> tx, ty;
  for (auto& pr : targets) {
    double d = rcDist(t.x[i], t.y[i], pr.first->x[pr.second], pr.first->y[pr.second]);
    if (d < bestd) { bestd = d; tx.clear(); ty.clear(); tx.push_back(pr.first->x[pr.second]); ty.push_back(pr.first->y[pr.second]); }
    else if (d == bestd) { tx.push_back(pr.first->x[pr.second]); ty.push_back(pr.first->y[pr.second]); }
  }
  std::vector<const int*> opts;
  for (size_t k = 0; k < tx.size(); k++) {
    double base = rcDist(t.x[i], t.y[i], tx[k], ty[k]);
    for (int q = 0; q < 4; q++) { const int* a = BASEDIRS[q];
      double nd = rcDist(t.x[i] + a[0], t.y[i] + a[1], tx[k], ty[k]);
      if (t.fleeing && base < nd) opts.push_back(a);
      if (!t.fleeing && base > nd) opts.push_back(a);
    }
  }
  const int* d = opts.empty() ? BASEDIRS[rcChoice(E, 4)] : opts[rcChoice(E, (int)opts.size())];
  rcActive(E, t, i, d[0], d[1]);
}
static void rcUpdSpawn(Engine& E, Type& t, int i) {
  if (t.total != 0 && t.counter[i] >= t.total) { rcKill(E, t, i); return; }
  double sc = t.spawnCooldown, tm = (double)E.time + 1;
  bool hit = sc < 11 ? (std::fmod(tm, sc) == 0) : (std::fmod(tm, sc) == 3);
  if (hit && t.hasProb && E.rng.random() < t.prob) { E.rcCreate(t.stype, t.x[i], t.y[i]); t.counter[i] += 1; }
  t.lastmove[i] += 1;
}
static void rcUpdBomber(Engine& E, Type& t, int i) { t.lastmove[i] -= 1; rcBaseUpdate(E, t, i, false); rcUpdSpawn(E, t, i); }
static void rcUpdFlicker(Engine& E, Type& t, int i) { rcBaseUpdate(E, t, i, false); if (t.age[i] >= t.limit) rcKill(E, t, i); else t.age[i] += 1; }
static void rcUpdate(Engine& E, Type& t, int i) {
  const std::string& c = t.cls;
  if (c == "MovingAvatar") rcUpdMoving(E, t, i); else if (c == "HorizontalAvatar") rcUpdHorizontal(E, t, i); else if (c == "FlakAvatar") rcUpdFlak(E, t, i);
  else if (c == "OrientedAvatar") rcUpdOriented(E, t, i); else if (c == "ShootAvatar") rcUpdShoot(E, t, i); else if (c == "RandomNPC") rcUpdRandom(E, t, i);
  else if (c == "Chaser" || c == "Fleeing") rcUpdChaser(E, t, i); else if (c == "SpawnPoint") rcUpdSpawn(E, t, i); else if (c == "Bomber") rcUpdBomber(E, t, i);
  else if (c == "Flicker" || c == "OrientedFlicker") rcUpdFlicker(E, t, i); else rcBaseUpdate(E, t, i, false);
}

// ---------- effects ----------
// sprite.resources is a defaultdict(int): a read creates the key, and the state dump shows it
static double rcResRead(Type& t, int i, const std::string& r) { auto it = t.res[i].find(r); if (it != t.res[i].end()) return it->second; t.res[i][r] = 0; return 0; }
static double rcLimit(const Engine& E, const std::string& r) { auto it = E.resLimits.find(r); return it == E.resLimits.end() ? 0 : it->second; }
static double argNum(const json& a, const char* k, double dflt) { return has(a, k) ? num(a[k]) : dflt; }
static std::string argStr(const json& a, const char* k) { return has(a, k) ? strOf(a[k]) : ""; }
struct Created { Type* t = nullptr; int i = -1; };
static void rcEffect(Engine& E, int id, Type* a, int ai, Type* p, int pi, const json& args, Created* ctx) {
  switch (id) {
    case E_NOTHING: break;
    case E_KILLSPRITE: rcKill(E, *a, ai); break;
    case E_CHANGESCORE: E.score += argNum(args, "value", NAN); break;
    case E_TRANSFORMTO: {
      std::string key = (args.is_object() && args.contains("stype") && truthy(args["stype"])) ? strOf(args["stype"]) : "wall";
      Type* st = E.typeOf(key);
      int j = E.rcCreate(key, a->x[ai], a->y[ai]);
      if (j >= 0) {
        if (a->oriented && st->oriented) { st->ox[j] = a->ox[ai]; st->oy[j] = a->oy[ai]; st->res[j] = a->res[ai]; }
        rcKill(E, *a, ai);
      }
      if (ctx) { if (j >= 0) { ctx->t = st; ctx->i = j; } else { ctx->t = nullptr; ctx->i = -1; } }
      break; }
    case E_STEPBACK: E.setPos(*a, ai, a->lx[ai], a->ly[ai]); break;
    case E_UNDOALL: for (auto& t : E.types) for (int k = 0; k < t.n; k++) { int i = t.live[k]; E.setPos(t, i, t.lx[i], t.ly[i]); } break;
    case E_BOUNCEFORWARD: { if (!p) break; double u[2]; rcUnit(p->x[pi] - p->lx[pi], p->y[pi] - p->ly[pi], u); rcActive(E, *a, ai, u[0], u[1]); break; }
    case E_REVERSEDIRECTION: a->ox[ai] = -a->ox[ai]; a->oy[ai] = -a->oy[ai]; break;
    case E_TURNAROUND:
      E.setPos(*a, ai, a->lx[ai], a->ly[ai]);
      a->lastmove[ai] = i32(a->cooldown - 1);
      rcActive(E, *a, ai, 0, 1);
      a->ox[ai] = -a->ox[ai]; a->oy[ai] = -a->oy[ai];
      break;
    case E_WRAPAROUND: {
      double off = (args.is_object() && args.contains("offset") && truthy(args["offset"])) ? num(args["offset"]) : 0; int B = E.B;
      double x = a->x[ai], y = a->y[ai];
      if (a->ox[ai] > 0) x = off * B; else if (a->ox[ai] < 0) x = E.SW - B * (1 + off);
      if (a->oy[ai] > 0) y = off * B; else if (a->oy[ai] < 0) y = E.SH - B * (1 + off);
      E.setPos(*a, ai, i32(x), i32(y)); a->lastmove[ai] = 0;
      break; }
    case E_KILLIFOTHERHASMORE: if (p && rcResRead(*p, pi, argStr(args, "resource")) >= argNum(args, "limit", 1)) rcKill(E, *a, ai); break;
    case E_KILLIFHASMORE: if (rcResRead(*a, ai, argStr(args, "resource")) >= argNum(args, "limit", 1)) rcKill(E, *a, ai); break;
    case E_KILLIFHASLESS: if (rcResRead(*a, ai, argStr(args, "resource")) <= argNum(args, "limit", 1)) rcKill(E, *a, ai); break;
    case E_KILLIFOTHERHASLESS: if (p && rcResRead(*p, pi, argStr(args, "resource")) <= argNum(args, "limit", 1)) rcKill(E, *a, ai); break;
    case E_KILLIFALIVE: if (p && !p->killed[pi]) rcKill(E, *a, ai); break;
    case E_CHANGERESOURCE: { std::string r = argStr(args, "resource"); double v = argNum(args, "value", 1); resSet(*a, ai, r, std::max(-1.0, std::min(rcResRead(*a, ai, r) + v, rcLimit(E, r)))); break; }
    case E_COLLECTRESOURCE: { if (!p) break; std::string r = has(args, "resource") ? strOf(args["resource"]) : a->resType; resSet(*p, pi, r, std::max(-1.0, std::min(rcResRead(*p, pi, r) + a->value, rcLimit(E, r)))); rcKill(E, *a, ai); break; }
    case E_KILLIFFROMABOVE: if (p && a->ly[ai] > p->ly[pi] && p->y[pi] > p->ly[pi]) rcKill(E, *a, ai); break;
    default: break;
  }
}

// ---------- event handling (core.py:_eventHandling) ----------
struct RcEntry { std::vector<Type*> types; std::vector<std::pair<Type*, int>> list; int seqAt = 0; std::unordered_map<int, int> index; bool indexed = false; };
using RcCache = std::map<std::string, std::shared_ptr<RcEntry>>;
static inline int rcSpriteKey(const Type* a, int ai) { return (a->idx << 20) | ai; }
static std::shared_ptr<RcEntry> rcGroupEntry(Engine& E, const std::string& st, RcCache& cache) {
  auto it = cache.find(st); if (it != cache.end()) return it->second;
  auto e = std::make_shared<RcEntry>(); e->types = E.rcMemberTypes(st);
  for (Type* ty : e->types) for (int k = 0; k < ty->n; k++) e->list.push_back({ty, ty->live[k]});
  e->seqAt = E.seq; cache[st] = e; return e;
}
static const std::unordered_map<int, int>& rcEntryIndex(RcEntry& e) {
  if (!e.indexed) { for (size_t u = 0; u < e.list.size(); u++) e.index[rcSpriteKey(e.list[u].first, e.list[u].second)] = (int)u; e.indexed = true; }
  return e.index;
}
struct RcEv {
  Engine& E; RcCache cache; std::unordered_set<int> dead; std::unordered_set<uint64_t> collisionSet, newCollisions; std::vector<std::vector<int>> force;
  std::vector<std::pair<Type*, int>> cand; std::vector<std::pair<Type*, int>> candCopy;
  RcEv(Engine& e) : E(e) {}
  // candidates of the snapshot `e` overlapping (t,i), in snapshot order (type order, then creation seq)
  void collect(Type& t, int i, RcEntry& e) {
    cand.clear();
    for (Type* P : e.types) {
      if (P->n == 0) continue;
      E.collectType(t, i, *P);
      for (int j : E.cand) if (P->seq[j] < e.seqAt) cand.push_back({P, j});
    }
  }
  static bool setHas(const std::vector<int>& s, int k) { return std::find(s.begin(), s.end(), k) != s.end(); }
  void applyPair(Effect& eff, Type* s1, int i1, Type* s2, int i2) {
    if (s1 == s2 && i1 == i2) return;
    int k1 = rcSpriteKey(s1, i1), k2 = rcSpriteKey(s2, i2);
    if (dead.count(k1) || dead.count(k2)) return;
    uint64_t pk = ((uint64_t)k1 << 26) | (uint64_t)k2;
    if (collisionSet.count(pk)) return;
    newCollisions.insert(pk);
    if (eff.score != 0) E.score += eff.score;
    int id = eff.rcId;
    if (id == E_TRANSFORMTO) {
      Created c; rcEffect(E, id, s1, i1, s2, i2, eff.args, &c);
      if (c.t) newCollisions.insert(((uint64_t)k1 << 26) | (uint64_t)rcSpriteKey(c.t, c.i));
      dead.insert(k1);
    } else if (id == E_BOUNCEFORWARD) {
      for (auto& set : force) if (setHas(set, k2) && !setHas(set, k1)) set.push_back(k1);
      force.push_back({k1, k2});
      rcEffect(E, id, s1, i1, s2, i2, eff.args, nullptr);
      for (const auto& st : s1->stypes) cache.erase(st);
    } else if (id == E_STEPBACK) {
      for (auto& set : force) if (setHas(set, k1)) for (int sk : set) { Type* st = &E.types[sk >> 20]; int si = sk & 0xfffff; rcEffect(E, id, st, si, s2, i2, eff.args, nullptr); }
      rcEffect(E, id, s1, i1, s2, i2, eff.args, nullptr);
    } else if (id == E_TURNAROUND) {
      rcEffect(E, id, s1, i1, s2, i2, eff.args, nullptr);
      for (const auto& st : s1->stypes) cache.erase(st);
    } else if (id >= 0) {
      rcEffect(E, id, s1, i1, s2, i2, eff.args, nullptr);
    }
  }
  // position-invariant rule with a large actor group: enumerate from the partner side, replay in reference order
  void ruleSmallSide(Effect& eff, RcEntry& e1, RcEntry& e2) {
    struct P { long ord; Type* s1; int i1; Type* s2; int i2; };
    std::vector<P> pairs;
    const auto& idx1 = rcEntryIndex(e1);
    for (size_t v = 0; v < e2.list.size(); v++) {
      Type* s2 = e2.list[v].first; int i2 = e2.list[v].second;
      collect(*s2, i2, e1);
      for (auto& c : cand) pairs.push_back({(long)idx1.at(rcSpriteKey(c.first, c.second)) * 4096 + (long)v, c.first, c.second, s2, i2});
    }
    if (pairs.size() > 1) std::stable_sort(pairs.begin(), pairs.end(), [](const P& a, const P& b) { return a.ord < b.ord; });
    for (auto& p : pairs) applyPair(eff, p.s1, p.i1, p.s2, p.i2);
  }
  void run() {
    for (size_t k = 0; k < E.killList.size(); k += 2) dead.insert(rcSpriteKey(&E.types[E.killList[k]], E.killList[k + 1]));
    bool again = true;
    while (again) {
      newCollisions.clear();
      for (Effect* eff : E.rcEffects) {
        const std::string& c1 = eff->actor; const std::string& c2 = eff->actee;
        auto e1 = rcGroupEntry(E, c1, cache);
        if (c2 == "EOS") {
          for (auto& pr : e1->list) if (!E.contains(*pr.first, pr.second) && eff->rcId >= 0) rcEffect(E, eff->rcId, pr.first, pr.second, nullptr, -1, eff->args, nullptr);
          continue;
        }
        auto e2 = rcGroupEntry(E, c2, cache);
        if (e1->list.empty() || e2->list.empty()) continue;
        if (rcNoMove(eff->rcId) && e1->list.size() > 4 * e2->list.size()) { ruleSmallSide(*eff, *e1, *e2); continue; }
        for (size_t u = 0; u < e1->list.size(); u++) {
          Type* s1 = e1->list[u].first; int i1 = e1->list[u].second;
          collect(*s1, i1, *e2);
          if (cand.empty()) continue;
          candCopy = cand;   // effects below may relink cells
          for (auto& c : candCopy) applyPair(*eff, s1, i1, c.first, c.second);
        }
      }
      for (uint64_t pk : newCollisions) collisionSet.insert(pk);
      again = !newCollisions.empty();
    }
  }
};
void Engine::rcEvents() { RcEv ev(*this); ev.run(); }

// ---------- terminations (_isDone with bonuses) ----------
void Engine::rcCheckTerminations() {
  ended = false; won = false;
  for (Termination* tm : rcTerms) {
    const json& A = tm->args;
    double limit = (A.contains("limit") && truthy(A["limit"])) ? num(A["limit"]) : 0;
    double bonus = (A.contains("bonus") && truthy(A["bonus"])) ? num(A["bonus"]) : 0;
    if (tm->type == "Timeout") {
      if ((double)time >= limit) { ended = true; won = A.contains("win") && truthy(A["win"]); return; }
      if (time > timeoutBonusT) { score += bonus; timeoutBonusT = time; }
    } else if (tm->type == "SpriteCounter") {
      if (rcNumSprites(argStr(A, "stype")) <= limit) {
        if (time > spriteBonusT) { score += bonus; spriteBonusT = time; }
        ended = true; won = has(A, "win") ? truthy(A["win"]) : true; return;
      }
    } else if (tm->type == "MultiSpriteCounter") {
      double s = 0; for (auto it = A.begin(); it != A.end(); ++it) if (it.key().compare(0, 5, "stype") == 0) s += rcNumSprites(strOf(it.value()));
      if (s == limit) {
        if (time > spriteBonusT) { score += bonus; spriteBonusT = time; }
        ended = true; won = has(A, "win") ? truthy(A["win"]) : true; return;
      }
    }
  }
}

// ---------- tick (RLEnvironmentNonStatic.step + _performAction) ----------
void Engine::rcTick(const std::vector<int>& keysDown, bool isNull) {
  if (ended) { time += 1; return; }
  bool noop = !isNull && keysDown.empty();
  keys = keysDown;
  for (size_t a = 0; a < types.size(); a++) {
    Type& t = types[a];
    if (noop && (int)a == avatarT) continue;
    if (t.inert) continue;
    for (int k = 0; k < t.n; k++) { int i = t.live[k]; if (t.killed[i]) continue; rcUpdate(*this, t, i); }
  }
  rcEvents();
  rcFlush();
  time += 1;
  rcCheckTerminations();
}
void Engine::rcFlush() {
  for (auto& t : types) { if (t.n == 0) continue; int w = 0;
    for (int k = 0; k < t.n; k++) { int i = t.live[k]; if (t.killed[i]) { /* gridUnlink */ int c = t.cell[i]; if (c >= 0) { int p = t.head[c]; if (p == i) t.head[c] = t.next[i]; else { while (p >= 0 && t.next[p] != i) p = t.next[p]; if (p >= 0) t.next[p] = t.next[i]; } } t.cell[i] = -1; t.freeList.push_back(i); } else t.live[w++] = i; }
    t.n = w; }
  killList.clear();
}
}
