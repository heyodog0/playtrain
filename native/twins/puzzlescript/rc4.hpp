// rc4.hpp — the reference's rng.js: RC4 keyed by the seed string's bytes (String.prototype.getBytes: each UTF-16
// code unit split big-endian into bytes), uniform() = 7 bytes as a 56-bit integer / (2^56 - 1).
#pragma once
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>
namespace ps {
struct RC4 {
  uint8_t s[256]; int i = 0, j = 0;
  void init(const std::string& seed) {
    i = 0; j = 0; for (int k = 0; k < 256; k++) s[k] = (uint8_t)k;
    if (!seed.empty()) mix(seed);
  }
  static std::vector<int> bytesOf(const std::string& seed) {
    // the seeds the engine sees are ASCII/Latin-1 text (numbers as decimal strings); wider code units would need UTF-16
    std::vector<int> out; for (unsigned char c : seed) { int v = c; std::vector<int> b; do { b.push_back(v & 0xFF); v >>= 8; } while (v > 0); for (auto it = b.rbegin(); it != b.rend(); ++it) out.push_back(*it); }
    return out;
  }
  void mix(const std::string& seed) {
    std::vector<int> in = bytesOf(seed); int jj = 0;
    for (int k = 0; k < 256; k++) { jj += s[k] + in[k % in.size()]; jj %= 256; uint8_t t = s[k]; s[k] = s[jj]; s[jj] = t; }
  }
  int next() { i = (i + 1) % 256; j = (j + s[i]) % 256; uint8_t t = s[i]; s[i] = s[j]; s[j] = t; return s[(s[i] + s[j]) % 256]; }
  double uniform() { double out = 0; for (int k = 0; k < 7; k++) { out *= 256; out += next(); } return out / (std::pow(2.0, 56) - 1); }
};
}
