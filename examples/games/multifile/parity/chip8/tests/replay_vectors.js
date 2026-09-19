// Replay tests/vectors/*.json against the JS CPU. Concatenated after src/*.js by conftest.run_js.
//   node <bundle> <vectors.json>
// Prints one JSON line per divergent vector (first divergent field and all others), then a summary.
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let failures = 0;
function load(cpu, st) {
  cpu.mem.fill(0); for (const [a, v] of st.memory) cpu.mem[a] = v;
  cpu.pc = st.pc; cpu.I = st.I; cpu.V.set(st.V); cpu.sp = st.sp; cpu.stack.set(st.stack);
  cpu.delay = st.delay; cpu.sound = st.sound; cpu.keypad.set(st.keypad);
  cpu.display.fill(0);
  for (let i = 0; i < st.display.length; i += 2) {
    const b = parseInt(st.display.substr(i, 2), 16);
    for (let j = 0; j < 8; j++) cpu.display[(i / 2) * 8 + j] = (b >> (7 - j)) & 1;
  }
  cpu.rng[0] = st.rng[0]; cpu.rng[1] = st.rng[1]; cpu.modern = st.modern;
}
function memSparse(cpu) { const out = []; for (let a = 0; a < cpu.mem.length; a++) if (cpu.mem[a]) out.push([a, cpu.mem[a]]); return out; }
const cpu = c8Create();
for (let i = 0; i < data.vectors.length; i++) {
  const v = data.vectors[i];
  load(cpu, v.pre);
  c8Execute(cpu, v.instruction);
  const got = { memory: memSparse(cpu), pc: cpu.pc, I: cpu.I, V: Array.from(cpu.V), sp: cpu.sp, stack: Array.from(cpu.stack),
    delay: cpu.delay, sound: cpu.sound, keypad: Array.from(cpu.keypad), display: c8DisplayHex(cpu), rng: Array.from(cpu.rng), modern: cpu.modern };
  const diffs = [];
  for (const f of Object.keys(got)) if (JSON.stringify(got[f]) !== JSON.stringify(v.post[f])) diffs.push({ field: f, expected: v.post[f], got: got[f] });
  if (diffs.length) { failures++; console.log(JSON.stringify({ i, test: v.test, instruction: v.instruction.toString(16), diffs })); }
}
console.log(`${data.vectors.length - failures}/${data.vectors.length} vectors match (${data.n_legacy} legacy-mode)`);
process.exit(failures ? 1 : 0);
