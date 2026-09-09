#include <cstring>
#include <type_traits>
#include <cstdint>
#pragma once
#include <cmath>
#include <limits>
#define V8_INLINE inline
#define V8_BASE_EXPORT
namespace v8 { namespace base {
template <typename T> inline T Divide(T a, T b) { return a / b; }
template <typename To, typename From> inline To bit_cast(const From& f) {
  static_assert(sizeof(To) == sizeof(From), "size mismatch");
  To t; __builtin_memcpy(&t, &f, sizeof(To)); return t;
}
}}
#define V8_WARN_UNUSED_RESULT
#define UNLIKELY(x) (x)
#define LIKELY(x) (x)
#define DCHECK(x)
#define USE(...)
namespace v8 { namespace base {
template <typename T> inline T NegateWithWraparound(T a) {
  using U = typename std::make_unsigned<T>::type;
  return static_cast<T>(U(0) - static_cast<U>(a));
}
inline int32_t SubWithWraparound(int32_t a, int32_t b) {
  return static_cast<int32_t>(static_cast<uint32_t>(a) - static_cast<uint32_t>(b));
}
inline int32_t AddWithWraparound(int32_t a, int32_t b) {
  return static_cast<int32_t>(static_cast<uint32_t>(a) + static_cast<uint32_t>(b));
}
}}
