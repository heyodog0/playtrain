// engine.cpp — parity/vgdl/src/30_engine.js line for line (py-vgdl, Colas / infer-vgdl fork). Deviations from
// the JS are bugs, not features: the JS is the spec, its gates against py-vgdl are what make it authoritative.
#include "engine.hpp"
#include "../common/jsnum.hpp"
#include <algorithm>
#include <cstring>
#include <limits>
namespace vgdl {
static const int BASEDIRS[4][2] = {{0, -1}, {-1, 0}, {0, 1}, {1, 0}};   // UP LEFT DOWN RIGHT
struct ClassDef { bool is_static = false, is_resource = false, flicker = false, has_orientation = false, producer = false, spawn = false, fleeing = false; double value = NAN, limit = NAN, speed = NAN, cooldown = NAN, prob = NAN; const char* avatar = nullptr; };
static ClassDef classDef(const std::string& c) {
  ClassDef d;
  if (c == "Immovable") d.is_static = true;
  else if (c == "Resource") { d.value = 1; d.limit = 2; d.is_resource = true; }
  else if (c == "ResourcePack") { d.is_static = true; d.value = 1; d.limit = 2; d.is_resource = true; }
  else if (c == "Flicker") { d.limit = 1; d.flicker = true; }
  else if (c == "OrientedFlicker") { d.limit = 1; d.flicker = true; d.has_orientation = true; d.speed = 0; }
  else if (c == "Portal") { d.is_static = true; d.producer = true; }
  else if (c == "SpawnPoint") { d.is_static = true; d.producer = true; d.spawn = true; d.cooldown = 1; d.prob = 1; }
  else if (c == "RandomNPC") d.speed = 1;
  else if (c == "OrientedSprite") d.has_orientation = true;
  else if (c == "Missile") { d.has_orientation = true; d.speed = 1; }
  else if (c == "Bomber") { d.has_orientation = true; d.speed = 1; d.producer = true; d.spawn = true; d.cooldown = 1; d.prob = 1; }
  else if (c == "Chaser") d.speed = 1;
  else if (c == "Fleeing") { d.speed = 1; d.fleeing = true; }
  else if (c == "MovingAvatar") { d.speed = 1; d.avatar = "moving"; }
  else if (c == "HorizontalAvatar") { d.speed = 1; d.avatar = "horizontal"; }
  else if (c == "FlakAvatar") { d.speed = 1; d.avatar = "flak"; d.producer = true; }
  else if (c == "OrientedAvatar") { d.speed = 1; d.avatar = "oriented"; d.has_orientation = true; }
  else if (c == "ShootAvatar") { d.speed = 1; d.avatar = "shoot"; d.has_orientation = true; d.producer = true; }
  else if (c == "GravityAvatar") { d.speed = 1; d.avatar = "gravity"; }
  return d;   // VGDLSprite / Passive / unknown: all defaults
}
static const std::vector<std::vector<int>> ACTS_MOVING = {{K_UP}, {K_DOWN}, {K_LEFT}, {K_RIGHT}, {}};
static const std::vector<std::vector<int>> ACTS_HORIZ = {{K_LEFT}, {K_RIGHT}, {}};
static const std::vector<std::vector<int>> ACTS_FLAK = {{K_LEFT}, {K_RIGHT}, {}, {K_SPACE}};
static const std::vector<std::vector<int>> ACTS_SHOOT = {{K_UP}, {K_DOWN}, {K_LEFT}, {K_RIGHT}, {}, {K_SPACE}};
static const std::vector<std::vector<int>>* avatarActs(const std::string& a) {
  if (a == "moving" || a == "oriented") return &ACTS_MOVING; if (a == "horizontal") return &ACTS_HORIZ;
  if (a == "flak") return &ACTS_FLAK; if (a == "shoot" || a == "gravity") return &ACTS_SHOOT; return nullptr;
}
// JS value helpers over the spec's args (numbers, bools, null, strings, arrays)
static bool has(const json& a, const char* k) { return a.is_object() && a.contains(k) && !a[k].is_null(); }   // `!= null`
static double num(const json& v) { return v.is_number() ? v.get<double>() : v.is_boolean() ? (v.get<bool>() ? 1 : 0) : NAN; }
static bool truthy(const json& v) { if (v.is_null()) return false; if (v.is_boolean()) return v.get<bool>(); if (v.is_number()) { double d = v.get<double>(); return d != 0 && !std::isnan(d); } if (v.is_string()) return !v.get<std::string>().empty(); return true; }
static std::string strOf(const json& v) { return v.is_string() ? v.get<std::string>() : v.dump(); }   // JS `'' + v` for the strings a spec holds
// Int32Array store
static int32_t i32(double v) { if (std::isnan(v) || std::isinf(v)) return 0; double t = std::trunc(v); double m = std::fmod(t, 4294967296.0); if (m < 0) m += 4294967296.0; return (int32_t)(uint32_t)m; }
// V8 Math.hypot: scale by the max, Kahan-summed squares
static double jsHypot(double x, double y) {
  double ax = std::fabs(x), ay = std::fabs(y), mx = ax > ay ? ax : ay;
  if (mx == 0) return 0; if (std::isinf(ax) || std::isinf(ay)) return INFINITY;
  double sum = 0, comp = 0; const double vs[2] = {ax, ay};
  for (double v : vs) { double n = v / mx; double summand = n * n - comp; double prelim = sum + summand; comp = (prelim - sum) - summand; sum = prelim; }
  return std::sqrt(sum) * mx;
}

// ---------- types ----------
static void typeAlloc(Type& t, int cap) {
  auto grow = [&](auto& v, auto zero) { v.resize(cap, zero); };
  grow(t.live, 0); grow(t.x, 0); grow(t.y, 0); grow(t.lx, 0); grow(t.ly, 0); grow(t.lastmove, 0); grow(t.ox, 0.0); grow(t.oy, 0.0);
  grow(t.age, 0); grow(t.counter, 0); grow(t.killed, (uint8_t)0); grow(t.jpT, 0); grow(t.jpI, 0); grow(t.seq, 0); grow(t.jump, 0); grow(t.next, 0); grow(t.cell, 0);
  t.res.resize(cap);
  for (int i = t.cap; i < cap; i++) t.freeList.push_back(i);
  t.cap = cap;
}
static void makeType(Type& t, int idx, const std::string& key, const json& def) {
  t.idx = idx; t.key = key; t.cls = def.value("cls", ""); if (def.contains("cls") && def["cls"].is_null()) t.cls = "";
  const json& A = def["args"]; t.args = A;
  t.stypes.clear(); for (const auto& s : def["stypes"]) t.stypes.push_back(s.get<std::string>());
  ClassDef cd = classDef(t.cls);
  t.speed = (has(A, "speed") && num(A["speed"]) != 0) ? num(A["speed"]) : (!std::isnan(cd.speed) ? cd.speed : NAN);
  t.cooldown = (has(A, "cooldown") && num(A["cooldown"]) != 0) ? num(A["cooldown"]) : (!std::isnan(cd.cooldown) && cd.cooldown != 0 ? cd.cooldown : 0);
  t.isStatic = cd.is_static; t.onlyActive = false;
  t.hasOrient = cd.has_orientation || has(A, "orientation");
  if (has(A, "orientation") && A["orientation"].is_array() && A["orientation"].size() >= 2) { t.ox0 = num(A["orientation"][0]); t.oy0 = num(A["orientation"][1]); } else { t.ox0 = 1; t.oy0 = 0; }
  t.avatar = cd.avatar ? cd.avatar : ""; t.acts = cd.avatar ? avatarActs(t.avatar) : nullptr;
  t.flicker = cd.flicker; t.limit = has(A, "limit") ? num(A["limit"]) : (!std::isnan(cd.limit) ? cd.limit : 1);
  t.spawn = cd.spawn; t.prob = has(A, "prob") ? num(A["prob"]) : (!std::isnan(cd.prob) ? cd.prob : 1);
  t.total = (A.contains("total") && truthy(A["total"])) ? num(A["total"]) : 0;
  t.hasStype = has(A, "stype"); t.stype = t.hasStype ? strOf(A["stype"]) : "";
  t.hasAmmo = has(A, "ammo"); t.ammo = t.hasAmmo ? strOf(A["ammo"]) : "";
  t.chaser = t.cls == "Chaser" || t.cls == "Fleeing"; t.fleeing = cd.fleeing || (A.contains("fleeing") && A["fleeing"].is_boolean() && A["fleeing"].get<bool>());
  t.isResource = cd.is_resource; t.value = has(A, "value") ? num(A["value"]) : (!std::isnan(cd.value) ? cd.value : 1);
  t.resType = has(A, "res_type") ? strOf(A["res_type"]) : key;
  t.singleton = false; t.aligned = true;
  t.cap = 0; t.n = 0; t.freeList.clear();
  if (t.cls == "Fleeing") t.fleeing = true;
  typeAlloc(t, 16);
}

// ---------- cell grid ----------
static inline int cellOf(const Engine& E, int x, int y) {
  int cx = (int)std::floor((double)x / E.B), cy = (int)std::floor((double)y / E.B);
  if (cx < 0 || cy < 0 || cx >= E.W || cy >= E.H) return -1;
  return cy * E.W + cx;
}
static inline void gridLink(Engine& E, Type& t, int i) {
  int c = cellOf(E, t.x[i], t.y[i]); t.cell[i] = c;
  if (c < 0) { t.next[i] = -1; return; }
  t.next[i] = t.head[c]; t.head[c] = i;
}
static inline void gridUnlink(Type& t, int i) {
  int c = t.cell[i]; if (c < 0) return;
  int p = t.head[c];
  if (p == i) { t.head[c] = t.next[i]; return; }
  while (p >= 0 && t.next[p] != i) p = t.next[p];
  if (p >= 0) t.next[p] = t.next[i];
}
void Engine::setPos(Type& t, int i, int x, int y) {
  if (x == t.x[i] && y == t.y[i]) return;
  if (B != 1 && (x % B != 0 || y % B != 0)) t.aligned = false;
  int c = cellOf(*this, x, y);
  if (c != t.cell[i]) { gridUnlink(t, i); t.x[i] = x; t.y[i] = y; gridLink(*this, t, i); }
  else { t.x[i] = x; t.y[i] = y; }
}

// ---------- sprites ----------
int Engine::create(const std::string& key, int x, int y, bool skipSingleton) {
  Type* tp = typeOf(key); if (!tp) return -1; Type& t = *tp;
  if (!skipSingleton && t.singleton && t.n > 0) return -1;
  if (t.freeList.empty()) typeAlloc(t, t.cap * 2);
  int i = t.freeList.back(); t.freeList.pop_back();
  t.live[t.n++] = i;
  t.x[i] = x; t.y[i] = y; t.lx[i] = x; t.ly[i] = y;
  if (B != 1 && (x % B != 0 || y % B != 0)) t.aligned = false;
  t.lastmove[i] = 0; t.ox[i] = t.ox0; t.oy[i] = t.oy0;
  t.age[i] = 0; t.counter[i] = 0; t.killed[i] = 0; t.jpT[i] = -1; t.jpI[i] = -1; t.jump[i] = 0;
  t.seq[i] = seq++; t.res[i].clear();
  gridLink(*this, t, i);
  return i;
}
void Engine::kill(Type& t, int i) { if (!t.killed[i]) { t.killed[i] = 1; killList.push_back(t.idx); killList.push_back(i); } }
double resGet(const Type& t, int i, const std::string& r) { auto it = t.res[i].find(r); return it == t.res[i].end() ? 0 : it->second; }
void resSet(Type& t, int i, const std::string& r, double v) { t.res[i][r] = v; }
static double resClamp(const Engine& E, const std::string& r, double v) { auto it = E.resLimits.find(r); double lim = it == E.resLimits.end() ? INFINITY : it->second; return std::max(0.0, std::min(v, lim)); }

// sprites of an stype: a type (typeOf != null) or an abstract group snapshot
const Group& Engine::group(const std::string& st) {
  if (ssOn) { auto it = ss.find(st); if (it != ss.end()) return it->second; }
  Group out;
  for (auto& ty : types) if (std::find(ty.stypes.begin(), ty.stypes.end(), st) != ty.stypes.end()) for (int k = 0; k < ty.n; k++) out.push_back({&ty, ty.live[k]});
  if (ssOn) return ss[st] = std::move(out);
  scratchGroup = std::move(out); return scratchGroup;
}
int Engine::numSprites(const std::string& st) { Type* t = typeOf(st); if (t) return t->n; return (int)group(st).size(); }

// ---------- movement ----------
void Engine::updatePosition(Type& t, int i, double dx, double dy) {
  if (t.lastmove[i] >= t.cooldown) {
    setPos(t, i, i32(t.x[i] + std::trunc(dx)), i32(t.y[i] + std::trunc(dy)));
    t.lastmove[i] = 0;
  }
}
static inline double speedOf(const Type& t) { return std::isnan(t.speed) ? 1 : t.speed; }
static void passive(Engine& E, Type& t, int i) {
  if (!t.hasOrient) return;
  double sp = speedOf(t);
  if (sp != 0) E.updatePosition(t, i, t.ox[i] * sp * E.B, t.oy[i] * sp * E.B);
}
void Engine::active(Type& t, int i, double vx, double vy, double speedOverride) {
  double sp = !std::isnan(speedOverride) ? speedOverride : speedOf(t);
  if (sp != 0) updatePosition(t, i, vx * sp * B, vy * sp * B);
}
void Engine::baseUpdate(Type& t, int i) {
  t.lx[i] = t.x[i]; t.ly[i] = t.y[i];
  t.lastmove[i] += 1;
  if (!t.isStatic && !t.onlyActive) passive(*this, t, i);
}

// ---------- avatar input ----------
std::vector<int> Engine::readAction(const std::vector<std::vector<int>>& acts) const {
  const std::vector<int>& k = keys; int n = (int)k.size();
  auto hasCombo = [&](const std::vector<int>& combo) { for (const auto& a : acts) if (a == combo) return true; return false; };
  for (int m = std::max(3, n); m >= 0; m--) {
    if (m > n) continue;
    if (m == 0) return {};
    if (m == 1) { for (int a = 0; a < n; a++) if (hasCombo({k[a]})) return {k[a]}; continue; }
    if (m == 2) { for (int a = 0; a < n; a++) for (int b = a + 1; b < n; b++) if (hasCombo({k[a], k[b]})) return {k[a], k[b]}; continue; }
    for (int a = 0; a < n; a++) for (int b = a + 1; b < n; b++) for (int c = b + 1; c < n; c++) if (hasCombo({k[a], k[b], k[c]})) return {k[a], k[b], k[c]};
  }
  return {};
}
static inline bool incl(const std::vector<int>& a, int v) { return std::find(a.begin(), a.end(), v) != a.end(); }
static inline int vecX(const std::vector<int>& a) { return (incl(a, K_RIGHT) ? 1 : 0) - (incl(a, K_LEFT) ? 1 : 0); }
static inline int vecY(const std::vector<int>& a) { return (incl(a, K_DOWN) ? 1 : 0) - (incl(a, K_UP) ? 1 : 0); }
static inline bool isSpace(const std::vector<int>& a) { return a.size() == 1 && a[0] == K_SPACE; }

// ---------- class updates ----------
static void updBase(Engine& E, Type& t, int i) { E.baseUpdate(t, i); }
static void updMoving(Engine& E, Type& t, int i) {
  E.baseUpdate(t, i);
  auto a = E.readAction(*t.acts);
  if (!a.empty()) E.active(t, i, vecX(a), vecY(a));
}
static void updHorizontal(Engine& E, Type& t, int i) {
  E.baseUpdate(t, i);
  auto a = E.readAction(*t.acts); int vx = vecX(a), vy = vecY(a);
  if (vy == 0 && (vx == 1 || vx == -1)) E.active(t, i, vx, vy);
}
static void updFlak(Engine& E, Type& t, int i) {
  updHorizontal(E, t, i);
  if (t.hasStype && incl(E.keys, K_SPACE)) E.create(t.stype, t.x[i], t.y[i]);
}
static std::vector<int> updOriented(Engine& E, Type& t, int i) {
  double lox = t.ox[i], loy = t.oy[i];
  t.ox[i] = 0; t.oy[i] = 0;
  E.baseUpdate(t, i);
  auto a = E.readAction(*t.acts);
  if (!a.empty()) E.active(t, i, vecX(a), vecY(a));
  int dx = t.x[i] - t.lx[i], dy = t.y[i] - t.ly[i];
  if (dx != 0 || dy != 0) { t.ox[i] = dx; t.oy[i] = dy; } else { t.ox[i] = lox; t.oy[i] = loy; }
  return a;
}
static bool hasAmmo(const Type& t, int i) { if (!t.hasAmmo) return true; auto it = t.res[i].find(t.ammo); return it != t.res[i].end() && it->second > 0; }
static void updShoot(Engine& E, Type& t, int i) {
  auto a = updOriented(E, t, i);
  if (hasAmmo(t, i) && isSpace(a) && t.hasStype) {
    double ux = t.ox[i], uy = t.oy[i]; double L = jsHypot(ux, uy);
    if (L > 0) { ux /= L; uy /= L; } else { ux = 1; uy = 0; }
    int nx = i32(std::trunc(t.lx[i] + ux * E.B)), ny = i32(std::trunc(t.ly[i] + uy * E.B));
    Type* st = E.typeOf(t.stype);
    int j = E.create(t.stype, nx, ny);
    if (j >= 0 && st->hasOrient) { st->ox[j] = ux; st->oy[j] = uy; }
    if (t.hasAmmo) { auto it = t.res[i].find(t.ammo); if (it != t.res[i].end()) it->second -= 1; }
  }
}
static void updRandom(Engine& E, Type& t, int i) {
  E.baseUpdate(t, i);
  const int* d = BASEDIRS[E.rng.choiceIndex(4)];
  E.active(t, i, d[0], d[1]);
}
static inline int hamm(int x1, int y1, int x2, int y2) { return std::abs(y1 - y2) + std::abs(x1 - x2); }
static void updChaser(Engine& E, Type& t, int i) {
  E.baseUpdate(t, i);
  double bestd = INFINITY; std::vector<int> tx, ty;
  auto consider = [&](int X, int Y) { int d = hamm(t.x[i], t.y[i], X, Y); if (d < bestd) { bestd = d; tx.clear(); ty.clear(); tx.push_back(X); ty.push_back(Y); } else if (d == bestd) { tx.push_back(X); ty.push_back(Y); } };
  Type* g = E.typeOf(t.stype);
  if (g) { for (int k = 0; k < g->n; k++) { int gi = g->live[k]; consider(g->x[gi], g->y[gi]); } }
  else { Group grp = E.group(t.stype); for (auto& pr : grp) consider(pr.first->x[pr.second], pr.first->y[pr.second]); }
  std::vector<const int*> opts;
  for (size_t k = 0; k < tx.size(); k++) {
    int base = hamm(t.x[i], t.y[i], tx[k], ty[k]);
    for (int d = 0; d < 4; d++) { const int* a = BASEDIRS[d];
      int nd = hamm(t.x[i] + a[0], t.y[i] + a[1], tx[k], ty[k]);
      if (t.fleeing && base < nd) opts.push_back(a);
      if (!t.fleeing && base > nd) opts.push_back(a);
    }
  }
  const int* d = opts.empty() ? BASEDIRS[E.rng.choiceIndex(4)] : opts[E.rng.choiceIndex((int)opts.size())];
  E.active(t, i, d[0], d[1]);
}
static void updSpawn(Engine& E, Type& t, int i) {
  if (std::fmod((double)E.time, t.cooldown) == 0 && E.rng.random() < t.prob) {
    E.createKeys.push_back(t.stype); E.createXY.push_back(t.x[i]); E.createXY.push_back(t.y[i]);
    t.counter[i] += 1;
  }
  if (t.total != 0 && t.counter[i] >= t.total) E.kill(t, i);
}
static void updBomber(Engine& E, Type& t, int i) { E.baseUpdate(t, i); updSpawn(E, t, i); }
static void updFlicker(Engine& E, Type& t, int i) {
  E.baseUpdate(t, i);
  t.age[i] += 1;
  if (t.age[i] >= t.limit) E.kill(t, i);
}
static bool gravBlocked(Engine& E, Type& t, int i, int x, int y) {
  int B = E.B;
  for (auto& ty : E.types) {
    if (ty.isStatic) { if (ty.key != "wall" && ty.key != "breakwall") continue; }
    else if (ty.avatar.empty()) continue;
    for (int k = 0; k < ty.n; k++) { int j = ty.live[k]; if (&ty == &t && j == i) continue;
      if (ty.x[j] < x + B && ty.x[j] + B > x && ty.y[j] < y + B && ty.y[j] + B > y) return true; }
  }
  return false;
}
static bool gravOnGround(Engine& E, Type& t, int i) {
  int B = E.B;
  if (gravBlocked(E, t, i, t.x[i], t.y[i] + B)) return true;
  return t.y[i] + B + B >= E.SH;
}
static void updGravity(Engine& E, Type& t, int i) {
  t.lx[i] = t.x[i]; t.ly[i] = t.y[i];
  auto a = E.readAction(*t.acts); int B = E.B;
  bool movedUp = false;
  if (t.jump[i] > 0) {
    if (!gravBlocked(E, t, i, t.x[i], t.y[i] - B)) { E.setPos(t, i, t.x[i], t.y[i] - B); t.jump[i] -= 1; movedUp = true; }
    else t.jump[i] = 0;
  }
  int vx = vecX(a), vy = vecY(a);
  if (vy == 0 && (vx == 1 || vx == -1)) { if (!gravBlocked(E, t, i, t.x[i] + vx * B, t.y[i])) E.setPos(t, i, t.x[i] + vx * B, t.y[i]); }
  if (incl(a, K_SPACE) && gravOnGround(E, t, i) && t.jump[i] == 0) t.jump[i] = 2;
  bool onGround = gravOnGround(E, t, i);
  if (!movedUp && !onGround) { if (!gravBlocked(E, t, i, t.x[i], t.y[i] + B)) E.setPos(t, i, t.x[i], t.y[i] + B); }
}
static void updOrientedOnly(Engine& E, Type& t, int i) { updOriented(E, t, i); }
static Updater updaterFor(const Type& t) {
  const std::string& c = t.cls;
  if (c == "MovingAvatar") return updMoving; if (c == "HorizontalAvatar") return updHorizontal; if (c == "FlakAvatar") return updFlak;
  if (c == "OrientedAvatar") return updOrientedOnly; if (c == "ShootAvatar") return updShoot; if (c == "GravityAvatar") return updGravity;
  if (c == "RandomNPC") return updRandom; if (c == "Chaser" || c == "Fleeing") return updChaser; if (c == "SpawnPoint") return updSpawn;
  if (c == "Bomber") return updBomber; if (c == "Flicker" || c == "OrientedFlicker") return updFlicker;
  return updBase;
}

// ---------- effects ----------
static void stepBackPusher(Engine& E, Type& t, int i, int depth) {
  if (depth > 5) return;
  int pt = t.jpT[i]; if (pt < 0) return;
  Type& P = E.types[pt]; int pi = t.jpI[i];
  E.setPos(P, pi, P.lx[pi], P.ly[pi]);
  stepBackPusher(E, P, pi, depth + 1);
}
static void findOriginMvt(Engine& E, Type& t, int i, int depth, double out[2]) {
  if (t.jpT[i] >= 0 && depth < 3) { findOriginMvt(E, E.types[t.jpT[i]], t.jpI[i], depth + 1, out); return; }
  out[0] = t.x[i] - t.lx[i]; out[1] = t.y[i] - t.ly[i];
}
static void unit(double v[2]) { double L = jsHypot(v[0], v[1]); if (L > 0) { v[0] /= L; v[1] /= L; } else { v[0] = 1; v[1] = 0; } }
static double argNum(const json& a, const char* k, double dflt) { return has(a, k) ? num(a[k]) : dflt; }
static std::string argStr(const json& a, const char* k) { return has(a, k) ? strOf(a[k]) : ""; }
using EffFn = void (*)(Engine&, Type*, int, Type*, int, const json&);
static void efKillSprite(Engine& E, Type* a, int ai, Type*, int, const json&) { E.kill(*a, ai); }
static void efKillBoth(Engine& E, Type* a, int ai, Type* p, int pi, const json&) { E.kill(*a, ai); if (p) E.kill(*p, pi); }
static void efKillIfAlive(Engine& E, Type* a, int ai, Type* p, int pi, const json&) { if (!p || !p->killed[pi]) E.kill(*a, ai); }
static void efChangeScore(Engine&, Type*, int, Type*, int, const json&) {}
static void efTransformTo(Engine& E, Type* a, int ai, Type*, int, const json& args) {
  E.kill(*a, ai); std::string st = (args.is_object() && args.contains("stype") && truthy(args["stype"])) ? strOf(args["stype"]) : "wall";
  E.createKeys.push_back(st); E.createXY.push_back(a->x[ai]); E.createXY.push_back(a->y[ai]);
}
static void efStepBack(Engine& E, Type* a, int ai, Type* p, int pi, const json& args) {
  if (p && p->killed[pi]) return; if (a->killed[ai]) return;
  bool noSym = args.is_object() && args.contains("no_symmetry") && truthy(args["no_symmetry"]);
  if (a->x[ai] == a->lx[ai] && a->y[ai] == a->ly[ai] && !noSym) {
    if (p) { E.setPos(*p, pi, p->lx[pi], p->ly[pi]); stepBackPusher(E, *p, pi, 0); }
  } else { E.setPos(*a, ai, a->lx[ai], a->ly[ai]); stepBackPusher(E, *a, ai, 0); }
}
static void efUndoAll(Engine& E, Type*, int, Type*, int, const json&) { for (auto& t : E.types) for (int k = 0; k < t.n; k++) { int i = t.live[k]; E.setPos(t, i, t.lx[i], t.ly[i]); } }
static void efBounceForward(Engine& E, Type* a, int ai, Type* p, int pi, const json&) {
  if (!p) return;   // JS would throw on an EOS bounceForward; no spec does this
  double d[2]; findOriginMvt(E, *p, pi, 0, d);
  if (std::fabs(d[0]) + std::fabs(d[1]) == 0) {
    findOriginMvt(E, *a, ai, 0, d); unit(d); E.active(*p, pi, d[0], d[1]); p->jpT[pi] = a->idx; p->jpI[pi] = ai; p->jpDirty = true;
  } else { unit(d); E.active(*a, ai, d[0], d[1]); a->jpT[ai] = p->idx; a->jpI[ai] = pi; a->jpDirty = true; }
}
static void efReverseDirection(Engine& E, Type* a, int ai, Type*, int, const json& args) {
  bool noStep = args.is_object() && args.contains("with_step_back") && args["with_step_back"].is_boolean() && args["with_step_back"].get<bool>() == false;
  if (!noStep) E.setPos(*a, ai, a->lx[ai], a->ly[ai]);
  if (a->hasOrient) { a->ox[ai] = -a->ox[ai]; a->oy[ai] = -a->oy[ai]; }
}
static void efTurnAround(Engine& E, Type* a, int ai, Type* p, int pi, const json&) {
  E.setPos(*a, ai, a->lx[ai], a->ly[ai]);
  a->lastmove[ai] = i32(a->cooldown);
  E.active(*a, ai, 0, 1, 1);
  json args = json::object(); args["with_step_back"] = false;
  efReverseDirection(E, a, ai, p, pi, args);
}
static void efCollectResource(Engine& E, Type* a, int ai, Type* p, int pi, const json&) { const std::string& r = a->resType; resSet(*p, pi, r, resClamp(E, r, resGet(*p, pi, r) + a->value)); }
static void efChangeResource(Engine& E, Type* a, int ai, Type*, int, const json& args) { E.resChanges.push_back({a->idx, ai, argStr(args, "resource"), argNum(args, "value", 1)}); }
static void efAddResource(Engine& E, Type* a, int ai, Type* p, int pi, const json& args) { E.resChanges.push_back({p->idx, pi, argStr(args, "resource"), argNum(args, "value", 1)}); E.kill(*a, ai); }
static void efRemoveResource(Engine& E, Type* a, int ai, Type* p, int pi, const json& args) { E.resChanges.push_back({p->idx, pi, argStr(args, "resource"), argNum(args, "value", -1)}); E.kill(*a, ai); }
static void efKillIfHasMore(Engine& E, Type* a, int ai, Type*, int, const json& args) { if (resGet(*a, ai, argStr(args, "resource")) >= argNum(args, "limit", 1)) E.kill(*a, ai); }
static void efKillIfOtherHasMore(Engine& E, Type* a, int ai, Type* p, int pi, const json& args) { if (resGet(*p, pi, argStr(args, "resource")) >= argNum(args, "limit", 1)) E.kill(*a, ai); }
static void efKillIfHasLess(Engine& E, Type* a, int ai, Type*, int, const json& args) { if (resGet(*a, ai, argStr(args, "resource")) <= argNum(args, "limit", 1)) E.kill(*a, ai); }
static void efKillIfOtherHasLess(Engine& E, Type* a, int ai, Type* p, int pi, const json& args) { if (resGet(*p, pi, argStr(args, "resource")) <= argNum(args, "limit", 1)) E.kill(*a, ai); }
static void efTeleportToExit(Engine& E, Type* a, int ai, Type* p, int, const json&) {
  Type* X = p && p->hasStype ? E.typeOf(p->stype) : nullptr;
  if (X && X->n > 0) { int j = X->live[E.rng.choiceIndex(X->n)]; E.setPos(*a, ai, X->x[j], X->y[j]); }
  a->lastmove[ai] = 0;
}
static void efDestroyAllBreakwalls(Engine& E, Type*, int, Type* p, int pi, const json&) {
  Group items; Type* g = E.typeOf("breakwall");
  if (g) { for (int k = 0; k < g->n; k++) items.push_back({g, g->live[k]}); } else items = E.group("breakwall");
  json args = json::object(); args["stype"] = "floor";
  for (auto& pr : items) efTransformTo(E, pr.first, pr.second, p, pi, args);
}
static EffFn effectFn(const std::string& n) {
  static const std::pair<const char*, EffFn> T[] = {
    {"killSprite", efKillSprite}, {"killBoth", efKillBoth}, {"killIfAlive", efKillIfAlive}, {"changeScore", efChangeScore}, {"transformTo", efTransformTo},
    {"stepBack", efStepBack}, {"undoAll", efUndoAll}, {"bounceForward", efBounceForward}, {"reverseDirection", efReverseDirection}, {"turnAround", efTurnAround},
    {"collectResource", efCollectResource}, {"changeResource", efChangeResource}, {"addResource", efAddResource}, {"removeResource", efRemoveResource},
    {"killIfHasMore", efKillIfHasMore}, {"killIfOtherHasMore", efKillIfOtherHasMore}, {"killIfHasLess", efKillIfHasLess}, {"killIfOtherHasLess", efKillIfOtherHasLess},
    {"teleportToExit", efTeleportToExit}, {"DestroyAllBreakwalls", efDestroyAllBreakwalls}};
  for (auto& e : T) if (n == e.first) return e.second;
  return nullptr;
}
static bool isMoveEffect(const std::string& n) { return n == "stepBack" || n == "bounceForward" || n == "reverseDirection" || n == "turnAround"; }

// ---------- collisions ----------
void Engine::collectType(Type& t, int i, Type& P) {
  cand.clear();
  if (B == 1) {
    int c = t.cell[i]; if (c < 0) return;
    for (int j = P.head[c]; j >= 0; j = P.next[j]) cand.push_back(j);
  } else {
    int x0 = t.x[i], y0 = t.y[i];
    int cx = (int)std::floor((double)x0 / B), cy = (int)std::floor((double)y0 / B);
    int xa = cx - 1, xb = cx + 1, ya = cy - 1, yb = cy + 1;
    if (P.aligned) { xa = cx; xb = (int)std::floor((double)(x0 + B - 1) / B); ya = cy; yb = (int)std::floor((double)(y0 + B - 1) / B); }
    for (int y = ya; y <= yb; y++) { if (y < 0 || y >= H) continue;
      for (int x = xa; x <= xb; x++) { if (x < 0 || x >= W) continue;
        for (int j = P.head[y * W + x]; j >= 0; j = P.next[j]) if (overlap(t, i, P, j)) cand.push_back(j);
      } }
  }
  if (cand.size() > 1) std::stable_sort(cand.begin(), cand.end(), [&](int u, int v) { return P.seq[u] < P.seq[v]; });
}

void Engine::applyEffect(Effect& e) {
  EffFn fn = (EffFn)e.fn;
  Type* A = e.A; const Group* AG = nullptr; if (!A) AG = &group(e.actor);
  if (e.actee == "EOS") {
    if (A && A->inert) return;
    auto run = [&](Type& t, int i) {
      if (contains(t, i)) return;
      score += e.score;
      if (fn) fn(*this, &t, i, nullptr, -1, e.args);
      if (!contains(t, i)) kill(t, i);
    };
    if (AG) { Group g = *AG; for (int k = (int)g.size() - 1; k >= 0; k--) run(*g[k].first, g[k].second); }
    else { for (int k = A->n - 1; k >= 0; k--) run(*A, A->live[k]); }
    return;
  }
  Type* P = e.P; const Group* PG = nullptr; if (!P) PG = &group(e.actee);
  // the ss map may rehash between the two group() calls above: re-fetch by key (values are stable per tick)
  if (AG) AG = &ss[e.actor]; if (PG) PG = &ss[e.actee];
  int nA = A ? A->n : (int)AG->size(), nP = P ? P->n : (int)PG->size();
  if (nA == 0 || nP == 0) return;
  Type* outerT = A; const Group* outerG = AG; Type* innerT = P; const Group* innerG = PG; bool reverse = false;
  if (nA > nP) { outerT = P; outerG = PG; innerT = A; innerG = AG; reverse = true; }
  int nOuter = outerT ? outerT->n : (int)outerG->size();
  for (int k = 0; k < nOuter; k++) {
    Type* t; int i;
    if (outerG) { t = (*outerG)[k].first; i = (*outerG)[k].second; } else { t = outerT; i = outerT->live[k]; }
    if (innerG) {
      for (size_t q = 0; q < innerG->size(); q++) { Type* pt = (*innerG)[q].first; int pi = (*innerG)[q].second;
        if (pt == t && pi == i) continue;
        if (!overlap(*t, i, *pt, pi)) continue;
        if (reverse) { if (!pt->killed[pi]) { score += e.score; if (fn) fn(*this, pt, pi, t, i, e.args); } }
        else { if (!t->killed[i]) { score += e.score; if (fn) fn(*this, t, i, pt, pi, e.args); } }
      }
    } else {
      collectType(*t, i, *innerT);
      size_t nc = cand.size();
      for (size_t q = 0; q < nc; q++) { int j = cand[q];
        if (innerT == t && j == i) continue;
        if (reverse) { if (!innerT->killed[j]) { score += e.score; if (fn) fn(*this, innerT, j, t, i, e.args); } }
        else { if (!t->killed[i]) { score += e.score; if (fn) fn(*this, t, i, innerT, j, e.args); } }
      }
    }
  }
}

// ---------- level ----------
static std::vector<std::string> levelLines(const std::string& s) {
  std::vector<std::string> out; size_t p = 0;
  while (p <= s.size()) { size_t q = s.find('\n', p); if (q == std::string::npos) q = s.size(); if (q > p) out.push_back(s.substr(p, q - p)); p = q + 1; }
  return out;
}
void Engine::buildLevel(const std::string& levelStr) {
  auto lines = levelLines(levelStr);
  H = (int)lines.size(); W = 0; for (auto& l : lines) if ((int)l.size() > W) W = (int)l.size();
  SW = W * B; SH = H * B;
  for (auto& t : types) { t.n = 0; t.freeList.clear(); for (int i = t.cap - 1; i >= 0; i--) t.freeList.push_back(i); t.head.assign((size_t)W * H, -1); }
  seq = 0;
  for (int r = 0; r < (int)lines.size(); r++) {
    const std::string& line = lines[r];
    for (int c = 0; c < (int)line.size(); c++) {
      auto it = spec.charMap.find(line[c]); if (it == spec.charMap.end()) continue;
      for (const auto& k : it->second) create(k, c * B, r * B);
    }
  }
}

void Engine::init(const json& s, int blockSize) {
  spec.j = s; B = blockSize ? blockSize : 1;
  spec.keys.clear(); for (const auto& k : s["keys"]) spec.keys.push_back(k.get<std::string>());
  spec.charMap.clear(); for (auto it = s["charMap"].begin(); it != s["charMap"].end(); ++it) { std::string ch = it.key(); if (ch.size() != 1) continue; std::vector<std::string> ks; for (const auto& k : it.value()) ks.push_back(k.get<std::string>()); spec.charMap[ch[0]] = ks; }
  spec.singletons.clear(); if (s.contains("singletons")) for (const auto& k : s["singletons"]) spec.singletons.push_back(k.get<std::string>());
  spec.terminations.clear(); for (const auto& t : s["terminations"]) { Termination tm; tm.type = t.value("type", ""); tm.args = t.contains("args") ? t["args"] : json::object(); spec.terminations.push_back(tm); }
  types.clear(); types.resize(spec.keys.size()); byKey.clear(); resLimits.clear();
  for (size_t idx = 0; idx < spec.keys.size(); idx++) {
    const std::string& k = spec.keys[idx]; Type& t = types[idx];
    makeType(t, (int)idx, k, s["defs"][k]);
    t.singleton = std::find(spec.singletons.begin(), spec.singletons.end(), k) != spec.singletons.end(); t.upd = updaterFor(t);
    t.inert = t.isStatic && t.upd == updBase;
    t.jpDirty = false;
    byKey[k] = &t;
  }
  for (auto& t : types) if (t.isResource) { if (has(t.args, "limit")) resLimits[t.resType] = num(t.args["limit"]); }
  spec.interactions.clear();
  for (const auto& e : s["interactions"]) {
    Effect f; f.actor = e.value("actor", ""); f.actee = e.value("actee", ""); f.name = e.value("name", ""); if (e.contains("name") && e["name"].is_null()) f.name = "";
    f.score = e.contains("score") ? num(e["score"]) : 0; if (std::isnan(f.score)) f.score = 0; f.args = e.contains("args") ? e["args"] : json::object();
    f.fn = (decltype(f.fn))effectFn(f.name);
    f.A = typeOf(f.actor); f.P = f.actee == "EOS" ? nullptr : typeOf(f.actee);
    spec.interactions.push_back(f);
  }
  stepBacks.clear(); moveEffs.clear(); nonMove.clear();
  for (auto& e : spec.interactions) { if (e.name == "stepBack") stepBacks.push_back(&e); if (e.name == "bounceForward" || e.name == "reverseDirection" || e.name == "turnAround") moveEffs.push_back(&e); if (!isMoveEffect(e.name)) nonMove.push_back(&e); }
  n0.assign(types.size(), 0);
}

void Engine::reset(const std::string& levelStr, uint32_t seedv) {
  rng.seed(seedv);
  buildLevel(levelStr);
  time = 0; score = 0; ended = false; won = false;
  killList.clear(); createKeys.clear(); createXY.clear(); resChanges.clear();
}

// ---------- tick ----------
void Engine::tick(const std::vector<int>& keysDown) {
  time += 1;
  if (ended) return;
  keys = keysDown;
  for (size_t a = 0; a < types.size(); a++) { Type& t = types[a]; n0[a] = t.n; if (t.jpDirty) { for (int k = 0; k < t.n; k++) t.jpT[t.live[k]] = -1; t.jpDirty = false; } }
  for (size_t a = 0; a < types.size(); a++) { Type& t = types[a]; if (t.inert) continue; int m = n0[a]; Updater upd = t.upd; for (int k = 0; k < m; k++) upd(*this, t, t.live[k]); }
  ss.clear(); ssOn = true;
  for (auto* e : stepBacks) applyEffect(*e);
  for (auto* e : moveEffs) applyEffect(*e);
  for (auto* e : stepBacks) applyEffect(*e);
  for (auto* e : nonMove) applyEffect(*e);
  ssOn = false; ss.clear();
  flush();
  checkTerminations();
}
void Engine::flush() {
  for (auto& t : types) {
    if (t.n == 0) continue;
    int w = 0;
    for (int k = 0; k < t.n; k++) { int i = t.live[k]; if (t.killed[i]) { gridUnlink(t, i); t.cell[i] = -1; t.freeList.push_back(i); } else t.live[w++] = i; }
    t.n = w;
  }
  killList.clear();
  for (size_t k = 0; k < createKeys.size(); k++) create(createKeys[k], createXY[2 * k], createXY[2 * k + 1]);
  createKeys.clear(); createXY.clear();
  for (auto& rc : resChanges) { Type& t = types[rc.t]; resSet(t, rc.i, rc.r, resClamp(*this, rc.r, resGet(t, rc.i, rc.r) + rc.v)); }
  resChanges.clear();
}
void Engine::checkTerminations() {
  for (auto& tm : spec.terminations) {
    bool e = false, w = false; const json& A = tm.args;
    double limit = (A.contains("limit") && truthy(A["limit"])) ? num(A["limit"]) : 0;
    bool winArg = A.contains("win") && truthy(A["win"]);
    if (tm.type == "Timeout") { if ((double)time >= limit) { e = true; w = winArg; } }
    else if (tm.type == "SpriteCounter") { if (numSprites(argStr(A, "stype")) <= limit) { e = true; w = winArg; } }
    else if (tm.type == "MultiSpriteCounter") { double s = 0; for (auto it = A.begin(); it != A.end(); ++it) if (it.key().compare(0, 5, "stype") == 0) s += numSprites(strOf(it.value())); if (s == limit) { e = true; w = has(A, "win") ? truthy(A["win"]) : true; } }
    ended = e; won = w;
    if (e) { score += (A.contains("scoreChange") && truthy(A["scoreChange"])) ? num(A["scoreChange"]) : 0; break; }
  }
}

// ---------- snapshot: the JSON text of vgSnapshot()'s rows, sorted as JS does (by their JSON text) ----------
std::string Engine::snapshotJson() const {
  std::vector<std::string> rows;
  for (const auto& t : types) for (int k = 0; k < t.n; k++) {
    int i = t.live[k]; std::string r = "[" + json(t.key).dump() + "," + std::to_string(t.x[i]) + "," + std::to_string(t.y[i]) + ",[";
    bool first = true; for (const auto& kv : t.res[i]) { if (!first) r += ","; first = false; r += "[" + json(kv.first).dump() + "," + twin::jsnum(kv.second) + "]"; }
    r += "]]"; rows.push_back(std::move(r));
  }
  std::sort(rows.begin(), rows.end());   // ASCII keys: byte order == UTF-16 code unit order
  std::string out = "["; for (size_t k = 0; k < rows.size(); k++) { if (k) out += ","; out += rows[k]; } out += "]";
  return out;
}
}
