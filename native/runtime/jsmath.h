// jsmath.h — JS-semantics numeric helpers for bit-exact-to-V8 game logic.
//
// The native p5 rasterizer (runtime/p5.cpp, via p5.hpp) maps `Math.*` and p5 math
// helpers here. Only the operations the game subset actually uses are provided.
//
//   - Integer / bitwise / imul / mulberry32: exact u32 wrapping (bit-identical).
//   - sqrt, +,-,*,/: IEEE-exact (compile with -ffp-contract=off, no FMA fusion).
//   - sin/cos: matched by psin/pcos (rasterizer already uses these).
//   - pow/atan/atan2/hypot: the transcendentals flagged as needing a v8-libm
//     port. Currently forwarded to std:: — the differential gate is the arbiter;
//     if a game diverges, replace the forward here with a bit-exact fdlibm port.
#ifndef PLAYTRAIN_JSMATH_H
#define PLAYTRAIN_JSMATH_H

#include <cstdint>
#include <cmath>
#include <limits>
#include <algorithm>

// V8's own fdlibm port, vendored at native/qjs/v8libm/ieee754.cc. Math.sin and
// friends in the reference runtime are THESE functions. openlibm's do not
// match: 18 sin and 23 cos disagreements in 2001 samples, each 1 ULP,
// enough to make jetpack_joyride.spaceship-viz-v2 fail native/gate_qjs.sh.
// C++ linkage, at global scope, on purpose: declared inside extern "C" these
// mangle to plain `sin`/`cos` and silently bind to the platform libm.
namespace v8 { namespace base { namespace ieee754 {
double sin(double); double cos(double); double acos(double); double atan2(double, double);
}}}

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
// FROZEN transcendentals: vendored fdlibm (openlibm) compiled into every target
// (native + wasm), so pow/atan2 are bit-identical across platforms and engines
// (browser == training). NOT the platform libm (Apple/glibc/musl differ by ULPs).
// See native/frozenmath/. sin/cos are frozen separately via psin/pcos below;
// sqrt/floor/ceil/abs are IEEE-exact (correctly rounded) everywhere.
extern "C" {
double fm_pow(double, double);
double fm_atan2(double, double);
double fm_sin(double);
double fm_cos(double);
double fm_acos(double);
}
inline double floor(double x) { return std::floor(x); }
inline double ceil(double x)  { return std::ceil(x); }
inline double abs(double x)   { return std::fabs(x); }
inline double sqrt(double x)  { return std::sqrt(x); }
// Math.pow in V8 (src/numbers/ieee754.cc, use_std_math_pow, the default) is the
// platform std::pow behind a few special cases that mirror what its optimizing
// compilers emit. Not fdlibm: openlibm's pow was 1 in 2001 off, which is what
// kept suika diverging after sin/cos were fixed. This follows the platform libm
// exactly as V8 does, so native and node agree on any one machine.
inline double pow(double x, double y) {
  if (std::isnan(y)) return std::numeric_limits<double>::quiet_NaN();
  if (std::isinf(y) && (x == 1 || x == -1)) return std::numeric_limits<double>::quiet_NaN();
  if (std::isnan(x)) x = std::numeric_limits<double>::quiet_NaN();
  if (y == 2) return x * x;
  if (y == 0.5) {
    if (std::isinf(x)) return std::numeric_limits<double>::infinity();
    return std::sqrt(x + 0);     // +0 so (-0)**0.5 is +0, as in V8
  }
  return std::pow(x, y);
}
inline double atan2(double y, double x) { return v8::base::ieee754::atan2(y, x); }
inline double hypot(double x, double y) { return std::sqrt(x * x + y * y); }  // deterministic (games use small coords)

// GAME-VISIBLE sin/cos must be fdlibm (what V8 gives Math.sin), NOT the
// psin/pcos polynomial: a generated asteroids clone diverged from the V8 reference the
// moment accumulated ship angles hit the poly's error. psin/pcos remain the
// rasterizer's INTERNAL geometry (crates/rasterizer lib.rs, p5 shim _rsin/
// _rcos) — that pair is bit-identical across engines because both rasterizer
// builds use it; games never see it through Math.*.
constexpr double TWO_PI = 6.283185307179586;
constexpr double PI_R   = 3.141592653589793;
constexpr double PI_H   = 1.5707963267948966;
inline double sin(double x) { return v8::base::ieee754::sin(x); }
inline double cos(double x) { return v8::base::ieee754::cos(x); }
// Matter.js calls Math.acos (Vector.angle between bodies). Left on the platform
// libm it is the one transcendental the engines disagree on in the physics
// games: suika matched V8 for 353 steps and then drifted (native/gate_qjs.sh).
inline double acos(double x) { return v8::base::ieee754::acos(x); }

// Variadic min/max matching Math.min/Math.max (2+ args in the game subset).
inline double max(double a, double b) { return a > b ? a : b; }
inline double min(double a, double b) { return a < b ? a : b; }
template <typename... R> inline double max(double a, double b, R... r) { return max(max(a, b), r...); }
template <typename... R> inline double min(double a, double b, R... r) { return min(min(a, b), r...); }

// mulberry32 — the canonical seeded PRNG idiom in the game catalog. JS returns a
// stateful closure `() => {...}`; this functor reproduces it. Bit-exact: all ops
// are u32-wrapping; xor/shift on the bit pattern reproduce JS's ToInt32/ToUint32
// coercions exactly. Verified end-to-end by native/gate_qjs.sh.
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

#endif  // PLAYTRAIN_JSMATH_H
