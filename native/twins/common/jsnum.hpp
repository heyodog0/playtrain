// jsnum.hpp — ECMAScript Number.prototype.toString / JSON.stringify for a double: shortest round-trip decimal,
// integers without a fraction, -0 as "0". Shared by twin_host and the twins' snapshot() text.
#pragma once
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
namespace twin {
inline void jsnum(double v, char* out, size_t n) {
  if (v == 0) { snprintf(out, n, "0"); return; }
  if (std::isnan(v)) { snprintf(out, n, "NaN"); return; }
  if (std::isinf(v)) { snprintf(out, n, v > 0 ? "Infinity" : "-Infinity"); return; }
  if (v == std::floor(v) && std::fabs(v) < 1e21) { snprintf(out, n, "%.0f", v); return; }
  for (int p = 1; p <= 17; p++) { char b[64]; snprintf(b, sizeof b, "%.*g", p, v); if (strtod(b, nullptr) == v) { snprintf(out, n, "%s", b); return; } }
  snprintf(out, n, "%.17g", v);
}
inline std::string jsnum(double v) { char b[40]; jsnum(v, b, sizeof b); return b; }
}
