#include "cpu.hpp"
#include "threefry.hpp"
#include <cstring>
namespace chip8 {
static const uint8_t FONT[80] = {
  0xF0,0x90,0x90,0x90,0xF0, 0x20,0x60,0x20,0x20,0x70, 0xF0,0x10,0xF0,0x80,0xF0, 0xF0,0x10,0xF0,0x10,0xF0,
  0x90,0x90,0xF0,0x10,0x10, 0xF0,0x80,0xF0,0x10,0xF0, 0xF0,0x80,0xF0,0x90,0xF0, 0xF0,0x10,0x20,0x40,0x40,
  0xF0,0x90,0xF0,0x90,0xF0, 0xF0,0x90,0xF0,0x10,0xF0, 0xF0,0x90,0xF0,0x90,0x90, 0xE0,0x90,0xE0,0x90,0xE0,
  0xF0,0x80,0x80,0x80,0xF0, 0xE0,0x90,0x90,0x90,0xE0, 0xF0,0x80,0xF0,0x80,0xF0, 0xF0,0x80,0xF0,0x80,0x80 };

void reset(Cpu& c, uint32_t r0, uint32_t r1) {
  memset(c.mem, 0, sizeof c.mem); memcpy(c.mem + FONT_START, FONT, 80);
  memset(c.V, 0, 16); c.I = 0; c.pc = PROGRAM_START; memset(c.stack, 0, sizeof c.stack); c.sp = 0;
  c.delay = 0; c.sound = 0; memset(c.keypad, 0, 16); memset(c.display, 0, sizeof c.display);
  c.rng[0] = r0; c.rng[1] = r1;
}
void loadRom(Cpu& c, const uint8_t* b, size_t n) { for (size_t i = 0; i < n && PROGRAM_START + i < (size_t)MEM; i++) c.mem[PROGRAM_START + i] = b[i]; }

// JAX gather: normalise a negative index once, then clamp. Scatter: normalise once, drop if still out of range.
static inline int gatherIdx(int i, int n) { if (i < 0) i += n; return i < 0 ? 0 : (i >= n ? n - 1 : i); }
static inline int scatterIdx(int i, int n) { if (i < 0) i += n; return (i < 0 || i >= n) ? -1 : i; }

int fetch(Cpu& c) {
  int hi = c.mem[gatherIdx(c.pc, MEM)];
  int lo = c.mem[gatherIdx((c.pc + 1) & 0xFFFF, MEM)];
  c.pc = (c.pc + 2) & 0xFFFF;
  return (hi << 8) | lo;
}
static inline void push(Cpu& c, int address) { int i = scatterIdx(c.sp, STACK); if (i >= 0) c.stack[i] = (uint16_t)(address & 0xFFF); c.sp += 1; }
static inline int pop(Cpu& c) { c.sp -= 1; int a = c.stack[gatherIdx(c.sp, STACK)]; int i = scatterIdx(c.sp, STACK); if (i >= 0) c.stack[i] = 0; return a; }

static void opAlu(Cpu& c, int x, int y, int n) {
  int vx = c.V[x], vy = c.V[y], result = vx, vf = 0;
  switch (n) {
    case 0x0: result = vy; break;
    case 0x1: result = vx | vy; break;
    case 0x2: result = vx & vy; break;
    case 0x3: result = vx ^ vy; break;
    case 0x4: { int s = vx + vy; result = s & 0xFF; vf = s > 255 ? 1 : 0; break; }
    case 0x5: result = (vx - vy) & 0xFF; vf = vx >= vy ? 1 : 0; break;
    case 0x6: { int v = c.modern ? vx : vy; result = v >> 1; vf = v & 1; break; }
    case 0x7: result = (vy - vx) & 0xFF; vf = vy >= vx ? 1 : 0; break;
    case 0xE: { int v = c.modern ? vx : vy; result = (v << 1) & 0xFF; vf = (v & 0x80) >> 7; break; }
    default: break;
  }
  c.V[x] = (uint8_t)result; c.V[0xF] = (uint8_t)vf;
}
static void opDraw(Cpu& c, int x, int y, int n) {
  int sx = c.V[x] % W, sy = c.V[y] % H, collision = 0;
  for (int row = 0; row < n; row++) {
    int py = sy + row; if (py >= H) break;
    int byte = c.mem[gatherIdx(c.I + row, MEM)];
    for (int col = 0; col < 8; col++) {
      int px = sx + col; if (px >= W) break;
      if ((byte >> (7 - col)) & 1) { int k = px * H + py; if (c.display[k]) collision = 1; c.display[k] ^= 1; }
    }
  }
  c.V[0xF] = (uint8_t)collision;
}
static void opMisc(Cpu& c, int x, int nn) {
  switch (nn) {
    case 0x07: c.V[x] = (uint8_t)c.delay; break;
    case 0x0A: { int k = -1; for (int i = 0; i < 16; i++) if (c.keypad[i]) { k = i; break; }
      if (k >= 0) c.V[x] = (uint8_t)k; else c.pc = (c.pc - 2) & 0xFFFF; break; }
    case 0x15: c.delay = c.V[x]; break;
    case 0x18: c.sound = c.V[x]; break;
    case 0x1E: { int s = (c.I + c.V[x]) & 0xFFFF; c.V[0xF] = s > 0xFFF ? 1 : 0; c.I = s & 0xFFF; break; }
    case 0x29: c.I = (FONT_START + ((c.V[x] * 5) & 0xFF)) & 0xFF; break;
    case 0x33: { int v = c.V[x]; int d[3] = {v / 100, (v / 10) % 10, v % 10};
      for (int i = 0; i < 3; i++) { int a = scatterIdx(c.I + i, MEM); if (a >= 0) c.mem[a] = (uint8_t)d[i]; } break; }
    case 0x55: { for (int i = 0; i <= x; i++) { int a = scatterIdx(c.I + i, MEM); if (a >= 0) c.mem[a] = c.V[i]; }
      if (!c.modern) c.I = (c.I + x + 1) & 0xFFFF; break; }
    case 0x65: { for (int i = 0; i <= x; i++) c.V[i] = c.mem[gatherIdx(c.I + i, MEM)];
      if (!c.modern) c.I = (c.I + x + 1) & 0xFFFF; break; }
    default: break;
  }
}
void execute(Cpu& c, int ins) {
  int op = (ins & 0xF000) >> 12, x = (ins & 0x0F00) >> 8, y = (ins & 0x00F0) >> 4, n = ins & 0xF, nn = ins & 0xFF, nnn = ins & 0xFFF;
  switch (op) {
    case 0x0: if (ins == 0x00E0) memset(c.display, 0, sizeof c.display); else if (ins == 0x00EE) c.pc = pop(c); break;
    case 0x1: c.pc = nnn; break;
    case 0x2: push(c, c.pc); c.pc = nnn; break;
    case 0x3: if (c.V[x] == nn) c.pc = (c.pc + 2) & 0xFFFF; break;
    case 0x4: if (c.V[x] != nn) c.pc = (c.pc + 2) & 0xFFFF; break;
    case 0x5: if (c.V[x] == c.V[y]) c.pc = (c.pc + 2) & 0xFFFF; break;
    case 0x6: c.V[x] = (uint8_t)nn; break;
    case 0x7: c.V[x] = (uint8_t)((c.V[x] + nn) & 0xFF); break;
    case 0x8: opAlu(c, x, y, n); break;
    case 0x9: if (c.V[x] != c.V[y]) c.pc = (c.pc + 2) & 0xFFFF; break;
    case 0xA: c.I = nnn; break;
    case 0xB: c.pc = c.modern ? ((nn + c.V[x]) & 0xFFF) : ((nnn + c.V[0]) & 0xFFF); break;
    case 0xC: { uint32_t s[4]; threefrySplit(c.rng[0], c.rng[1], s); c.V[x] = (uint8_t)(randint8(s[2], s[3]) & nn); c.rng[0] = s[0]; c.rng[1] = s[1]; break; }
    case 0xD: opDraw(c, x, y, n); break;
    case 0xE: { int pressed = c.keypad[c.V[x] & 0xF] ? 1 : 0; if (pressed ^ (nn == 0xA1 ? 1 : 0)) c.pc = (c.pc + 2) & 0xFFFF; break; }
    case 0xF: opMisc(c, x, nn); break;
    default: break;
  }
}
std::string displayHex(const Cpu& c) {
  static const char* hx = "0123456789abcdef";
  std::string s; s.reserve(512);
  for (int i = 0; i < W * H; i += 8) { int b = 0; for (int j = 0; j < 8; j++) b = (b << 1) | c.display[i + j]; s.push_back(hx[b >> 4]); s.push_back(hx[b & 15]); }
  return s;
}
}
