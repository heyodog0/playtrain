// cpu.hpp — the CHIP-8 CPU with Octax's exact semantics: parity/chip8/src/20_cpu.js line for line (JAX gather
// clamps, scatter drops, every 8XYN writes VF, FX29 in uint8, BNNN = (NN + VX) & 0xFFF, unchecked stack, pc an
// unmasked uint16). display[x * 32 + y] mirrors Octax's (64, 32) array in C order.
#pragma once
#include <cstdint>
#include <string>
namespace chip8 {
constexpr int MEM = 4096, W = 64, H = 32, STACK = 16, FONT_START = 0x50, PROGRAM_START = 0x200;
struct Cpu {
  uint8_t mem[MEM]; uint8_t V[16]; int I = 0, pc = PROGRAM_START;
  uint16_t stack[STACK]; int sp = 0;            // sp is an unbounded int like Octax's pointer
  int delay = 0, sound = 0; uint8_t keypad[16]; uint8_t display[W * H];
  uint32_t rng[2]; bool modern = true;
};
void reset(Cpu& c, uint32_t rng0, uint32_t rng1);
void loadRom(Cpu& c, const uint8_t* bytes, size_t n);
int fetch(Cpu& c);
void execute(Cpu& c, int ins);
inline void step(Cpu& c) { execute(c, fetch(c)); }
std::string displayHex(const Cpu& c);              // 256 packed bytes in index order, hex (what the oracle hashes)
}
