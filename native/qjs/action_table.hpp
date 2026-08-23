// action_table.hpp — the discrete action table shared by BOTH QuickJS hosts
// (qjs_host.cpp and qjs_vec_host.cpp), so the two cannot drift. The canonical
// declarative spec is runtime/action_spaces.json; the Python side flattens it
// through vec_set_actions (vec host) or PLAYTRAIN_QJS_ACTIONS (single host).
//
// Semantics (mirror runtime/p5/game-env.mjs ACTIONS + p5-shim simulateKeyPress):
//   held  : key codes down for every frame of the step
//   press : optional key that fires the game's keyPressed() handler once before
//           the first frame AND is down for that frame — install() unions it
//           into the row, so games polling keyIsDown(press) (idiomatic p5 for
//           continuous fire) and games handling keyPressed() (pickup etc.) both
//           see it. Passing the spec's `held` verbatim is therefore correct;
//           without the union the D-family actions silently break for
//           keyIsDown-polling games (historically: asteroids gate divergence
//           at the first D-overlap pickup).
#pragma once
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>
#include "quickjs.h"

struct ActionTable {
  std::vector<int32_t> held;   // n * stride, -1 padded; press unioned in
  std::vector<int32_t> press;  // n entries, -1 = none
  int n = 0, stride = 0;
  std::atomic<bool> warned_oob{false};

  static const int kMaxHeld = 15;  // codesFor callers use a 16-int stack buffer

  // held_in: flat n_actions*max_held, -1 padded. False (table untouched) on bad input.
  bool install(const int32_t* held_in, const int32_t* press_in,
               int n_actions, int max_held) {
    if (!held_in || n_actions < 1 || max_held < 0 || max_held > kMaxHeld) return false;
    n = n_actions;
    stride = max_held + 1;  // room to union the press key in
    held.assign((size_t)n * stride, -1);
    press.assign(n, -1);
    for (int a = 0; a < n; a++) {
      int32_t* row = held.data() + (size_t)a * stride;
      int cnt = 0;
      for (int j = 0; j < max_held; j++) {
        int32_t k = held_in[(size_t)a * max_held + j];
        if (k >= 0) row[cnt++] = k;
      }
      int32_t p = press_in ? press_in[a] : -1;
      press[a] = p;
      if (p >= 0) {
        bool have = false;
        for (int j = 0; j < cnt; j++) if (row[j] == p) have = true;
        if (!have) row[cnt++] = p;
      }
    }
    return true;
  }

  // 0 NOOP, 1 LEFT, 2 RIGHT, 3 UP, 4 DOWN, 5 D, 6 LEFT+D, 7 RIGHT+D — FROZEN:
  // gate_qjs.sh golden traces, recorded human sessions, and every replay
  // trace depend on this exact mapping (runtime/action_spaces.json default8).
  void installDefault8() {
    static const int32_t H[8] = {-1, 37, 39, 38, 40, -1, 37, 39};
    static const int32_t P[8] = {-1, -1, -1, -1, -1, 32, 32, 32};
    install(H, P, 8, 1);
  }

  // Clamp an out-of-range action to NOOP, matching game-env.mjs's
  // `ACTIONS[a] ?? ACTIONS[0]`; warns once so a buggy caller is visible.
  // (The old fixed-table code indexed HELD[action] unchecked — out of bounds.)
  inline int clamp(int a) {
    if ((unsigned)a < (unsigned)n) return a;
    if (!warned_oob.exchange(true, std::memory_order_relaxed))
      fprintf(stderr, "qjs action table: action %d out of range [0,%d); using NOOP\n", a, n);
    return 0;
  }

  // Fill `codes` (capacity >= stride, i.e. 16 is always enough) with the
  // action's down-keys; returns the count. Rows are front-packed by install().
  inline int codesFor(int a, int* codes) const {
    const int32_t* row = held.data() + (size_t)a * stride;
    int cnt = 0;
    for (int j = 0; j < stride; j++) {
      if (row[j] < 0) break;
      codes[cnt++] = (int)row[j];
    }
    return cnt;
  }

  inline int pressFor(int a) const { return (int)press[a]; }
};

// Parse a JSON array [{"held":[...],"press":32|null}, ...] (the
// action_spaces.json entry format) into `t` via an existing QuickJS context.
// Returns false — and leaves `t` untouched — on any malformed input.
inline bool actionTableFromJSON(JSContext* ctx, const char* json, ActionTable& t) {
  bool ok = false;
  JSValue arr = JS_ParseJSON(ctx, json, strlen(json), "<actions>");
  std::vector<std::vector<int32_t>> rows;
  std::vector<int32_t> pressv;
  do {
    if (JS_IsException(arr)) break;
    JSValue lenv = JS_GetPropertyStr(ctx, arr, "length");
    int32_t len = 0;
    JS_ToInt32(ctx, &len, lenv);
    JS_FreeValue(ctx, lenv);
    if (len < 1) break;
    bool bad = false;
    for (int32_t i = 0; i < len && !bad; i++) {
      JSValue a = JS_GetPropertyUint32(ctx, arr, (uint32_t)i);
      std::vector<int32_t> row;
      JSValue h = JS_GetPropertyStr(ctx, a, "held");
      if (!JS_IsUndefined(h) && !JS_IsNull(h)) {
        JSValue hl = JS_GetPropertyStr(ctx, h, "length");
        int32_t hn = 0;
        JS_ToInt32(ctx, &hn, hl);
        JS_FreeValue(ctx, hl);
        for (int32_t j = 0; j < hn && !bad; j++) {
          JSValue k = JS_GetPropertyUint32(ctx, h, (uint32_t)j);
          int32_t kc = -1;
          JS_ToInt32(ctx, &kc, k);
          JS_FreeValue(ctx, k);
          if (kc <= 0 || kc >= 256) bad = true; else row.push_back(kc);
        }
      }
      JS_FreeValue(ctx, h);
      JSValue p = JS_GetPropertyStr(ctx, a, "press");
      int32_t pc = -1;
      if (!JS_IsUndefined(p) && !JS_IsNull(p)) {
        JS_ToInt32(ctx, &pc, p);
        if (pc <= 0 || pc >= 256) bad = true;
      }
      JS_FreeValue(ctx, p);
      JS_FreeValue(ctx, a);
      rows.push_back(row);
      pressv.push_back(pc);
    }
    if (bad) break;
    size_t mh = 1;
    for (auto& r : rows) if (r.size() > mh) mh = r.size();
    if (mh > (size_t)ActionTable::kMaxHeld) break;
    std::vector<int32_t> flat(rows.size() * mh, -1);
    for (size_t i = 0; i < rows.size(); i++)
      for (size_t j = 0; j < rows[i].size(); j++) flat[i * mh + j] = rows[i][j];
    ok = t.install(flat.data(), pressv.data(), (int)rows.size(), (int)mh);
  } while (0);
  JS_FreeValue(ctx, arr);
  return ok;
}
