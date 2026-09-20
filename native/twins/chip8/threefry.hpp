// threefry.hpp — JAX threefry2x32 (partitionable layout), split, 32-bit bits, randint(0,256,uint8): the C++ of
// examples/games/multifile/common/threefry2x32.js and parity/chip8/src/10_threefry.js, uint32 arithmetic throughout.
#pragma once
#include <cstdint>
namespace chip8 {
void threefry2x32(uint32_t k0, uint32_t k1, uint32_t x0, uint32_t x1, uint32_t out[2]);
inline uint32_t threefryBits32(uint32_t k0, uint32_t k1, uint32_t i) { uint32_t o[2]; threefry2x32(k0, k1, 0, i, o); return o[0] ^ o[1]; }
inline void threefrySplit(uint32_t k0, uint32_t k1, uint32_t out[4]) { uint32_t o[2]; threefry2x32(k0, k1, 0, 0, o); out[0] = o[0]; out[1] = o[1]; threefry2x32(k0, k1, 0, 1, o); out[2] = o[0]; out[3] = o[1]; }
// randint(key, (), 0, 256, uint8) == low byte of bits(split(key)[1])
inline uint32_t randint8(uint32_t k0, uint32_t k1) { uint32_t s[4]; threefrySplit(k0, k1, s); return threefryBits32(s[2], s[3], 0) & 0xFF; }
}
