// mt19937.hpp — CPython's random.Random, bit-exact: parity/vgdl/src/10_rng_mt19937.js (init_genrand, init_by_array
// over the 32-bit limbs of |n|, genrand_uint32, random() as a 53-bit float, _randbelow by rejection, choice).
#pragma once
#include <cstdint>
namespace vgdl {
struct MT {
  uint32_t mt[624]; int mti = 625;
  void initGenrand(uint32_t s);
  void seed(uint64_t n);                 // random.seed(int)
  uint32_t u32();
  double random();                       // 53-bit
  uint32_t randbelow(uint32_t n);
  int choiceIndex(int len) { return (int)randbelow((uint32_t)len); }
};
}
