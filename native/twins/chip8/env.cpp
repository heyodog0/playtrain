#include "env.hpp"
#include <cmath>
#include <cstring>
#include <fstream>
namespace chip8 {
using nlohmann::json;

bool loadDef(const std::string& path, Def& d, std::string& err) {
  std::ifstream f(path); if (!f) { err = "chip8: cannot open " + path; return false; }
  try { f >> d.j; } catch (const std::exception& ex) { err = std::string("chip8: bad def JSON: ") + ex.what(); return false; }
  d.action_set.clear(); for (const auto& k : d.j["action_set"]) d.action_set.push_back(k.get<int>());
  d.startup_instructions = d.j.value("startup_instructions", 0);
  d.custom_startup = d.j["custom_startup"].is_null() ? std::string() : d.j["custom_startup"].get<std::string>();
  d.disable_delay = d.j.value("disable_delay", false);
  return true;
}

// ---- c8Eval ----
static inline char evalType(char a, char b) { if (a == 'i' || b == 'i') return 'i'; if (a == 'u' || b == 'u') return 'u'; return 'w'; }
static inline double wrap(double v, char t) {
  if (t == 'u') { double m = std::fmod(v, 256.0); return std::fmod(m + 256.0, 256.0); }
  if (t == 'i') { double m = std::fmod(std::trunc(v), 4294967296.0); if (m < 0) m += 4294967296.0; if (m >= 2147483648.0) m -= 4294967296.0; return m; }   // JS `v | 0`
  return v;
}
Val eval(const json& n, const Cpu& cpu) {
  const std::string op = n["op"].get<std::string>();
  if (op == "V") return {(double)cpu.V[n["i"].get<int>()], 'u'};
  if (op == "const") return {n["v"].get<double>(), 'w'};
  if (op == "i32") return {wrap(eval(n["a"], cpu).v, 'i'), 'i'};
  if (op == "u8") return {wrap(eval(n["a"], cpu).v, 'u'), 'u'};
  if (op == "neg") { Val a = eval(n["a"], cpu); return {wrap(-a.v, a.t), a.t}; }
  if (op == "add" || op == "sub" || op == "mul" || op == "floordiv" || op == "mod") {
    Val a = eval(n["a"], cpu), b = eval(n["b"], cpu); char t = evalType(a.t, b.t); double v;
    if (op == "add") v = a.v + b.v; else if (op == "sub") v = a.v - b.v; else if (op == "mul") v = a.v * b.v;
    else if (op == "floordiv") v = std::floor(a.v / b.v); else v = a.v - b.v * std::floor(a.v / b.v);
    return {wrap(v, t), t};
  }
  if (op == "eq" || op == "ne" || op == "gt" || op == "lt" || op == "ge" || op == "le") {
    double a = eval(n["a"], cpu).v, b = eval(n["b"], cpu).v; bool r;
    if (op == "eq") r = a == b; else if (op == "ne") r = a != b; else if (op == "gt") r = a > b; else if (op == "lt") r = a < b; else if (op == "ge") r = a >= b; else r = a <= b;
    return {r ? 1.0 : 0.0, 'b'};
  }
  if (op == "or") return {(eval(n["a"], cpu).v != 0 || eval(n["b"], cpu).v != 0) ? 1.0 : 0.0, 'b'};
  if (op == "and") return {(eval(n["a"], cpu).v != 0 && eval(n["b"], cpu).v != 0) ? 1.0 : 0.0, 'b'};
  if (op == "not") return {eval(n["a"], cpu).v != 0 ? 0.0 : 1.0, 'b'};
  if (op == "cond") return eval(n["c"], cpu).v != 0 ? eval(n["a"], cpu) : eval(n["b"], cpu);
  if (op == "false") return {0.0, 'b'};
  if (op == "true") return {1.0, 'b'};
  return {0.0, 'w'};   // unknown op: the JS throws; the def gate never lets one through
}
double evalScore(const Env& e) { return eval(e.def.j["score"], e.cpu).v; }

// ---- custom startups (deep.py, vertical_brix.py): hold one key for N instructions ----
static void startupHoldKey(Cpu& c, int key, int n) { c.keypad[key] = 1; for (int i = 0; i < n; i++) step(c); c.keypad[key] = 0; }

void create(Env& e, const Def& d, std::vector<uint8_t> rom) {
  e.def = d; e.rom = std::move(rom); e.noop = (int)d.action_set.size(); e.startupCached = false;
  e.time = 0; e.score = e.previousScore = e.reward = 0; e.terminated = e.truncated = false;
}
static void runStartup(Env& e) {
  Cpu& c = e.cpu;
  reset(c, 0, 0);                                  // create_state(PRNGKey(0))
  loadRom(c, e.rom.data(), e.rom.size());
  if (!e.def.custom_startup.empty()) {
    if (e.def.custom_startup == "deep") startupHoldKey(c, 0, 150);
    else if (e.def.custom_startup == "vertical_brix") startupHoldKey(c, 7, 1000);
  } else for (int i = 0; i < e.def.startup_instructions; i++) step(c);
  e.startup = c; e.startupCached = true;
}
void reset(Env& e, uint32_t seed) {
  if (!e.startupCached) runStartup(e); else { uint32_t r0 = e.cpu.rng[0], r1 = e.cpu.rng[1]; e.cpu = e.startup; e.cpu.rng[0] = r0; e.cpu.rng[1] = r1; }
  e.cpu.rng[0] = 0; e.cpu.rng[1] = seed;
  e.time = 0; e.score = evalScore(e); e.previousScore = e.score; e.reward = 0; e.terminated = false; e.truncated = false;
}
double stepEnv(Env& e, int action) {
  Cpu& c = e.cpu; bool press = action != e.noop;
  if (press) c.keypad[e.def.action_set[action]] = 1;
  for (int i = 0; i < INSTRUCTIONS_PER_ENV_STEP; i++) step(c);
  if (e.def.disable_delay) { c.delay = 0; c.sound = 0; } else { c.delay = (c.delay - 1) & 0xFF; c.sound = (c.sound - 1) & 0xFF; }
  if (press) c.keypad[e.def.action_set[action]] = 0;
  double current = evalScore(e);
  e.reward = current - e.previousScore; e.score = current; e.previousScore = current;
  e.time += 1;
  e.terminated = eval(e.def.j["terminated"], c).v != 0;
  e.truncated = e.time >= MAX_STEPS;
  return e.reward;
}
}
