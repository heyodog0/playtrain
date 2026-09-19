// ---- Octax's OctaxEnv on the CPU: reset, step, score, terminated ----
// Reference: octax/env.py (_reset, reset, step) constructed as octax/environments/__init__.py
// create_environment does. One env step = press action_set[a] (a == len(action_set) is NOOP),
// run (700 // 60) * 4 = 44 instructions, apply the timer rule, release the key, then
// score / reward / terminated / truncated. See PLAN.md section 2.
//
// Game definitions (games/<game>.json) carry score and terminated as small JSON expression
// trees over the registers, transcribed from the module's score_fn / terminated_fn. c8Eval
// follows JAX's dtype rules so a uint8 expression wraps where Octax's does: V is uint8,
// consts are weakly typed, an explicit {"op":"i32"} node promotes; u8 (op) u8 -> u8 wrap,
// anything with i32 -> i32; comparisons and or/and are bool; cond picks by a bool.

const C8_INSTRUCTIONS_PER_STEP = Math.floor(700 / 60);      // 11
const C8_FRAME_SKIP = 4;
const C8_INSTRUCTIONS_PER_ENV_STEP = C8_INSTRUCTIONS_PER_STEP * C8_FRAME_SKIP;   // 44
const C8_MAX_STEPS = 4500;

function c8EvalType(a, b) {
  if (a === 'i32' || b === 'i32') return 'i32';
  if (a === 'u8' || b === 'u8') return 'u8';
  return 'weak';
}

function c8Wrap(v, t) {
  if (t === 'u8') return ((v % 256) + 256) % 256;
  if (t === 'i32') return v | 0;
  return v;
}

// Python / JAX floor division and remainder (result takes the divisor's sign).
function c8FloorDiv(a, b) { return Math.floor(a / b); }
function c8Mod(a, b) { return a - b * Math.floor(a / b); }

// Returns {v, t}; t in 'u8' | 'i32' | 'weak' | 'bool'.
function c8Eval(node, cpu) {
  switch (node.op) {
    case 'V': return { v: cpu.V[node.i], t: 'u8' };
    case 'const': return { v: node.v, t: 'weak' };
    case 'i32': return { v: c8Eval(node.a, cpu).v | 0, t: 'i32' };
    case 'u8': return { v: c8Wrap(c8Eval(node.a, cpu).v, 'u8'), t: 'u8' };
    case 'neg': { const a = c8Eval(node.a, cpu); return { v: c8Wrap(-a.v, a.t), t: a.t }; }
    case 'add': case 'sub': case 'mul': case 'floordiv': case 'mod': {
      const a = c8Eval(node.a, cpu), b = c8Eval(node.b, cpu);
      const t = c8EvalType(a.t, b.t);
      let v;
      if (node.op === 'add') v = a.v + b.v;
      else if (node.op === 'sub') v = a.v - b.v;
      else if (node.op === 'mul') v = a.v * b.v;
      else if (node.op === 'floordiv') v = c8FloorDiv(a.v, b.v);
      else v = c8Mod(a.v, b.v);
      return { v: c8Wrap(v, t), t };
    }
    case 'eq': case 'ne': case 'gt': case 'lt': case 'ge': case 'le': {
      const a = c8Eval(node.a, cpu).v, b = c8Eval(node.b, cpu).v;
      const r = node.op === 'eq' ? a === b : node.op === 'ne' ? a !== b : node.op === 'gt' ? a > b
        : node.op === 'lt' ? a < b : node.op === 'ge' ? a >= b : a <= b;
      return { v: r ? 1 : 0, t: 'bool' };
    }
    case 'or': return { v: (c8Eval(node.a, cpu).v || c8Eval(node.b, cpu).v) ? 1 : 0, t: 'bool' };
    case 'and': return { v: (c8Eval(node.a, cpu).v && c8Eval(node.b, cpu).v) ? 1 : 0, t: 'bool' };
    case 'not': return { v: c8Eval(node.a, cpu).v ? 0 : 1, t: 'bool' };
    case 'cond': return c8Eval(node.c, cpu).v ? c8Eval(node.a, cpu) : c8Eval(node.b, cpu);
    case 'false': return { v: 0, t: 'bool' };
    case 'true': return { v: 1, t: 'bool' };
    default: throw new Error('c8Eval: unknown op ' + node.op);
  }
}

function c8EnvCreate(def, romBytes) {
  return {
    def, rom: romBytes,
    cpu: c8Create(),
    actionSet: def.action_set.slice(),
    numActions: def.action_set.length + 1,
    noop: def.action_set.length,
    disableDelay: !!def.disable_delay,
    maxSteps: C8_MAX_STEPS,
    time: 0, score: 0, previousScore: 0, reward: 0, terminated: false, truncated: false,
    startup: null,                       // cached post-startup CPU (Octax's cached_reset_state)
  };
}

// The game's custom_startup functions (deep, vertical_brix), transcribed per game; U06 fills in.
const C8_CUSTOM_STARTUP = {};

function c8EnvRunStartup(env) {
  const cpu = env.cpu;
  c8Reset(cpu, 0, 0);                    // create_state(PRNGKey(0))
  c8LoadRom(cpu, env.rom);
  if (env.def.custom_startup) {
    const fn = C8_CUSTOM_STARTUP[env.def.custom_startup];
    if (!fn) throw new Error('no custom_startup transcribed for ' + env.def.custom_startup);
    fn(cpu);
  } else {
    for (let i = 0; i < env.def.startup_instructions; i++) c8Step(cpu);
  }
  env.startup = {
    mem: Uint8Array.from(cpu.mem), V: Uint8Array.from(cpu.V), I: cpu.I, pc: cpu.pc,
    stack: Uint16Array.from(cpu.stack), sp: cpu.sp, delay: cpu.delay, sound: cpu.sound,
    keypad: Uint8Array.from(cpu.keypad), display: Uint8Array.from(cpu.display),
  };
}

function c8EnvRestoreStartup(env) {
  const cpu = env.cpu, s = env.startup;
  cpu.mem.set(s.mem); cpu.V.set(s.V); cpu.I = s.I; cpu.pc = s.pc;
  cpu.stack.set(s.stack); cpu.sp = s.sp; cpu.delay = s.delay; cpu.sound = s.sound;
  cpu.keypad.set(s.keypad); cpu.display.set(s.display);
}

function c8Score(env) {
  return c8Eval(env.def.score, env.cpu).v;                  // * 1.0 in Octax: the same number
}

// OctaxEnv.reset(PRNGKey(seed)): the cached post-startup state with rng replaced.
function c8EnvReset(env, seed) {
  if (!env.startup) c8EnvRunStartup(env); else c8EnvRestoreStartup(env);
  env.cpu.rng[0] = 0; env.cpu.rng[1] = seed >>> 0;
  env.time = 0;
  env.score = c8Score(env); env.previousScore = env.score;
  env.reward = 0; env.terminated = false; env.truncated = false;
}

// OctaxEnv.step(state, action) -> reward
function c8EnvStep(env, action) {
  const cpu = env.cpu;
  const press = action !== env.noop;
  if (press) cpu.keypad[env.actionSet[action]] = 1;
  for (let i = 0; i < C8_INSTRUCTIONS_PER_ENV_STEP; i++) c8Step(cpu);
  if (env.disableDelay) { cpu.delay = 0; cpu.sound = 0; }
  else { cpu.delay = (cpu.delay - 1) & 0xFF; cpu.sound = (cpu.sound - 1) & 0xFF; }   // max(t - 1, 0) in uint8
  if (press) cpu.keypad[env.actionSet[action]] = 0;
  const current = c8Score(env);
  env.reward = current - env.previousScore;
  env.score = current; env.previousScore = current;
  env.time += 1;
  env.terminated = !!c8Eval(env.def.terminated, cpu).v;
  env.truncated = env.time >= env.maxSteps;
  return env.reward;
}
