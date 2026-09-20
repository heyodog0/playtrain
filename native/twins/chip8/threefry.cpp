#include "threefry.hpp"
namespace chip8 {
static inline uint32_t rotl32(uint32_t x, int r) { return (x << r) | (x >> (32 - r)); }
void threefry2x32(uint32_t k0, uint32_t k1, uint32_t x0, uint32_t x1, uint32_t out[2]) {
  const uint32_t ks0 = k0, ks1 = k1, ks2 = ks0 ^ ks1 ^ 0x1BD11BDAu;
  uint32_t v0 = x0 + ks0, v1 = x1 + ks1;
  static const int RA[4] = {13, 15, 26, 6}, RB[4] = {17, 29, 16, 24};
  const uint32_t ks[3] = {ks0, ks1, ks2};
  for (int g = 0; g < 5; g++) {
    const int* R = (g % 2 == 0) ? RA : RB;
    for (int r = 0; r < 4; r++) { v0 += v1; v1 = rotl32(v1, R[r]); v1 ^= v0; }
    v0 += ks[(g + 1) % 3]; v1 += ks[(g + 2) % 3] + (uint32_t)(g + 1);
  }
  out[0] = v0; out[1] = v1;
}
}
