// test_ps_reference.cpp — T1 (PuzzleScript): the reference's runtime tests through the VM. Reads the export of
// parity/puzzlescript/tools/twin_state.mjs --tests (compiled state + inputs + expected level string + sounds per
// test), replays each test exactly as testingFrameWork.js runTest does, compares convertLevelToString() and the
// sound history. Prints passed/total and the first failures.
//   test_ps_reference <ps_tests.json> [--verbose] [--only <name substring>]
#include <cstdio>
#include <fstream>
#include <string>
#include "../puzzlescript/vm.hpp"
using ps::json;
int main(int argc, char** argv) {
  if (argc < 2) { fprintf(stderr, "usage: test_ps_reference <ps_tests.json> [--verbose] [--only substr]\n"); return 2; }
  bool verbose = false; std::string only; for (int i = 2; i < argc; i++) { std::string a = argv[i]; if (a == "--verbose") verbose = true; else if (a == "--only" && i + 1 < argc) only = argv[++i]; }
  std::ifstream f(argv[1]); if (!f) { fprintf(stderr, "cannot open %s\n", argv[1]); return 2; }
  json tests; try { f >> tests; } catch (const std::exception& e) { fprintf(stderr, "bad json: %s\n", e.what()); return 2; }
  int passed = 0, failed = 0, skipped = 0; std::vector<std::string> failures;
  for (const auto& t : tests) {
    std::string name = t["name"];
    if (!only.empty() && name.find(only) == std::string::npos) continue;
    if (!t["compileError"].is_null() || t["state"].is_null()) { skipped++; failures.push_back("SKIP (compile error in JS): " + name); continue; }
    ps::State S; std::string err;
    if (!S.load(t["state"], err)) { failed++; failures.push_back("LOAD: " + name + ": " + err); continue; }
    ps::VM vm; vm.unitTesting = true; vm.setState(&S);
    std::string seed; const std::string* seedp = nullptr; if (t["seed"].is_string()) { seed = t["seed"]; seedp = &seed; }
    try {
      int target = t["target"].is_string() ? std::stoi(t["target"].get<std::string>()) : t["target"].get<int>();   // testdata holds "7" for some: JS array indexing coerces
      vm.compileLoad(target, seedp);
      std::vector<json> inputs; for (const auto& v : t["inputs"]) inputs.push_back(v);
      vm.runTestLoop(inputs);
    } catch (const std::exception& e) { failed++; failures.push_back("THROW: " + name + ": " + e.what()); continue; }
    std::string got = vm.levelString(), exp = t["expected"];
    bool ok = got == exp;
    std::string soundNote;
    if (!t["expectedSounds"].is_null()) {
      std::string rec, ex; for (size_t k = 0; k < vm.soundHistory.size(); k++) { if (k) rec += ";"; rec += vm.soundHistory[k]; }
      size_t k = 0; for (const auto& s : t["expectedSounds"]) { if (k++) ex += ";"; ex += s.is_string() ? s.get<std::string>() : s.dump(); }
      if (rec != ex) { ok = false; soundNote = " sounds: got [" + rec + "] expected [" + ex + "]"; }
    }
    if (ok) passed++; else { failed++; failures.push_back("FAIL: " + name + soundNote + (verbose ? "\n--- got ---\n" + got + "--- expected ---\n" + exp : "")); }
  }
  printf("passed %d / %d (failed %d, skipped %d)\n", passed, passed + failed + skipped, failed, skipped);
  for (size_t k = 0; k < failures.size() && k < (verbose ? failures.size() : (size_t)25); k++) printf("  %s\n", failures[k].c_str());
  return failed == 0 ? 0 : 1;
}
