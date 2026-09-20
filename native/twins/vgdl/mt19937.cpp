#include "mt19937.hpp"
#include <vector>
namespace vgdl {
static const int N = 624, M = 397;
void MT::initGenrand(uint32_t s) {
  mt[0] = s;
  for (int i = 1; i < N; i++) { uint32_t p = mt[i - 1] ^ (mt[i - 1] >> 30); mt[i] = 1812433253u * p + (uint32_t)i; }
  mti = N;
}
void MT::seed(uint64_t n) {
  std::vector<uint32_t> key;
  if (n == 0) key.push_back(0);
  while (n > 0) { key.push_back((uint32_t)(n & 0xFFFFFFFFu)); n >>= 32; }
  initGenrand(19650218u);
  int i = 1, j = 0; int k = (int)(N > (int)key.size() ? N : key.size());
  for (; k; k--) {
    uint32_t p = mt[i - 1] ^ (mt[i - 1] >> 30);
    mt[i] = (mt[i] ^ (p * 1664525u)) + key[j] + (uint32_t)j;
    i++; j++;
    if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    if (j >= (int)key.size()) j = 0;
  }
  for (k = N - 1; k; k--) {
    uint32_t p = mt[i - 1] ^ (mt[i - 1] >> 30);
    mt[i] = (mt[i] ^ (p * 1566083941u)) - (uint32_t)i;
    i++;
    if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
  }
  mt[0] = 0x80000000u;
}
uint32_t MT::u32() {
  uint32_t y;
  if (mti >= N) {
    int kk;
    for (kk = 0; kk < N - M; kk++) { y = (mt[kk] & 0x80000000u) | (mt[kk + 1] & 0x7fffffffu); mt[kk] = mt[kk + M] ^ (y >> 1) ^ ((y & 1) ? 0x9908b0dfu : 0); }
    for (; kk < N - 1; kk++) { y = (mt[kk] & 0x80000000u) | (mt[kk + 1] & 0x7fffffffu); mt[kk] = mt[kk + (M - N)] ^ (y >> 1) ^ ((y & 1) ? 0x9908b0dfu : 0); }
    y = (mt[N - 1] & 0x80000000u) | (mt[0] & 0x7fffffffu); mt[N - 1] = mt[M - 1] ^ (y >> 1) ^ ((y & 1) ? 0x9908b0dfu : 0);
    mti = 0;
  }
  y = mt[mti++];
  y ^= y >> 11; y ^= (y << 7) & 0x9d2c5680u; y ^= (y << 15) & 0xefc60000u; y ^= y >> 18;
  return y;
}
double MT::random() { uint32_t a = u32() >> 5, b = u32() >> 6; return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0); }
uint32_t MT::randbelow(uint32_t n) {
  if (n == 0) return 0;
  int k = 32 - __builtin_clz(n);
  uint32_t r = u32() >> (32 - k);
  while (r >= n) r = u32() >> (32 - k);
  return r;
}
}
