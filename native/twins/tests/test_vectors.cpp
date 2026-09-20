// T1 for CHIP-8: replay parity/chip8/tests/vectors/octax_tests.json on the C++ CPU (every field of every vector) and
// check randint_10k.json (10,000 keys: randint bytes and the sha1 of the split streams).
//   test_vectors <octax_tests.json> <randint_10k.json>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>
#include "../third_party/json.hpp"
#include "../chip8/cpu.hpp"
#include "../chip8/threefry.hpp"
using nlohmann::json;

// minimal SHA-1 for the split-stream check
static std::string sha1hex(const std::vector<uint8_t>& msg) {
  uint32_t h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  std::vector<uint8_t> m = msg; uint64_t ml = (uint64_t)msg.size() * 8; m.push_back(0x80);
  while (m.size() % 64 != 56) m.push_back(0); for (int i = 7; i >= 0; i--) m.push_back((uint8_t)(ml >> (i * 8)));
  for (size_t off = 0; off < m.size(); off += 64) {
    uint32_t w[80]; for (int i = 0; i < 16; i++) w[i] = ((uint32_t)m[off + 4 * i] << 24) | ((uint32_t)m[off + 4 * i + 1] << 16) | ((uint32_t)m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3];
    for (int i = 16; i < 80; i++) { uint32_t x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >> 31); }
    uint32_t a = h0, b = h1, c = h2, d = h3, e = h4;
    for (int i = 0; i < 80; i++) { uint32_t f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; } else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; } else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; } else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      uint32_t t = ((a << 5) | (a >> 27)) + f + e + k + w[i]; e = d; d = c; c = (b << 30) | (b >> 2); b = a; a = t; }
    h0 += a; h1 += b; h2 += c; h3 += d; h4 += e;
  }
  char out[41]; snprintf(out, sizeof out, "%08x%08x%08x%08x%08x", h0, h1, h2, h3, h4); return out;
}

static void load(chip8::Cpu& c, const json& st) {
  memset(c.mem, 0, sizeof c.mem); for (const auto& p : st["memory"]) c.mem[p[0].get<int>()] = (uint8_t)p[1].get<int>();
  c.pc = st["pc"]; c.I = st["I"]; for (int i = 0; i < 16; i++) c.V[i] = (uint8_t)st["V"][i].get<int>();
  c.sp = st["sp"]; for (int i = 0; i < 16; i++) c.stack[i] = (uint16_t)st["stack"][i].get<int>();
  c.delay = st["delay"]; c.sound = st["sound"]; for (int i = 0; i < 16; i++) c.keypad[i] = (uint8_t)st["keypad"][i].get<int>();
  std::string dh = st["display"]; for (size_t i = 0; i < dh.size(); i += 2) { int b = std::stoi(dh.substr(i, 2), nullptr, 16); for (int j = 0; j < 8; j++) c.display[(i / 2) * 8 + j] = (uint8_t)((b >> (7 - j)) & 1); }
  c.rng[0] = st["rng"][0].get<uint32_t>(); c.rng[1] = st["rng"][1].get<uint32_t>(); c.modern = st["modern"];
}
static json dump(const chip8::Cpu& c) {
  json m = json::array(); for (int a = 0; a < chip8::MEM; a++) if (c.mem[a]) m.push_back({a, (int)c.mem[a]});
  return {{"memory", m}, {"pc", c.pc}, {"I", c.I}, {"V", std::vector<int>(c.V, c.V + 16)}, {"sp", c.sp}, {"stack", std::vector<int>(c.stack, c.stack + 16)},
          {"delay", c.delay}, {"sound", c.sound}, {"keypad", std::vector<int>(c.keypad, c.keypad + 16)}, {"display", chip8::displayHex(c)},
          {"rng", std::vector<uint32_t>{c.rng[0], c.rng[1]}}, {"modern", c.modern}};
}

int main(int argc, char** argv) {
  if (argc < 3) { fprintf(stderr, "usage: test_vectors <octax_tests.json> <randint_10k.json>\n"); return 2; }
  json data; std::ifstream(argv[1]) >> data;
  int fails = 0, n = 0; chip8::Cpu c;
  for (const auto& v : data["vectors"]) {
    n++; load(c, v["pre"]); chip8::execute(c, v["instruction"].get<int>());
    json got = dump(c); const json& want = v["post"];
    for (auto it = got.begin(); it != got.end(); ++it) if (want[it.key()] != it.value()) {
      if (fails < 10) printf("MISMATCH #%d %s ins=%x field %s: want %s got %s\n", n, v["test"].get<std::string>().c_str(), v["instruction"].get<int>(), it.key().c_str(), want[it.key()].dump().substr(0, 120).c_str(), it.value().dump().substr(0, 120).c_str());
      fails++; break; }
  }
  printf("%d/%d vectors match (%d legacy-mode)\n", n - fails, n, data["n_legacy"].get<int>());
  json r; std::ifstream(argv[2]) >> r;
  uint32_t root0 = 0, root1 = (uint32_t)r["root_seed"].get<uint32_t>(); int N = r["n"];
  std::string hex; hex.reserve(2 * N); std::vector<uint8_t> words; words.reserve(16 * N); bool keysOk = true;
  static const char* hx = "0123456789abcdef";
  for (int j = 0; j < N; j++) {
    uint32_t k[2]; chip8::threefry2x32(root0, root1, 0, (uint32_t)j, k);
    if (j < 4 && (r["first_keys"][j][0].get<uint32_t>() != k[0] || r["first_keys"][j][1].get<uint32_t>() != k[1])) keysOk = false;
    uint32_t b = chip8::randint8(k[0], k[1]); hex.push_back(hx[b >> 4]); hex.push_back(hx[b & 15]);
    uint32_t s[4]; chip8::threefrySplit(k[0], k[1], s);
    for (int q = 0; q < 4; q++) for (int by = 0; by < 4; by++) words.push_back((uint8_t)(s[q] >> (8 * by)));   // uint32 little-endian
  }
  bool rOk = hex == r["randint_hex"].get<std::string>(), sOk = sha1hex(words) == r["split_sha1"].get<std::string>();
  printf("keys %s; randint %s; split sha1 %s\n", keysOk ? "ok" : "MISMATCH", rOk ? (std::to_string(N) + "/" + std::to_string(N)).c_str() : "MISMATCH", sOk ? "ok" : "MISMATCH");
  return (fails == 0 && keysOk && rOk && sOk) ? 0 : 1;
}
