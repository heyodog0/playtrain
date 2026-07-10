// jsmath.h — JS-semantics numeric helpers for bit-exact-to-V8 game logic.
//
// The generated C++ maps `Math.*` and p5 math helpers here. Only the operations
// the game subset actually uses are provided. See docs/NATIVE_COMPILE.md §5.
//
//   - Integer / bitwise / imul / mulberry32: exact u32 wrapping (bit-identical).
//   - sqrt, +,-,*,/: IEEE-exact (compile with -ffp-contract=off, no FMA fusion).
//   - sin/cos: matched by psin/pcos (rasterizer already uses these).
//   - pow/atan/atan2/hypot: the transcendentals flagged as needing a v8-libm
//     port. Currently forwarded to std:: — the differential gate is the arbiter;
//     if a game diverges, replace the forward here with a bit-exact fdlibm port.
#ifndef NODE_GYM_JSMATH_H
#define NODE_GYM_JSMATH_H

#include <cstdint>
#include <cmath>
#include <algorithm>

namespace js {

// --- exact integer ops ---
inline int32_t to_int32(double x) {
  // ToInt32 (ECMAScript): the low 32 bits of the truncated value, as int32.
  return static_cast<int32_t>(static_cast<uint32_t>(static_cast<int64_t>(x)));
}
inline uint32_t to_uint32(double x) {
  return static_cast<uint32_t>(static_cast<int64_t>(x));
}
// Math.imul(a,b): 32-bit integer multiply with wraparound.
inline int32_t imul(int32_t a, int32_t b) {
  return static_cast<int32_t>(static_cast<uint32_t>(a) * static_cast<uint32_t>(b));
}

// JS `%` (remainder): sign follows the dividend; operands are doubles.
inline double mod(double a, double b) { return std::fmod(a, b); }

// --- rounding ---
// Math.round: round half toward +Infinity (NOT away-from-zero like std::round).
inline double jround(double x) { return std::floor(x + 0.5); }

// --- transcendentals / reals ---
inline double floor(double x) { return std::floor(x); }
inline double ceil(double x)  { return std::ceil(x); }
inline double abs(double x)   { return std::fabs(x); }
inline double sqrt(double x)  { return std::sqrt(x); }
inline double pow(double b, double e)   { return std::pow(b, e); }   // v8-libm candidate
inline double atan2(double y, double x) { return std::atan2(y, x); } // v8-libm candidate
inline double hypot(double x, double y) { return std::hypot(x, y); } // v8-libm candidate

// psin/pcos — bit-identical to the rasterizer's psin/pcos (lib.rs) and the JS
// shim's _rsin/_rcos. Used wherever the game calls sin/cos so game logic matches
// the rasterizer's own geometry and V8.
constexpr double TWO_PI = 6.283185307179586;
constexpr double PI_R   = 3.141592653589793;
constexpr double PI_H   = 1.5707963267948966;
inline double sin(double x) {
  x = x - TWO_PI * std::floor((x + PI_R) / TWO_PI);
  double x2 = x * x;
  return x * (1.0 + x2 * (-0.16666666666666666 +
              x2 * (0.008333333333333333 +
              x2 * (-0.0001984126984126984 +
              x2 * 0.0000027557319223985893))));
}
inline double cos(double x) { return sin(x + PI_H); }

// Variadic min/max matching Math.min/Math.max (2+ args in the game subset).
inline double max(double a, double b) { return a > b ? a : b; }
inline double min(double a, double b) { return a < b ? a : b; }
template <typename... R> inline double max(double a, double b, R... r) { return max(max(a, b), r...); }
template <typename... R> inline double min(double a, double b, R... r) { return min(min(a, b), r...); }

// mulberry32 — the canonical seeded PRNG idiom in the game catalog. JS returns a
// stateful closure `() => {...}`; the compiler recognizes the pattern and emits
// this functor. Bit-exact: all ops are u32-wrapping; xor/shift on the bit pattern
// reproduce JS's ToInt32/ToUint32 coercions exactly (see NATIVE_COMPILE.md §5).
struct Mulberry32 {
  uint32_t t;
  explicit Mulberry32(uint32_t seed = 0) : t(seed) {}
  double operator()() {
    t += 0x6D2B79F5u;
    uint32_t n = (t ^ (t >> 15)) * (t | 1u);
    n ^= n + (n ^ (n >> 7)) * (n | 61u);
    return static_cast<double>(n ^ (n >> 14)) / 4294967296.0;
  }
};

// --- p5 math helpers ---
inline double dist(double x1, double y1, double x2, double y2) {
  return std::sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
}
inline double constrain(double v, double lo, double hi) { return min(max(v, lo), hi); }
inline double lerp(double a, double b, double t) { return a + (b - a) * t; }
inline double map(double v, double s1, double e1, double s2, double e2) {
  return s2 + (e2 - s2) * ((v - s1) / (e1 - s1));
}

}  // namespace js

#endif  // NODE_GYM_JSMATH_H
