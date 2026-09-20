// env.hpp — Octax's OctaxEnv on the CPU: parity/chip8/src/30_env.js (c8EnvCreate/Reset/Step, c8Eval with the JAX
// dtype rules, the custom startups, the cached post-startup state).
#pragma once
#include <string>
#include <vector>
#include "cpu.hpp"
#include "../third_party/json.hpp"
namespace chip8 {
constexpr int INSTRUCTIONS_PER_ENV_STEP = (700 / 60) * 4;   // 44
constexpr int MAX_STEPS = 4500;
struct Def {
  nlohmann::json j;                    // games/<game>.json as loaded
  std::vector<int> action_set;
  int startup_instructions = 0; std::string custom_startup; bool disable_delay = false;
};
struct Env {
  Def def; std::vector<uint8_t> rom; Cpu cpu;
  int noop = 0; bool startupCached = false; Cpu startup;   // snapshot of the post-startup CPU (rng excluded)
  long time = 0; double score = 0, previousScore = 0, reward = 0; bool terminated = false, truncated = false;
};
bool loadDef(const std::string& path, Def& d, std::string& err);
void create(Env& e, const Def& d, std::vector<uint8_t> rom);
void reset(Env& e, uint32_t seed);
double stepEnv(Env& e, int action);
double evalScore(const Env& e);
// c8Eval: {v, t} with t in u8 | i32 | weak | bool
struct Val { double v; char t; };
Val eval(const nlohmann::json& node, const Cpu& cpu);
}
