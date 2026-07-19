// jsvalue.h — dynamic JS value + object runtime for the native game twins.
//
// The static path (structs + vectors + double) covers most game logic. This is
// the ESCAPE VALVE for the genuinely-dynamic bits the design doc flags as YELLOW:
//   - object-as-dictionary (obj[key]=v, delete obj[key], for..in)   [47 games]
//   - values whose type isn't statically fixed                       [boxing]
//
// It is affordable because we measured logic = ~0.5% of a frame (rasterizer-bound);
// boxing cold/dynamic logic costs almost nothing at the frame level.
//
// BIT-EXACTNESS: js::Object reproduces JS object semantics that games observe —
//   (1) keys are strings (numeric subscripts are coerced),
//   (2) `for..in` / Object.keys order = ES2015: integer-index keys ascending,
//       then string keys in INSERTION order (std::unordered_map would NOT do this
//       and would reorder draw calls -> frame divergence),
//   (3) delete removes the key from the ordering.
#ifndef PLAYTRAIN_JSVALUE_H
#define PLAYTRAIN_JSVALUE_H

#include <string>
#include <vector>
#include <memory>
#include <unordered_map>
#include <cstdint>
#include <cstdio>
#include "jsmath.h"

namespace js {

struct Object;

// A boxed JS value: number | string | object | bool | undefined.
struct Value {
  enum Tag { UNDEF, NUM, STR, OBJ, BOOL } tag = UNDEF;
  double num = 0;
  std::string str;
  std::shared_ptr<Object> obj;

  Value() {}
  Value(double n) : tag(NUM), num(n) {}
  Value(int n) : tag(NUM), num(n) {}
  Value(bool b) : tag(BOOL), num(b ? 1 : 0) {}
  Value(const char* s) : tag(STR), str(s) {}
  Value(const std::string& s) : tag(STR), str(s) {}
  Value(std::shared_ptr<Object> o) : tag(OBJ), obj(std::move(o)) {}

  double toNum() const { return tag == NUM || tag == BOOL ? num : 0; }
  bool truthy() const {
    switch (tag) {
      case NUM: return num != 0;         // (NaN handled elsewhere; games use finite)
      case BOOL: return num != 0;
      case STR: return !str.empty();
      case OBJ: return (bool)obj;
      default: return false;             // undefined/null
    }
  }
  // number->string with JS Number.prototype.toString semantics for the integer
  // case (the only case used as an object key in the catalog).
  static std::string numKey(double d) {
    long long i = (long long)d;
    if ((double)i == d) return std::to_string(i);
    char buf[32]; snprintf(buf, sizeof buf, "%.17g", d); return std::string(buf);
  }
};

// Is `s` a canonical array-index string (per ES: "0" or non-zero-leading digits,
// value < 2^32-1)? Those keys iterate first, in ascending numeric order.
inline bool isArrayIndex(const std::string& s, uint32_t& out) {
  if (s.empty() || s.size() > 10) return false;
  if (s.size() > 1 && s[0] == '0') return false;
  uint64_t v = 0;
  for (char c : s) { if (c < '0' || c > '9') return false; v = v * 10 + (c - '0'); }
  if (v >= 4294967295ULL) return false;
  out = (uint32_t)v; return true;
}

// Insertion-ordered, string-keyed map with ES2015 for..in ordering.
struct Object {
  std::unordered_map<std::string, Value> data;
  std::vector<uint32_t> intKeys;     // canonical array indices (sorted on iterate)
  std::vector<std::string> strKeys;  // other keys, insertion order (tombstoned on delete)

  bool has(const std::string& k) const { return data.find(k) != data.end(); }

  Value& at(const std::string& k) {
    auto it = data.find(k);
    if (it != data.end()) return it->second;
    // JS: reading a missing key yields undefined; create-on-write for `obj[k].x=..`
    return set(k, Value());
  }
  Value get(const std::string& k) const {
    auto it = data.find(k);
    return it != data.end() ? it->second : Value();
  }
  Value& set(const std::string& k, const Value& v) {
    auto it = data.find(k);
    if (it == data.end()) {
      uint32_t idx;
      if (isArrayIndex(k, idx)) intKeys.push_back(idx);
      else strKeys.push_back(k);
      it = data.emplace(k, v).first;
    } else {
      it->second = v;
    }
    return it->second;
  }
  void del(const std::string& k) {
    auto it = data.find(k);
    if (it == data.end()) return;
    data.erase(it);
    uint32_t idx;
    if (isArrayIndex(k, idx)) {
      for (size_t i = 0; i < intKeys.size(); i++) if (intKeys[i] == idx) { intKeys.erase(intKeys.begin() + i); break; }
    } else {
      // Remove from insertion order: a deleted key that is re-added later gets a
      // fresh position at the end (JS semantics), so we must not leave it here.
      for (size_t i = 0; i < strKeys.size(); i++) if (strKeys[i] == k) { strKeys.erase(strKeys.begin() + i); break; }
    }
  }
  // for..in / Object.keys order: array indices ascending, then string keys in
  // insertion order.
  std::vector<std::string> keys() const {
    std::vector<std::string> out;
    std::vector<uint32_t> ik = intKeys;
    std::sort(ik.begin(), ik.end());
    for (uint32_t v : ik) out.push_back(std::to_string(v));
    for (const std::string& k : strKeys) out.push_back(k);
    return out;
  }
  size_t size() const { return data.size(); }
};

inline std::shared_ptr<Object> newObject() { return std::make_shared<Object>(); }

}  // namespace js

#endif  // PLAYTRAIN_JSVALUE_H
