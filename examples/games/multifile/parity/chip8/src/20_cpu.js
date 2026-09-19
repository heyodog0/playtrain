// ---- CHIP-8 CPU with Octax's exact semantics ----
// Reference: octax/emulator.py (fetch, execute), octax/instructions/*.py, octax/stack.py,
// octax/state.py at the commit pinned in manifest.json. Every quirk below is the reference's
// (see PLAN.md section 2 and manifest.json reference_quirks); do not "fix" any of it.
//
// Integer-only: typed-array state, `& 0xFFFF` / `& 0xFF` where JAX's dtypes wrap, JAX's
// index rules made explicit: a gather (read) normalises a negative index once by adding
// the size and then clamps into range; a scatter (write) normalises once and drops an index
// still out of range. `sp` is a plain integer because Octax's stack pointer is an unbounded
// int32 (-1 after a pop on empty, 17 after a 17th push).

const C8_MEM = 4096, C8_W = 64, C8_H = 32, C8_STACK = 16;
const C8_FONT_START = 0x50, C8_PROGRAM_START = 0x200;
const C8_FONT = [
  0xF0, 0x90, 0x90, 0x90, 0xF0,  0x20, 0x60, 0x20, 0x20, 0x70,
  0xF0, 0x10, 0xF0, 0x80, 0xF0,  0xF0, 0x10, 0xF0, 0x10, 0xF0,
  0x90, 0x90, 0xF0, 0x10, 0x10,  0xF0, 0x80, 0xF0, 0x10, 0xF0,
  0xF0, 0x80, 0xF0, 0x90, 0xF0,  0xF0, 0x10, 0x20, 0x40, 0x40,
  0xF0, 0x90, 0xF0, 0x90, 0xF0,  0xF0, 0x90, 0xF0, 0x10, 0xF0,
  0xF0, 0x90, 0xF0, 0x90, 0x90,  0xE0, 0x90, 0xE0, 0x90, 0xE0,
  0xF0, 0x80, 0x80, 0x80, 0xF0,  0xE0, 0x90, 0x90, 0x90, 0xE0,
  0xF0, 0x80, 0xF0, 0x80, 0xF0,  0xF0, 0x80, 0xF0, 0x80, 0x80,
];

// display[x * 32 + y] mirrors Octax's (64, 32) bool array in C order, so a byte-packing of
// this array in index order is the same bytes the oracle hashes.
function c8Create() {
  return {
    mem: new Uint8Array(C8_MEM),
    V: new Uint8Array(16),
    I: 0, pc: C8_PROGRAM_START,
    stack: new Uint16Array(C8_STACK), sp: 0,
    delay: 0, sound: 0,
    keypad: new Uint8Array(16),
    display: new Uint8Array(C8_W * C8_H),
    rng: new Uint32Array(2),
    modern: true,
  };
}

// octax.create_state(rng): zero everything, font at 0x50, pc 0x200.
function c8Reset(cpu, rng0, rng1) {
  cpu.mem.fill(0);
  for (let i = 0; i < C8_FONT.length; i++) cpu.mem[C8_FONT_START + i] = C8_FONT[i];
  cpu.V.fill(0); cpu.I = 0; cpu.pc = C8_PROGRAM_START;
  cpu.stack.fill(0); cpu.sp = 0;
  cpu.delay = 0; cpu.sound = 0;
  cpu.keypad.fill(0); cpu.display.fill(0);
  cpu.rng[0] = rng0 >>> 0; cpu.rng[1] = rng1 >>> 0;
  return cpu;
}

function c8LoadRom(cpu, bytes) {
  for (let i = 0; i < bytes.length && C8_PROGRAM_START + i < C8_MEM; i++) cpu.mem[C8_PROGRAM_START + i] = bytes[i];
}

// JAX gather index rule for an array of size n.
function c8GatherIdx(i, n) {
  if (i < 0) i += n;
  return i < 0 ? 0 : (i >= n ? n - 1 : i);
}

// JAX scatter index rule: the normalised index, or -1 when the write is dropped.
function c8ScatterIdx(i, n) {
  if (i < 0) i += n;
  return (i < 0 || i >= n) ? -1 : i;
}

// octax.emulator.fetch: two clamped reads, pc + 2 in uint16.
function c8Fetch(cpu) {
  const hi = cpu.mem[c8GatherIdx(cpu.pc, C8_MEM)];
  const lo = cpu.mem[c8GatherIdx((cpu.pc + 1) & 0xFFFF, C8_MEM)];
  cpu.pc = (cpu.pc + 2) & 0xFFFF;
  return ((hi << 8) | lo) >>> 0;
}

// octax/stack.py push: address & 0xFFF, scatter at sp, sp + 1.
function c8Push(cpu, address) {
  const i = c8ScatterIdx(cpu.sp, C8_STACK);
  if (i >= 0) cpu.stack[i] = address & 0xFFF;
  cpu.sp += 1;
}

// octax/stack.py pop: sp - 1, gather, zero that slot.
function c8Pop(cpu) {
  cpu.sp -= 1;
  const address = cpu.stack[c8GatherIdx(cpu.sp, C8_STACK)];
  const i = c8ScatterIdx(cpu.sp, C8_STACK);
  if (i >= 0) cpu.stack[i] = 0;
  return address;
}

// 0NNN: only 00E0 and 00EE do anything (system.py).
function c8OpSystem(cpu, ins) {
  if (ins === 0x00E0) cpu.display.fill(0);
  else if (ins === 0x00EE) cpu.pc = c8Pop(cpu);
}

// 8XYN (alu.py execute_alu_operation): VX := result, then VF := flag, for EVERY N.
function c8OpAlu(cpu, x, y, n) {
  const V = cpu.V;
  const vx = V[x], vy = V[y];
  let result = vx, vf = 0;
  switch (n) {
    case 0x0: result = vy; break;
    case 0x1: result = vx | vy; break;
    case 0x2: result = vx & vy; break;
    case 0x3: result = vx ^ vy; break;
    case 0x4: { const s = vx + vy; result = s & 0xFF; vf = s > 255 ? 1 : 0; break; }
    case 0x5: result = (vx - vy) & 0xFF; vf = vx >= vy ? 1 : 0; break;
    case 0x6: { const v = cpu.modern ? vx : vy; result = v >> 1; vf = v & 1; break; }
    case 0x7: result = (vy - vx) & 0xFF; vf = vy >= vx ? 1 : 0; break;
    case 0xE: { const v = cpu.modern ? vx : vy; result = (v << 1) & 0xFF; vf = (v & 0x80) >> 7; break; }
    default: break;                       // undefined N: VX unchanged, VF := 0
  }
  V[x] = result;
  V[0xF] = vf;
}

// DXYN (display.py): start wraps, sprite clips, VF = any pixel that was on under a set bit.
function c8OpDraw(cpu, x, y, n) {
  const sx = cpu.V[x] % C8_W, sy = cpu.V[y] % C8_H;
  const d = cpu.display;
  let collision = 0;
  for (let row = 0; row < n; row++) {
    const py = sy + row;
    if (py >= C8_H) break;
    const byte = cpu.mem[c8GatherIdx(cpu.I + row, C8_MEM)];
    for (let col = 0; col < 8; col++) {
      const px = sx + col;
      if (px >= C8_W) break;
      if ((byte >> (7 - col)) & 1) {
        const k = px * C8_H + py;
        if (d[k]) collision = 1;
        d[k] ^= 1;
      }
    }
  }
  cpu.V[0xF] = collision;
}

// FXNN (misc.py execute_misc_instruction); anything not listed is a no-op.
function c8OpMisc(cpu, x, nn) {
  const V = cpu.V;
  switch (nn) {
    case 0x07: V[x] = cpu.delay; break;
    case 0x0A: {                            // wait for key: rewind until any key, then lowest index
      let k = -1;
      for (let i = 0; i < 16; i++) if (cpu.keypad[i]) { k = i; break; }
      if (k >= 0) V[x] = k; else cpu.pc = (cpu.pc - 2) & 0xFFFF;
      break;
    }
    case 0x15: cpu.delay = V[x]; break;
    case 0x18: cpu.sound = V[x]; break;
    case 0x1E: {                            // I + VX in uint16; VF on > 0xFFF; I masked
      const s = (cpu.I + V[x]) & 0xFFFF;
      V[0xF] = s > 0xFFF ? 1 : 0;
      cpu.I = s & 0xFFF;
      break;
    }
    case 0x29: cpu.I = (C8_FONT_START + ((V[x] * 5) & 0xFF)) & 0xFF; break;   // all uint8
    case 0x33: {
      const v = V[x];
      const digits = [Math.floor(v / 100), Math.floor(v / 10) % 10, v % 10];
      for (let i = 0; i < 3; i++) { const a = c8ScatterIdx(cpu.I + i, C8_MEM); if (a >= 0) cpu.mem[a] = digits[i]; }
      break;
    }
    case 0x55: {
      for (let i = 0; i <= x; i++) { const a = c8ScatterIdx(cpu.I + i, C8_MEM); if (a >= 0) cpu.mem[a] = V[i]; }
      if (!cpu.modern) cpu.I = (cpu.I + x + 1) & 0xFFFF;
      break;
    }
    case 0x65: {
      for (let i = 0; i <= x; i++) V[i] = cpu.mem[c8GatherIdx(cpu.I + i, C8_MEM)];
      if (!cpu.modern) cpu.I = (cpu.I + x + 1) & 0xFFFF;
      break;
    }
    default: break;
  }
}

// octax.emulator.execute(state, instruction)
function c8Execute(cpu, ins) {
  const op = (ins & 0xF000) >> 12;
  const x = (ins & 0x0F00) >> 8;
  const y = (ins & 0x00F0) >> 4;
  const n = ins & 0x000F;
  const nn = ins & 0x00FF;
  const nnn = ins & 0x0FFF;
  const V = cpu.V;
  switch (op) {
    case 0x0: c8OpSystem(cpu, ins); break;
    case 0x1: cpu.pc = nnn; break;
    case 0x2: c8Push(cpu, cpu.pc); cpu.pc = nnn; break;
    case 0x3: if (V[x] === nn) cpu.pc = (cpu.pc + 2) & 0xFFFF; break;
    case 0x4: if (V[x] !== nn) cpu.pc = (cpu.pc + 2) & 0xFFFF; break;
    case 0x5: if (V[x] === V[y]) cpu.pc = (cpu.pc + 2) & 0xFFFF; break;   // any 5XYN
    case 0x6: V[x] = nn; break;
    case 0x7: V[x] = (V[x] + nn) & 0xFF; break;
    case 0x8: c8OpAlu(cpu, x, y, n); break;
    case 0x9: if (V[x] !== V[y]) cpu.pc = (cpu.pc + 2) & 0xFFFF; break;   // any 9XYN
    case 0xA: cpu.I = nnn; break;
    case 0xB: cpu.pc = cpu.modern ? ((nn + V[x]) & 0xFFF) : ((nnn + V[0]) & 0xFFF); break;
    case 0xC: {                            // key, subkey = split(rng); VX = randint(subkey) & NN
      c8ThreefrySplit(cpu.rng[0], cpu.rng[1], c8SplitTmp);
      const k0 = c8SplitTmp[0], k1 = c8SplitTmp[1];
      V[x] = c8Randint8(c8SplitTmp[2], c8SplitTmp[3]) & nn;
      cpu.rng[0] = k0; cpu.rng[1] = k1;
      break;
    }
    case 0xD: c8OpDraw(cpu, x, y, n); break;
    case 0xE: {                            // EX9E unless NN == A1 (control_flow.py)
      const pressed = cpu.keypad[V[x] & 0xF] ? 1 : 0;
      if (pressed ^ (nn === 0xA1 ? 1 : 0)) cpu.pc = (cpu.pc + 2) & 0xFFFF;
      break;
    }
    case 0xF: c8OpMisc(cpu, x, nn); break;
    default: break;
  }
}

// One instruction: fetch then execute (octax.env.run_instruction).
function c8Step(cpu) {
  c8Execute(cpu, c8Fetch(cpu));
}

// The display as 256 packed bytes in index order (what the oracle sha1s), hex.
function c8DisplayHex(cpu) {
  let s = '';
  const d = cpu.display;
  for (let i = 0; i < d.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | d[i + j];
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}
