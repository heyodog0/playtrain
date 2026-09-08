// p5_cmdbuf.hpp — optional p5 command buffer for the QuickJS hosts (round-3
// lever 2, C-side variant). Off by default; PLAYTRAIN_QJS_CMDBUF=1 makes the
// draw bindings RECORD (opcode, resolved args) into a per-env double buffer
// instead of executing p5:: immediately; the host flushes once per JS entry
// point, replaying the whole frame through p5::/the rasterizer in one tight
// loop (i-cache/branch locality — the rasterizer never alternates with the
// interpreter mid-frame).
//
// History: the first cut recorded from JS wrappers to also eliminate the
// QuickJS->C++ crossing per call. Measured DEAD both ways: with float-tagged
// typed-array indices 3.7x slower end-to-end (cluster A/B 43398275, cb=0.274
// vs rv2); with int-coerced indices still 2-4.4x slower than direct bindings
// under QJS_NODRAW — in an interpreter, JS bytecode + typed-array stores cost
// far more than the C-call crossing they replace. The crossing is cheap; the
// dispersed rasterizer execution was the real cost, so only the execution is
// deferred now.
//
// Contract (the differential gate is the arbiter):
//   - Args are resolved at record time exactly as the direct bindings would
//     (argd conversions, colorFromArgs incl. the array case) and replay calls
//     the SAME p5:: overloads in the same order.
//   - NODRAW-marked ops are skipped at record when nodraw is set (like the
//     direct bindings) and skipped again at replay if recorded earlier in a
//     frame that later toggled nodraw; sticky-state ops always execute.
//   - The recording branch triggers an inline early flush near capacity, so
//     ordering survives arbitrarily long frames.
#ifndef PLAYTRAIN_P5_CMDBUF_HPP
#define PLAYTRAIN_P5_CMDBUF_HPP

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "../runtime/p5.hpp"

namespace p5cb {

enum : int {
  BG = 1, FILL = 2, STROKE = 3, NOSTROKE = 4, NOFILL = 5, STROKEW = 6,
  RECT4 = 7, RECT5 = 8, ELLIPSE3 = 9, ELLIPSE4 = 10, CIRCLE = 11, ARC = 12,
  TRIANGLE = 13, QUAD = 14, LINE = 15, RECTMODE = 16, ELLIPSEMODE = 17,
  PUSH = 18, POP = 19, TRANSLATE = 20, ROTATE = 21, SCALE1 = 22, SCALE2 = 23,
  BEGINSHAPE = 24, VERTEX = 25, ENDSHAPE0 = 26, ENDSHAPE1 = 27,
  SETTARGET = 28, CLEARTARGET = 29, IMAGE = 30,
};

// 32768 doubles = 256KB per env. Largest command is 9 slots; the recording
// macro flushes when fewer than 16 remain.
constexpr size_t CAP = 32768;

struct Buf {
  double* q;
  size_t n = 0;
};

inline bool enabled() {
  const char* s = getenv("PLAYTRAIN_QJS_CMDBUF");
  return s && *s && *s != '0';
}

inline Buf* create() {
  Buf* b = new Buf;
  b->q = (double*)malloc(CAP * sizeof(double));
  return b;
}
inline void destroy(Buf* b) { if (b) { free(b->q); delete b; } }

// Replay + reset. `nodraw` mirrors the hosts' NODRAW macro per-op.
inline void flush(Buf* b, bool nodraw) {
  double* q = b->q;
  size_t n = b->n;
  for (size_t i = 0; i < n;) {
    int op = (int)q[i];
    switch (op) {
      // Colors are resolved to a final p5::Color at record time (the direct
      // bindings' colorFromArgs pipeline runs before recording), so replay
      // takes the 4 channel doubles verbatim.
      case BG:      if (!nodraw) p5::background(p5::Color{q[i + 1], q[i + 2], q[i + 3], q[i + 4]}); i += 5; break;
      case FILL:    if (!nodraw) p5::fill(p5::Color{q[i + 1], q[i + 2], q[i + 3], q[i + 4]}); i += 5; break;
      case STROKE:  if (!nodraw) p5::stroke(p5::Color{q[i + 1], q[i + 2], q[i + 3], q[i + 4]}); i += 5; break;
      case NOSTROKE:   p5::noStroke(); i += 1; break;
      case NOFILL:     p5::noFill(); i += 1; break;
      case STROKEW:    p5::strokeWeight(q[i + 1]); i += 2; break;
      case RECT4:      if (!nodraw) p5::rect(q[i + 1], q[i + 2], q[i + 3], q[i + 4]); i += 5; break;
      case RECT5:      if (!nodraw) p5::rect(q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5]); i += 6; break;
      case ELLIPSE3:   if (!nodraw) p5::ellipse(q[i + 1], q[i + 2], q[i + 3]); i += 4; break;
      case ELLIPSE4:   if (!nodraw) p5::ellipse(q[i + 1], q[i + 2], q[i + 3], q[i + 4]); i += 5; break;
      case CIRCLE:     if (!nodraw) p5::circle(q[i + 1], q[i + 2], q[i + 3]); i += 4; break;
      case ARC:        if (!nodraw) p5::arc(q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5], q[i + 6]); i += 7; break;
      case TRIANGLE:   if (!nodraw) p5::triangle(q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5], q[i + 6]); i += 7; break;
      case QUAD:       if (!nodraw) p5::quad(q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5], q[i + 6], q[i + 7], q[i + 8]); i += 9; break;
      case LINE:       if (!nodraw) p5::line(q[i + 1], q[i + 2], q[i + 3], q[i + 4]); i += 5; break;
      case RECTMODE:   p5::rectMode((int)q[i + 1]); i += 2; break;
      case ELLIPSEMODE: p5::ellipseMode((int)q[i + 1]); i += 2; break;
      case PUSH:       p5::push(); i += 1; break;
      case POP:        p5::pop(); i += 1; break;
      case TRANSLATE:  p5::translate(q[i + 1], q[i + 2]); i += 3; break;
      case ROTATE:     p5::rotate(q[i + 1]); i += 2; break;
      case SCALE1:     p5::scale(q[i + 1]); i += 2; break;
      case SCALE2:     p5::scale(q[i + 1], q[i + 2]); i += 3; break;
      case BEGINSHAPE: if (!nodraw) p5::beginShape(); i += 1; break;
      case VERTEX:     if (!nodraw) p5::vertex(q[i + 1], q[i + 2]); i += 3; break;
      case ENDSHAPE0:  if (!nodraw) p5::endShape(); i += 1; break;
      case ENDSHAPE1:  if (!nodraw) p5::endShape((int)q[i + 1]); i += 2; break;
      case SETTARGET:  p5::setTarget((int)q[i + 1]); i += 2; break;
      case CLEARTARGET: p5::clearTarget(); i += 1; break;
      case IMAGE:      if (!nodraw) p5::image((int)q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5]); i += 6; break;
      default:         b->n = 0; return;  // unreachable unless the buffer is corrupt
    }
  }
  b->n = 0;
}

// Record helpers (bounds already ensured by the caller's early-flush check).
inline void rec0(Buf* b, int op) { b->q[b->n++] = op; }
inline void rec1(Buf* b, int op, double a) {
  double* q = b->q + b->n; q[0] = op; q[1] = a; b->n += 2;
}
inline void rec2(Buf* b, int op, double a, double c) {
  double* q = b->q + b->n; q[0] = op; q[1] = a; q[2] = c; b->n += 3;
}
inline void rec3(Buf* b, int op, double a, double c, double d) {
  double* q = b->q + b->n; q[0] = op; q[1] = a; q[2] = c; q[3] = d; b->n += 4;
}
inline void rec4(Buf* b, int op, double a, double c, double d, double e) {
  double* q = b->q + b->n; q[0] = op; q[1] = a; q[2] = c; q[3] = d; q[4] = e; b->n += 5;
}
inline void rec5(Buf* b, int op, double a, double c, double d, double e, double f) {
  double* q = b->q + b->n; q[0] = op; q[1] = a; q[2] = c; q[3] = d; q[4] = e; q[5] = f; b->n += 6;
}
inline void rec6(Buf* b, int op, double a, double c, double d, double e, double f, double g) {
  double* q = b->q + b->n; q[0] = op; q[1] = a; q[2] = c; q[3] = d; q[4] = e; q[5] = f; q[6] = g; b->n += 7;
}
inline void rec8(Buf* b, int op, double a, double c, double d, double e, double f, double g, double h, double k) {
  double* q = b->q + b->n; q[0] = op; q[1] = a; q[2] = c; q[3] = d; q[4] = e;
  q[5] = f; q[6] = g; q[7] = h; q[8] = k; b->n += 9;
}
inline void recColor(Buf* b, int op, const p5::Color& c) {
  double* q = b->q + b->n; q[0] = op; q[1] = c.r; q[2] = c.g; q[3] = c.b; q[4] = c.a; b->n += 5;
}

}  // namespace p5cb

#endif  // PLAYTRAIN_P5_CMDBUF_HPP
