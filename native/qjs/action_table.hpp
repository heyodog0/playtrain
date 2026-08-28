// action_table.hpp — the action-space machinery shared by BOTH QuickJS hosts
// (qjs_host.cpp and qjs_vec_host.cpp), so the two cannot drift. The canonical
// declarative spec is runtime/action_spaces.json; the Python side flattens it
// through vec_set_actions / vec_set_action_analog / vec_set_input_map (vec
// host) or PLAYTRAIN_QJS_ACTIONS / PLAYTRAIN_QJS_INPUT_MAP (single host).
//
// Key semantics (mirror runtime/p5/game-env.mjs + p5-shim):
//   held  : key codes down for every frame of the step
//   press : optional key that fires the game's keyPressed() handler once before
//           the first frame AND is down for that frame — install() unions it
//           into the row, so games polling keyIsDown(press) (idiomatic p5 for
//           continuous fire) and games handling keyPressed() (pickup etc.) both
//           see it. Passing the spec's `held` verbatim is therefore correct.
//
// Input frame (continuous input): every step reduces to an InputFrame — keys
// plus optional pointer (x,y), button bits, and up to 4 analog axes. Analog
// values travel as uint16 ("quantize at the wire": producers quantize with
// q = floor(clamp(v01)*65535 + 0.5); every consumer dequantizes v01 = q/65535
// identically), which is what keeps replay and the cross-engine gate bit-exact
// even with "continuous" control. Discrete actions may carry analog fields
// (pointer/axes latched across steps, buttons absolute per step); box spaces
// (InputMap) set every channel absolutely each step. mouseIsPressed is true
// while button bit0 is held; a 0->1 edge fires mousePressed() once, before the
// first frame (mirroring simulateKeyPress's one-shot semantics).
#pragma once
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include "quickjs.h"

// One step's fully-resolved input. Built from a discrete ActionTable row or a
// quantized box-action vector; applied by the host before the tick loop.
struct InputFrame {
  int codes[16];        // keys down (held ∪ press ∪ key-channels)
  int ncodes = 0;
  int press = -1;       // keyPressed() event key, -1 = none
  bool set_pointer = false;   // write pointer globals this step?
  uint16_t qx = 0, qy = 0;    // pointer, uint16 in [0,1]
  uint32_t buttons = 0;       // bit0 = left mouse
  bool set_axes = false;
  uint16_t qaxes[4] = {32768, 32768, 32768, 32768};  // [-1,1] mapped to [0,1]
};

struct ActionTable {
  std::vector<int32_t> held;   // n * stride, -1 padded; press unioned in
  std::vector<int32_t> press;  // n entries, -1 = none
  // analog per action (all optional; empty vectors = pure-keyboard table)
  std::vector<uint16_t> qpointer;    // 2*n, valid where has_pointer[a]
  std::vector<uint8_t>  has_pointer; // n
  std::vector<uint32_t> buttons;     // n button bitmasks
  std::vector<uint16_t> qaxes;       // 4*n
  bool any_analog = false;     // any action carries pointer/buttons/axes
  int n = 0, stride = 0;
  std::atomic<bool> warned_oob{false};

  static const int kMaxHeld = 14;  // InputFrame::codes holds 16 incl. press

  // held_in: flat n_actions*max_held, -1 padded. False (table untouched) on bad input.
  bool install(const int32_t* held_in, const int32_t* press_in,
               int n_actions, int max_held) {
    if (!held_in || n_actions < 1 || max_held < 0 || max_held > kMaxHeld) return false;
    n = n_actions;
    stride = max_held + 1;  // room to union the press key in
    held.assign((size_t)n * stride, -1);
    press.assign(n, -1);
    qpointer.clear(); has_pointer.clear(); buttons.clear(); qaxes.clear();
    any_analog = false;
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

  // Attach per-action analog fields (sized to the installed n). Any pointer
  // may be null (that field zeroed / centered). Call after install().
  bool installAnalog(const uint16_t* qpointer_in, const uint8_t* has_pointer_in,
                     const uint32_t* buttons_in, const uint16_t* qaxes_in) {
    if (n < 1) return false;
    qpointer.assign(2 * (size_t)n, 0);
    has_pointer.assign(n, 0);
    buttons.assign(n, 0);
    qaxes.assign(4 * (size_t)n, 32768);
    for (int a = 0; a < n; a++) {
      if (has_pointer_in && has_pointer_in[a]) {
        has_pointer[a] = 1;
        if (qpointer_in) { qpointer[2*a] = qpointer_in[2*a]; qpointer[2*a+1] = qpointer_in[2*a+1]; }
      }
      if (buttons_in) buttons[a] = buttons_in[a];
      if (qaxes_in) for (int j = 0; j < 4; j++) qaxes[4*a+j] = qaxes_in[4*a+j];
    }
    any_analog = false;
    for (int a = 0; a < n; a++)
      if (has_pointer[a] || buttons[a]) any_analog = true;
    if (qaxes_in) for (int a = 0; a < n * 4; a++) if (qaxes[a] != 32768) any_analog = true;
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

  // Resolve one (clamped) action into an input frame. Pointer/axes are
  // LATCHED for discrete tables: only actions carrying them set them.
  inline void frameFor(int a, InputFrame& f) const {
    const int32_t* row = held.data() + (size_t)a * stride;
    f.ncodes = 0;
    for (int j = 0; j < stride; j++) {
      if (row[j] < 0) break;
      f.codes[f.ncodes++] = (int)row[j];
    }
    f.press = (int)press[a];
    if (any_analog) {
      f.set_pointer = has_pointer[a] != 0;
      if (f.set_pointer) { f.qx = qpointer[2*a]; f.qy = qpointer[2*a+1]; }
      f.buttons = buttons[a];
      f.set_axes = true;
      for (int j = 0; j < 4; j++) f.qaxes[j] = qaxes[4*a+j];
    } else {
      f.set_pointer = false;
      f.buttons = 0;
      f.set_axes = false;
    }
  }
};

// Box-space channel map: how a quantized action vector (uint16 per channel)
// becomes an input frame. Kinds mirror playtrain.runtime.action_space.
struct InputMap {
  enum Kind { PX = 0, PY = 1, BUTTON = 2, AXIS = 3, KEY = 4 };
  std::vector<int32_t> kind, arg;  // arg: button bit / axis index / key code
  int n = 0;

  bool install(const int32_t* kinds, const int32_t* args, int n_channels) {
    if (!kinds || !args || n_channels < 1 || n_channels > 32) return false;
    for (int i = 0; i < n_channels; i++) {
      if (kinds[i] < 0 || kinds[i] > 4) return false;
      if (kinds[i] == AXIS && (args[i] < 0 || args[i] >= 4)) return false;
      if (kinds[i] == KEY && (args[i] <= 0 || args[i] >= 256)) return false;
    }
    kind.assign(kinds, kinds + n_channels);
    arg.assign(args, args + n_channels);
    n = n_channels;
    return true;
  }

  // q: n uint16 wire values. Button/key channels: pressed iff q >= 32768.
  // Every channel is absolute each step (no latching in box mode).
  inline void frameFor(const uint16_t* q, InputFrame& f) const {
    f.ncodes = 0;
    f.press = -1;
    f.set_pointer = false;
    f.buttons = 0;
    f.set_axes = false;
    for (int i = 0; i < n; i++) {
      switch (kind[i]) {
        case PX: f.qx = q[i]; f.set_pointer = true; break;
        case PY: f.qy = q[i]; f.set_pointer = true; break;
        case BUTTON: if (q[i] >= 32768) f.buttons |= (uint32_t)arg[i]; break;
        case AXIS: f.qaxes[arg[i]] = q[i]; f.set_axes = true; break;
        case KEY: if (q[i] >= 32768 && f.ncodes < 16) f.codes[f.ncodes++] = arg[i]; break;
      }
    }
  }
};

// ---- JSON loaders (single-env host; the vec host takes flat ABI arrays) ----

// Parse a JSON array [{"held":[...],"press":32|null,"pointer":[x,y],
// "buttons":["mouse"],"axes":[...]}, ...] (the action_spaces.json entry
// format) into `t` via an existing QuickJS context. Analog floats are
// quantized here with the wire formula. Returns false — table untouched —
// on any malformed input.
inline bool actionTableFromJSON(JSContext* ctx, const char* json, ActionTable& t) {
  bool ok = false;
  JSValue arr = JS_ParseJSON(ctx, json, strlen(json), "<actions>");
  std::vector<std::vector<int32_t>> rows;
  std::vector<int32_t> pressv;
  std::vector<uint16_t> qptr;
  std::vector<uint8_t> hasptr;
  std::vector<uint32_t> btns;
  std::vector<uint16_t> qax;
  auto q16 = [](double v01) -> uint16_t {
    if (v01 < 0) v01 = 0; if (v01 > 1) v01 = 1;
    return (uint16_t)(v01 * 65535.0 + 0.5);
  };
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
      // analog fields
      uint16_t px = 0, py = 0; uint8_t hp = 0; uint32_t bt = 0;
      uint16_t ax[4] = {32768, 32768, 32768, 32768};
      JSValue ptr = JS_GetPropertyStr(ctx, a, "pointer");
      if (!JS_IsUndefined(ptr) && !JS_IsNull(ptr)) {
        double x = 0, y = 0;
        JSValue vx = JS_GetPropertyUint32(ctx, ptr, 0); JS_ToFloat64(ctx, &x, vx); JS_FreeValue(ctx, vx);
        JSValue vy = JS_GetPropertyUint32(ctx, ptr, 1); JS_ToFloat64(ctx, &y, vy); JS_FreeValue(ctx, vy);
        px = q16(x); py = q16(y); hp = 1;
      }
      JS_FreeValue(ctx, ptr);
      JSValue bs = JS_GetPropertyStr(ctx, a, "buttons");
      if (!JS_IsUndefined(bs) && !JS_IsNull(bs)) {
        JSValue bl = JS_GetPropertyStr(ctx, bs, "length");
        int32_t bn = 0; JS_ToInt32(ctx, &bn, bl); JS_FreeValue(ctx, bl);
        for (int32_t j = 0; j < bn; j++) {
          JSValue b = JS_GetPropertyUint32(ctx, bs, (uint32_t)j);
          const char* s = JS_ToCString(ctx, b);
          if (s && !strcmp(s, "mouse")) bt |= 1u; else bad = true;
          JS_FreeCString(ctx, s); JS_FreeValue(ctx, b);
        }
      }
      JS_FreeValue(ctx, bs);
      JSValue axv = JS_GetPropertyStr(ctx, a, "axes");
      if (!JS_IsUndefined(axv) && !JS_IsNull(axv)) {
        JSValue al = JS_GetPropertyStr(ctx, axv, "length");
        int32_t an = 0; JS_ToInt32(ctx, &an, al); JS_FreeValue(ctx, al);
        if (an > 4) bad = true;
        for (int32_t j = 0; j < an && !bad; j++) {
          JSValue v = JS_GetPropertyUint32(ctx, axv, (uint32_t)j);
          double d = 0; JS_ToFloat64(ctx, &d, v); JS_FreeValue(ctx, v);
          ax[j] = q16((d + 1.0) / 2.0);
        }
      }
      JS_FreeValue(ctx, axv);
      JS_FreeValue(ctx, a);
      rows.push_back(row);
      pressv.push_back(pc);
      qptr.push_back(px); qptr.push_back(py);
      hasptr.push_back(hp);
      btns.push_back(bt);
      for (int j = 0; j < 4; j++) qax.push_back(ax[j]);
    }
    if (bad) break;
    size_t mh = 1;
    for (auto& r : rows) if (r.size() > mh) mh = r.size();
    if (mh > (size_t)ActionTable::kMaxHeld) break;
    std::vector<int32_t> flat(rows.size() * mh, -1);
    for (size_t i = 0; i < rows.size(); i++)
      for (size_t j = 0; j < rows[i].size(); j++) flat[i * mh + j] = rows[i][j];
    ok = t.install(flat.data(), pressv.data(), (int)rows.size(), (int)mh)
      && t.installAnalog(qptr.data(), hasptr.data(), btns.data(), qax.data());
  } while (0);
  JS_FreeValue(ctx, arr);
  return ok;
}

// Parse a JSON channel array ["pointer_x","pointer_y","button:mouse",
// "axis:0","key:32"] into `m`. Returns false (map untouched) on bad input.
inline bool inputMapFromJSON(JSContext* ctx, const char* json, InputMap& m) {
  bool ok = false;
  JSValue arr = JS_ParseJSON(ctx, json, strlen(json), "<inputmap>");
  std::vector<int32_t> kinds, args;
  do {
    if (JS_IsException(arr)) break;
    JSValue lenv = JS_GetPropertyStr(ctx, arr, "length");
    int32_t len = 0;
    JS_ToInt32(ctx, &len, lenv);
    JS_FreeValue(ctx, lenv);
    if (len < 1 || len > 32) break;
    bool bad = false;
    for (int32_t i = 0; i < len && !bad; i++) {
      JSValue c = JS_GetPropertyUint32(ctx, arr, (uint32_t)i);
      const char* s = JS_ToCString(ctx, c);
      if (!s) { bad = true; }
      else if (!strcmp(s, "pointer_x")) { kinds.push_back(InputMap::PX); args.push_back(0); }
      else if (!strcmp(s, "pointer_y")) { kinds.push_back(InputMap::PY); args.push_back(0); }
      else if (!strcmp(s, "button:mouse")) { kinds.push_back(InputMap::BUTTON); args.push_back(1); }
      else if (!strncmp(s, "axis:", 5)) { kinds.push_back(InputMap::AXIS); args.push_back(atoi(s + 5)); }
      else if (!strncmp(s, "key:", 4)) { kinds.push_back(InputMap::KEY); args.push_back(atoi(s + 4)); }
      else bad = true;
      JS_FreeCString(ctx, s);
      JS_FreeValue(ctx, c);
    }
    if (bad) break;
    ok = m.install(kinds.data(), args.data(), (int)kinds.size());
  } while (0);
  JS_FreeValue(ctx, arr);
  return ok;
}
