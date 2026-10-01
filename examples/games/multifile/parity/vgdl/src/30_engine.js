// ---- Data-oriented VGDL engine. Semantics: py-vgdl, Colas / infer-vgdl fork. ----
// State lives in typed arrays per sprite type; each type keeps a cell grid of
// its live sprites so every collision test is a lookup, not a scan. Update
// order, kill/create deferral, RNG draw order and effect pass order follow
// core.py:tick exactly; deviations from the reference are bugs, not features.
//
// Positions are in PIXELS: cell * VG.B. With B == 1 (the vgfmri set) that is
// the cell itself. With B > 1 (infer set at 50) sprites move sub-cell and
// collisions are rect overlaps, as in pygame.

const VG_K_UP = 273, VG_K_DOWN = 274, VG_K_RIGHT = 275, VG_K_LEFT = 276, VG_K_SPACE = 32;
const VG_BASEDIRS = [[0, -1], [-1, 0], [0, 1], [1, 0]];   // UP LEFT DOWN RIGHT (constants.py)

// class -> defaults (ontology). `speed: NaN` means None (treated as 1 when moving).
const VG_CLASS = {
  VGDLSprite:     {},
  Immovable:      { is_static: true },
  Passive:        {},
  Resource:       { value: 1, limit: 2, is_resource: true },
  ResourcePack:   { is_static: true, value: 1, limit: 2, is_resource: true },
  Flicker:        { limit: 1, flicker: true },
  OrientedFlicker:{ limit: 1, flicker: true, has_orientation: true, speed: 0 },
  Portal:         { is_static: true, producer: true },
  SpawnPoint:     { is_static: true, producer: true, spawn: true, cooldown: 1, prob: 1 },
  RandomNPC:      { speed: 1 },
  OrientedSprite: { has_orientation: true },
  Missile:        { has_orientation: true, speed: 1 },
  Bomber:         { has_orientation: true, speed: 1, producer: true, spawn: true, cooldown: 1, prob: 1 },
  Chaser:         { speed: 1 },
  Fleeing:        { speed: 1, fleeing: true },
  MovingAvatar:   { speed: 1, avatar: 'moving' },
  HorizontalAvatar:{ speed: 1, avatar: 'horizontal' },
  FlakAvatar:     { speed: 1, avatar: 'flak', producer: true },
  OrientedAvatar: { speed: 1, avatar: 'oriented', has_orientation: true },
  ShootAvatar:    { speed: 1, avatar: 'shoot', has_orientation: true, producer: true },
  GravityAvatar:  { speed: 1, avatar: 'gravity' },
};
// avatar action sets (declare_possible_actions), as sorted key tuples
const VG_ACTS_MOVING = [[VG_K_UP], [VG_K_DOWN], [VG_K_LEFT], [VG_K_RIGHT], []];
const VG_ACTS_HORIZ  = [[VG_K_LEFT], [VG_K_RIGHT], []];
const VG_ACTS_FLAK   = VG_ACTS_HORIZ.concat([[VG_K_SPACE]]);
const VG_ACTS_SHOOT  = VG_ACTS_MOVING.concat([[VG_K_SPACE]]);
const VG_AVATAR_ACTS = { moving: VG_ACTS_MOVING, horizontal: VG_ACTS_HORIZ, flak: VG_ACTS_FLAK, oriented: VG_ACTS_MOVING, shoot: VG_ACTS_SHOOT, gravity: VG_ACTS_SHOOT };

const VG = {
  spec: null, B: 1, W: 0, H: 0, SW: 0, SH: 0,   // grid cells, screen pixels
  types: [], byKey: {},
  time: 0, score: 0, ended: false, won: false,
  keys: [],                 // active keys, sorted ascending (py Action.keys)
  killList: [],             // [t, i, ...] flattened
  createList: [],           // [key, x, y] triples
  resChanges: [],           // [t, i, resource, value]
  seq: 0,
  ss: null,                 // per-tick abstract-group snapshots
  resLimits: {},
};

function vgClassDef(cls) { return VG_CLASS[cls] || VG_CLASS.VGDLSprite; }

// ---------- types ----------
function vgMakeType(idx, key, def) {
  const cd = vgClassDef(def.cls), A = def.args;
  // py: self.speed = speed or self.speed ; self.cooldown = cooldown or self.cooldown  (falsy kwargs fall through)
  const speed = (A.speed != null && A.speed !== 0) ? A.speed : (cd.speed != null ? cd.speed : NaN);
  let cooldown = (A.cooldown != null && A.cooldown !== 0) ? A.cooldown : (cd.cooldown || 0);
  const t = {
    idx, key, cls: def.cls, args: A, stypes: def.stypes,
    isStatic: !!cd.is_static, onlyActive: false,
    hasOrient: !!cd.has_orientation || A.orientation != null,
    orient0: A.orientation != null ? A.orientation : [1, 0],
    speed, cooldown,
    avatar: cd.avatar || null, acts: cd.avatar ? VG_AVATAR_ACTS[cd.avatar] : null,
    flicker: !!cd.flicker, limit: A.limit != null ? A.limit : (cd.limit != null ? cd.limit : 1),
    spawn: !!cd.spawn, prob: A.prob != null ? A.prob : (cd.prob != null ? cd.prob : 1), total: A.total ? A.total : 0,
    stype: A.stype != null ? A.stype : null, ammo: A.ammo != null ? A.ammo : null,
    chaser: def.cls === 'Chaser' || def.cls === 'Fleeing', fleeing: !!cd.fleeing || A.fleeing === true,
    isResource: !!cd.is_resource, value: A.value != null ? A.value : (cd.value != null ? cd.value : 1),
    resType: A.res_type != null ? A.res_type : key,
    singleton: false,
    aligned: true,            // every live sprite sits on a cell corner (statics from the level); lets collisions probe 1-4 cells instead of 9
    // storage
    cap: 0, n: 0, live: null, free: [],
    x: null, y: null, lx: null, ly: null, lastmove: null, ox: null, oy: null,
    age: null, counter: null, killed: null, jpT: null, jpI: null, seq: null, res: null, jump: null,
    head: null, next: null, cell: null,
  };
  if (t.cls === 'Fleeing') t.fleeing = true;
  vgTypeAlloc(t, 16);
  return t;
}
function vgTypeAlloc(t, cap) {
  const grow = (old, C) => { const a = new C(cap); if (old) a.set(old.subarray(0, t.cap)); return a; };
  t.live = grow(t.live, Int32Array);
  t.x = grow(t.x, Int32Array); t.y = grow(t.y, Int32Array); t.lx = grow(t.lx, Int32Array); t.ly = grow(t.ly, Int32Array);
  t.lastmove = grow(t.lastmove, Int32Array); t.ox = grow(t.ox, Float64Array); t.oy = grow(t.oy, Float64Array);
  t.age = grow(t.age, Int32Array); t.counter = grow(t.counter, Int32Array); t.killed = grow(t.killed, Uint8Array);
  t.jpT = grow(t.jpT, Int32Array); t.jpI = grow(t.jpI, Int32Array); t.seq = grow(t.seq, Int32Array);
  t.jump = grow(t.jump, Int32Array); t.next = grow(t.next, Int32Array); t.cell = grow(t.cell, Int32Array);
  const res = new Array(cap); if (t.res) for (let i = 0; i < t.cap; i++) res[i] = t.res[i]; t.res = res;
  for (let i = t.cap; i < cap; i++) t.free.push(i);
  t.cap = cap;
}

// ---------- cell grid per type ----------
function vgCellOf(x, y) {
  const B = VG.B, cx = Math.floor(x / B), cy = Math.floor(y / B);
  if (cx < 0 || cy < 0 || cx >= VG.W || cy >= VG.H) return -1;
  return cy * VG.W + cx;
}
function vgGridLink(t, i) {
  const c = vgCellOf(t.x[i], t.y[i]); t.cell[i] = c;
  if (c < 0) { t.next[i] = -1; return; }
  t.next[i] = t.head[c]; t.head[c] = i;
}
function vgGridUnlink(t, i) {
  const c = t.cell[i]; if (c < 0) return;
  let p = t.head[c];
  if (p === i) { t.head[c] = t.next[i]; return; }
  while (p >= 0 && t.next[p] !== i) p = t.next[p];
  if (p >= 0) t.next[p] = t.next[i];
}
function vgSetPos(t, i, x, y) {
  if (x === t.x[i] && y === t.y[i]) return;
  if (VG.B !== 1 && (x % VG.B !== 0 || y % VG.B !== 0)) t.aligned = false;
  const c = vgCellOf(x, y);
  if (c !== t.cell[i]) { vgGridUnlink(t, i); t.x[i] = x; t.y[i] = y; vgGridLink(t, i); }
  else { t.x[i] = x; t.y[i] = y; }
}

// ---------- sprites ----------
function vgCreate(key, x, y, skipSingleton) {
  const t = VG.byKey[key]; if (!t) return -1;
  if (!skipSingleton && t.singleton && t.n > 0) return -1;   // py-vgdl (Colas): a killed-but-unflushed singleton still blocks
  if (t.free.length === 0) vgTypeAlloc(t, t.cap * 2);
  const i = t.free.pop();
  t.live[t.n++] = i;
  t.x[i] = x; t.y[i] = y; t.lx[i] = x; t.ly[i] = y;
  if (VG.B !== 1 && (x % VG.B !== 0 || y % VG.B !== 0)) t.aligned = false;
  t.lastmove[i] = 0; t.ox[i] = t.orient0[0]; t.oy[i] = t.orient0[1];
  t.age[i] = 0; t.counter[i] = 0; t.killed[i] = 0; t.jpT[i] = -1; t.jpI[i] = -1; t.jump[i] = 0;
  t.seq[i] = VG.seq++; t.res[i] = null;
  vgGridLink(t, i);
  return i;
}
function vgKill(t, i) { if (!t.killed[i]) { t.killed[i] = 1; VG.killList.push(t.idx, i); } }
function vgRes(t, i, r) { const o = t.res[i]; return o && r in o ? o[r] : 0; }
function vgResSet(t, i, r, v) { if (!t.res[i]) t.res[i] = {}; t.res[i][r] = v; }
function vgResClamp(r, v) { const lim = r in VG.resLimits ? VG.resLimits[r] : Infinity; return Math.max(0, Math.min(v, lim)); }

// sprites of an stype: a type (key) or an abstract group snapshot [[t,i],...]
function vgGroup(st) {
  const t = VG.byKey[st]; if (t) return t;
  if (VG.ss && st in VG.ss) return VG.ss[st];
  const out = [];
  for (const ty of VG.types) if (ty.stypes.includes(st)) for (let k = 0; k < ty.n; k++) out.push([ty, ty.live[k]]);
  if (VG.ss) VG.ss[st] = out;
  return out;
}
function vgNumSprites(st) { const g = vgGroup(st); return Array.isArray(g) ? g.length : g.n; }

// ---------- movement (GridPhysics) ----------
// _update_position: rect.move(trunc(v)) gated by cooldown
function vgUpdatePosition(t, i, dx, dy) {
  if (t.lastmove[i] >= t.cooldown) {
    vgSetPos(t, i, t.x[i] + Math.trunc(dx), t.y[i] + Math.trunc(dy));
    t.lastmove[i] = 0;
  }
}
function vgSpeedOf(t) { return Number.isNaN(t.speed) ? 1 : t.speed; }
function vgPassive(t, i) {
  if (!t.hasOrient) return;
  const sp = vgSpeedOf(t);
  if (sp !== 0) vgUpdatePosition(t, i, t.ox[i] * sp * VG.B, t.oy[i] * sp * VG.B);
}
function vgActive(t, i, vx, vy, speedOverride) {
  const sp = speedOverride != null ? speedOverride : vgSpeedOf(t);
  if (sp !== 0) vgUpdatePosition(t, i, vx * sp * VG.B, vy * sp * VG.B);   // NOOP vector (0,0) still resets lastmove
}
function vgBaseUpdate(t, i) {
  t.lx[i] = t.x[i]; t.ly[i] = t.y[i];
  t.lastmove[i] += 1;
  if (!t.isStatic && !t.onlyActive) vgPassive(t, i);
}

// ---------- avatar input (MovingAvatar._read_action) ----------
// Largest key combination that names an action wins; ties by lexicographic order of sorted keys.
function vgReadAction(acts) {
  const keys = VG.keys, n = keys.length;
  const has = (combo) => { outer: for (const a of acts) { if (a.length !== combo.length) continue; for (let k = 0; k < a.length; k++) if (a[k] !== combo[k]) continue outer; return true; } return false; };
  for (let m = Math.max(3, n); m >= 0; m--) {
    if (m > n) continue;
    if (m === 0) return [];
    if (m === 1) { for (let a = 0; a < n; a++) if (has([keys[a]])) return [keys[a]]; continue; }
    if (m === 2) { for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (has([keys[a], keys[b]])) return [keys[a], keys[b]]; continue; }
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) if (has([keys[a], keys[b], keys[c]])) return [keys[a], keys[b], keys[c]];
  }
  return [];
}
function vgVecX(act) { return (act.includes(VG_K_RIGHT) ? 1 : 0) - (act.includes(VG_K_LEFT) ? 1 : 0); }
function vgVecY(act) { return (act.includes(VG_K_DOWN) ? 1 : 0) - (act.includes(VG_K_UP) ? 1 : 0); }
function vgIsSpace(act) { return act.length === 1 && act[0] === VG_K_SPACE; }

// ---------- class updates ----------
function vgUpdMoving(t, i) {
  vgBaseUpdate(t, i);
  const a = vgReadAction(t.acts);
  if (a.length) vgActive(t, i, vgVecX(a), vgVecY(a));
}
function vgUpdHorizontal(t, i) {
  vgBaseUpdate(t, i);
  const a = vgReadAction(t.acts), vx = vgVecX(a), vy = vgVecY(a);
  if (vy === 0 && (vx === 1 || vx === -1)) vgActive(t, i, vx, vy);
}
function vgUpdFlak(t, i) {
  vgUpdHorizontal(t, i);
  if (t.stype != null && VG.keys.includes(VG_K_SPACE)) vgCreate(t.stype, t.x[i], t.y[i]);
}
function vgUpdOriented(t, i) {
  const lox = t.ox[i], loy = t.oy[i];
  t.ox[i] = 0; t.oy[i] = 0;
  vgBaseUpdate(t, i);
  const a = vgReadAction(t.acts);
  if (a.length) vgActive(t, i, vgVecX(a), vgVecY(a));
  const dx = t.x[i] - t.lx[i], dy = t.y[i] - t.ly[i];
  if (dx !== 0 || dy !== 0) { t.ox[i] = dx; t.oy[i] = dy; } else { t.ox[i] = lox; t.oy[i] = loy; }
  return a;
}
function vgHasAmmo(t, i) { if (t.ammo == null) return true; const o = t.res[i]; return !!(o && t.ammo in o) && o[t.ammo] > 0; }
function vgUpdShoot(t, i) {
  const a = vgUpdOriented(t, i);
  if (vgHasAmmo(t, i) && vgIsSpace(a) && t.stype != null) {
    // unit_vector(orientation); neighbor_position(lastrect, dir) = topleft + dir * size, then Rect(pos) truncates
    let ux = t.ox[i], uy = t.oy[i]; const L = Math.hypot(ux, uy);
    if (L > 0) { ux /= L; uy /= L; } else { ux = 1; uy = 0; }
    const nx = Math.trunc(t.lx[i] + ux * VG.B), ny = Math.trunc(t.ly[i] + uy * VG.B);
    const st = VG.byKey[t.stype];
    const j = vgCreate(t.stype, nx, ny);
    if (j >= 0 && st.hasOrient) { st.ox[j] = ux; st.oy[j] = uy; }
    if (t.ammo != null && t.res[i] && t.ammo in t.res[i]) t.res[i][t.ammo] -= 1;
  }
}
function vgUpdRandom(t, i) {
  vgBaseUpdate(t, i);
  const d = VG_BASEDIRS[vgChoiceIndex(4)];
  vgActive(t, i, d[0], d[1]);
}
function vgHamm(x1, y1, x2, y2) { return Math.abs(y1 - y2) + Math.abs(x1 - x2); }
function vgUpdChaser(t, i) {
  vgBaseUpdate(t, i);
  // closest targets by Hamming distance on topleft, then moves toward/away (r.move(a) by ONE PIXEL, as in py)
  const g = vgGroup(t.stype);
  let bestd = Infinity; const tx = [], ty = [];
  const consider = (X, Y) => { const d = vgHamm(t.x[i], t.y[i], X, Y); if (d < bestd) { bestd = d; tx.length = 0; ty.length = 0; tx.push(X); ty.push(Y); } else if (d === bestd) { tx.push(X); ty.push(Y); } };
  if (Array.isArray(g)) { for (const [gt, gi] of g) consider(gt.x[gi], gt.y[gi]); }
  else { for (let k = 0; k < g.n; k++) { const gi = g.live[k]; consider(g.x[gi], g.y[gi]); } }
  const opts = [];
  for (let k = 0; k < tx.length; k++) {
    const base = vgHamm(t.x[i], t.y[i], tx[k], ty[k]);
    for (let d = 0; d < 4; d++) { const a = VG_BASEDIRS[d];
      const nd = vgHamm(t.x[i] + a[0], t.y[i] + a[1], tx[k], ty[k]);
      if (t.fleeing && base < nd) opts.push(a);
      if (!t.fleeing && base > nd) opts.push(a);
    }
  }
  const pool = opts.length ? opts : VG_BASEDIRS;
  const d = pool[vgChoiceIndex(pool.length)];
  vgActive(t, i, d[0], d[1]);
}
function vgUpdSpawn(t, i) {
  if (VG.time % t.cooldown === 0 && vgRandom() < t.prob) {
    VG.createList.push(t.stype, t.x[i], t.y[i]);
    t.counter[i] += 1;
  }
  if (t.total && t.counter[i] >= t.total) vgKill(t, i);
}
function vgUpdBomber(t, i) { vgBaseUpdate(t, i); vgUpdSpawn(t, i); }
function vgUpdFlicker(t, i) {
  vgBaseUpdate(t, i);
  t.age[i] += 1;
  if (t.age[i] >= t.limit) vgKill(t, i);
}
// GravityAvatar (infer-vgdl addition). Blocked by static 'wall'/'breakwall' sprites and by other avatars.
function vgGravBlocked(t, i, x, y) {
  const B = VG.B;
  for (const ty of VG.types) {
    if (ty.isStatic) { if (ty.key !== 'wall' && ty.key !== 'breakwall') continue; }
    else if (!ty.avatar) continue;
    for (let k = 0; k < ty.n; k++) { const j = ty.live[k]; if (ty === t && j === i) continue;
      if (ty.x[j] < x + B && ty.x[j] + B > x && ty.y[j] < y + B && ty.y[j] + B > y) return true; }
  }
  return false;
}
function vgGravOnGround(t, i) {
  const B = VG.B;
  if (vgGravBlocked(t, i, t.x[i], t.y[i] + B)) return true;
  return t.y[i] + B + B >= VG.SH;
}
function vgUpdGravity(t, i) {
  t.lx[i] = t.x[i]; t.ly[i] = t.y[i];
  const a = vgReadAction(t.acts), B = VG.B;
  let movedUp = false;
  if (t.jump[i] > 0) {
    if (!vgGravBlocked(t, i, t.x[i], t.y[i] - B)) { vgSetPos(t, i, t.x[i], t.y[i] - B); t.jump[i] -= 1; movedUp = true; }
    else t.jump[i] = 0;
  }
  const vx = vgVecX(a), vy = vgVecY(a);
  if (vy === 0 && (vx === 1 || vx === -1)) { if (!vgGravBlocked(t, i, t.x[i] + vx * B, t.y[i])) vgSetPos(t, i, t.x[i] + vx * B, t.y[i]); }
  if (a.includes(VG_K_SPACE) && vgGravOnGround(t, i) && t.jump[i] === 0) t.jump[i] = 2;
  const onGround = vgGravOnGround(t, i);
  if (!movedUp && !onGround) { if (!vgGravBlocked(t, i, t.x[i], t.y[i] + B)) vgSetPos(t, i, t.x[i], t.y[i] + B); }
}
function vgUpdOrientedOnly(t, i) { vgUpdOriented(t, i); }
function vgUpdaterFor(t) {
  switch (t.cls) {
    case 'MovingAvatar': return vgUpdMoving;
    case 'HorizontalAvatar': return vgUpdHorizontal;
    case 'FlakAvatar': return vgUpdFlak;
    case 'OrientedAvatar': return vgUpdOrientedOnly;
    case 'ShootAvatar': return vgUpdShoot;
    case 'GravityAvatar': return vgUpdGravity;
    case 'RandomNPC': return vgUpdRandom;
    case 'Chaser': case 'Fleeing': return vgUpdChaser;
    case 'SpawnPoint': return vgUpdSpawn;
    case 'Bomber': return vgUpdBomber;
    case 'Flicker': case 'OrientedFlicker': return vgUpdFlicker;
    default: return vgBaseUpdate;
  }
}

// ---------- effects (effects.py) ----------
function vgLastDir(t, i) { return [t.x[i] - t.lx[i], t.y[i] - t.ly[i]]; }
function vgStepBackPusher(t, i, depth) {
  if (depth > 5) return;
  const pt = t.jpT[i]; if (pt < 0) return;
  const P = VG.types[pt], pi = t.jpI[i];
  vgSetPos(P, pi, P.lx[pi], P.ly[pi]);
  vgStepBackPusher(P, pi, depth + 1);
}
function vgFindOriginMvt(t, i, depth) {
  if (t.jpT[i] >= 0 && depth < 3) return vgFindOriginMvt(VG.types[t.jpT[i]], t.jpI[i], depth + 1);
  return vgLastDir(t, i);
}
function vgUnit(v) { const L = Math.hypot(v[0], v[1]); return L > 0 ? [v[0] / L, v[1] / L] : [1, 0]; }

const VG_EFFECTS = {
  killSprite(a, ai) { vgKill(a, ai); },
  killBoth(a, ai, p, pi) { vgKill(a, ai); if (p) vgKill(p, pi); },
  killIfAlive(a, ai, p, pi) { if (!p || !p.killed[pi]) vgKill(a, ai); },
  changeScore() {},
  transformTo(a, ai, p, pi, args) { vgKill(a, ai); VG.createList.push((args && args.stype) || 'wall', a.x[ai], a.y[ai]); },
  stepBack(a, ai, p, pi, args) {
    if (p && p.killed[pi]) return; if (a.killed[ai]) return;
    if (a.x[ai] === a.lx[ai] && a.y[ai] === a.ly[ai] && !(args && args.no_symmetry)) {
      if (p) { vgSetPos(p, pi, p.lx[pi], p.ly[pi]); vgStepBackPusher(p, pi, 0); }
    } else { vgSetPos(a, ai, a.lx[ai], a.ly[ai]); vgStepBackPusher(a, ai, 0); }
  },
  undoAll() { for (const t of VG.types) for (let k = 0; k < t.n; k++) { const i = t.live[k]; vgSetPos(t, i, t.lx[i], t.ly[i]); } },
  bounceForward(a, ai, p, pi) {
    let d = vgFindOriginMvt(p, pi, 0);
    if (Math.abs(d[0]) + Math.abs(d[1]) === 0) {
      d = vgUnit(vgFindOriginMvt(a, ai, 0)); vgActive(p, pi, d[0], d[1]); p.jpT[pi] = a.idx; p.jpI[pi] = ai; p.jpDirty = true;
    } else { d = vgUnit(d); vgActive(a, ai, d[0], d[1]); a.jpT[ai] = p.idx; a.jpI[ai] = pi; a.jpDirty = true; }
  },
  reverseDirection(a, ai, p, pi, args) {
    if (!(args && args.with_step_back === false)) vgSetPos(a, ai, a.lx[ai], a.ly[ai]);
    if (a.hasOrient) { a.ox[ai] = -a.ox[ai]; a.oy[ai] = -a.oy[ai]; }
  },
  turnAround(a, ai, p, pi) {
    vgSetPos(a, ai, a.lx[ai], a.ly[ai]);
    a.lastmove[ai] = a.cooldown;
    vgActive(a, ai, 0, 1, 1);
    VG_EFFECTS.reverseDirection(a, ai, p, pi, { with_step_back: false });
  },
  collectResource(a, ai, p, pi) { const r = a.resType; vgResSet(p, pi, r, vgResClamp(r, vgRes(p, pi, r) + a.value)); },
  changeResource(a, ai, p, pi, args) { VG.resChanges.push(a.idx, ai, args.resource, args.value == null ? 1 : args.value); },
  addResource(a, ai, p, pi, args) { VG.resChanges.push(p.idx, pi, args.resource, args.value == null ? 1 : args.value); vgKill(a, ai); },
  removeResource(a, ai, p, pi, args) { VG.resChanges.push(p.idx, pi, args.resource, args.value == null ? -1 : args.value); vgKill(a, ai); },
  killIfHasMore(a, ai, p, pi, args) { if (vgRes(a, ai, args.resource) >= (args.limit == null ? 1 : args.limit)) vgKill(a, ai); },
  killIfOtherHasMore(a, ai, p, pi, args) { if (vgRes(p, pi, args.resource) >= (args.limit == null ? 1 : args.limit)) vgKill(a, ai); },
  killIfHasLess(a, ai, p, pi, args) { if (vgRes(a, ai, args.resource) <= (args.limit == null ? 1 : args.limit)) vgKill(a, ai); },
  killIfOtherHasLess(a, ai, p, pi, args) { if (vgRes(p, pi, args.resource) <= (args.limit == null ? 1 : args.limit)) vgKill(a, ai); },
  // teleportToExit: random live exit of the partner's stype; empty group -> stay (py: IndexError -> e = sprite)
  teleportToExit(a, ai, p, pi) {
    const E = VG.byKey[p.stype];
    if (E && E.n > 0) { const j = E.live[vgChoiceIndex(E.n)]; vgSetPos(a, ai, E.x[j], E.y[j]); }
    a.lastmove[ai] = 0;
  },
  DestroyAllBreakwalls(a, ai, p, pi) {
    const g = vgGroup('breakwall');
    const items = Array.isArray(g) ? g.slice() : Array.from({ length: g.n }, (_, k) => [g, g.live[k]]);
    for (const [bt, bi] of items) VG_EFFECTS.transformTo(bt, bi, p, pi, { stype: 'floor' });
  },
};
const VG_MOVE_EFFECTS = new Set(['stepBack', 'bounceForward', 'reverseDirection', 'turnAround']);

// ---------- collisions (core.py:apply_effect) ----------
function vgContains(t, i) { const B = VG.B; return t.x[i] >= 0 && t.y[i] >= 0 && t.x[i] + B <= VG.SW && t.y[i] + B <= VG.SH; }
function vgOverlap(a, ai, p, pi) {
  if (VG.B === 1) return a.x[ai] === p.x[pi] && a.y[ai] === p.y[pi];
  const B = VG.B;
  return a.x[ai] < p.x[pi] + B && a.x[ai] + B > p.x[pi] && a.y[ai] < p.y[pi] + B && a.y[ai] + B > p.y[pi];
}
// candidates of type P overlapping (t,i), in P's live order (creation seq)
const vgCand = [];
let vgCandP = null;
const vgCandCmp = (u, v) => vgCandP.seq[u] - vgCandP.seq[v];
function vgCollectType(t, i, P) {
  vgCand.length = 0;
  if (VG.B === 1) {
    const c = t.cell[i]; if (c < 0) return;
    for (let j = P.head[c]; j >= 0; j = P.next[j]) vgCand.push(j);
  } else {
    const B = VG.B, W = VG.W, H = VG.H;
    const x0 = t.x[i], y0 = t.y[i];
    const cx = Math.floor(x0 / B), cy = Math.floor(y0 / B);
    let xa = cx - 1, xb = cx + 1, ya = cy - 1, yb = cy + 1;
    if (P.aligned) {   // an aligned rect at cell (gx,gy) overlaps [x0,x0+B) iff gx in {cx, floor((x0+B-1)/B)}
      xa = cx; xb = Math.floor((x0 + B - 1) / B); ya = cy; yb = Math.floor((y0 + B - 1) / B);
    }
    for (let y = ya; y <= yb; y++) { if (y < 0 || y >= H) continue;
      for (let x = xa; x <= xb; x++) { if (x < 0 || x >= W) continue;
        for (let j = P.head[y * W + x]; j >= 0; j = P.next[j]) if (vgOverlap(t, i, P, j)) vgCand.push(j);
      } }
  }
  if (vgCand.length > 1) { vgCandP = P; vgCand.sort(vgCandCmp); }
}

function vgApplyEffect(eff) {
  const fn = eff.fn;
  const g2 = eff.actee;
  const A = eff.A || vgGroup(eff.actor);
  if (g2 === 'EOS') {
    if (!Array.isArray(A) && A.inert) return;   // statics never leave the screen
    // reverse order over the actor group
    const run = (t, i) => {
      if (vgContains(t, i)) return;
      VG.score += eff.score;
      if (fn) fn(t, i, null, -1, eff.args);
      if (!vgContains(t, i)) vgKill(t, i);
    };
    if (Array.isArray(A)) { for (let k = A.length - 1; k >= 0; k--) run(A[k][0], A[k][1]); }
    else { for (let k = A.n - 1; k >= 0; k--) run(A, A.live[k]); }
    return;
  }
  const P = eff.P || vgGroup(g2);
  const nA = Array.isArray(A) ? A.length : A.n, nP = Array.isArray(P) ? P.length : P.n;
  if (nA === 0 || nP === 0) return;
  let outer = A, inner = P, reverse = false;
  if (nA > nP) { outer = P; inner = A; reverse = true; }
  const nOuter = Array.isArray(outer) ? outer.length : outer.n;
  for (let k = 0; k < nOuter; k++) {
    let t, i;
    if (Array.isArray(outer)) { t = outer[k][0]; i = outer[k][1]; } else { t = outer; i = outer.live[k]; }
    if (Array.isArray(inner)) {
      // abstract inner group: scan in its order (small in practice)
      for (const [pt, pi] of inner) {
        if (pt === t && pi === i) continue;
        if (!vgOverlap(t, i, pt, pi)) continue;
        if (reverse) { if (!pt.killed[pi]) { VG.score += eff.score; fn && fn(pt, pi, t, i, eff.args); } }
        else { if (!t.killed[i]) { VG.score += eff.score; fn && fn(t, i, pt, pi, eff.args); } }
      }
    } else {
      // py evaluates collidelistall once per outer sprite, then applies to every hit even if an
      // earlier effect moved something: collect first, no re-check.
      vgCollectType(t, i, inner);   // effects never call vgCollectType, so vgCand is stable below
      const cand = vgCand, nc = cand.length;
      for (let q = 0; q < nc; q++) { const j = cand[q];
        if (inner === t && j === i) continue;
        if (reverse) { if (!inner.killed[j]) { VG.score += eff.score; fn && fn(inner, j, t, i, eff.args); } }
        else { if (!t.killed[i]) { VG.score += eff.score; fn && fn(t, i, inner, j, eff.args); } }
      }
    }
  }
}

// ---------- level ----------
function vgBuildLevel(levelStr) {
  const lines = levelStr.split('\n').filter(l => l.length > 0);
  VG.H = lines.length; VG.W = 0; for (const l of lines) if (l.length > VG.W) VG.W = l.length;
  VG.SW = VG.W * VG.B; VG.SH = VG.H * VG.B;
  for (const t of VG.types) { t.n = 0; t.free.length = 0; for (let i = t.cap - 1; i >= 0; i--) t.free.push(i); t.head = new Int32Array(VG.W * VG.H).fill(-1); }
  VG.seq = 0;
  for (let r = 0; r < lines.length; r++) {
    const line = lines[r];
    for (let c = 0; c < line.length; c++) {
      const ks = VG.spec.charMap[line[c]]; if (!ks) continue;
      for (const k of ks) vgCreate(k, c * VG.B, r * VG.B);
    }
  }
}

function vgInit(spec, blockSize) {
  VG.spec = spec; VG.B = blockSize || 1;
  VG.types = []; VG.byKey = {}; VG.resLimits = {};
  spec.keys.forEach((k, idx) => {
    const t = vgMakeType(idx, k, spec.defs[k]); t.singleton = spec.singletons.has(k); t.upd = vgUpdaterFor(t);
    // A static type on the base updater never moves, so lastrect == rect and lastmove is never read:
    // its update is a no-op and is skipped. Statics also never leave the screen, so EOS never fires for them.
    t.inert = t.isStatic && t.upd === vgBaseUpdate;
    t.jpDirty = false;
    VG.types.push(t); VG.byKey[k] = t;
  });
  for (const t of VG.types) if (t.isResource) { const rt = t.resType; if (t.args.limit != null) VG.resLimits[rt] = t.args.limit; }
  for (const e of spec.interactions) {
    e.fn = VG_EFFECTS[e.name] || null;
    e.A = VG.byKey[e.actor] || null;                        // null -> abstract group, resolved per tick
    e.P = e.actee === 'EOS' ? null : (VG.byKey[e.actee] || null);
  }
  VG.stepBacks = spec.interactions.filter(e => e.name === 'stepBack');
  VG.moveEffs = spec.interactions.filter(e => e.name === 'bounceForward' || e.name === 'reverseDirection' || e.name === 'turnAround');
  VG.nonMove = spec.interactions.filter(e => !VG_MOVE_EFFECTS.has(e.name));
}

function vgReset(levelStr, seed) {
  vgRngSeed(seed);
  vgBuildLevel(levelStr);
  VG.time = 0; VG.score = 0; VG.ended = false; VG.won = false;
  VG.killList.length = 0; VG.createList.length = 0; VG.resChanges.length = 0;
}

// ---------- tick (core.py:tick) ----------
const vgN0 = [];
function vgTick(keys) {
  VG.time += 1;
  if (VG.ended) return;
  VG.keys = keys;
  // update phase: snapshot of live sprites in registration order; sprites created mid-phase are not updated
  const T = VG.types;
  for (let a = 0; a < T.length; a++) { const t = T[a]; vgN0[a] = t.n; if (t.jpDirty) { for (let k = 0; k < t.n; k++) t.jpT[t.live[k]] = -1; t.jpDirty = false; } }
  for (let a = 0; a < T.length; a++) { const t = T[a]; if (t.inert) continue; const n0 = vgN0[a], upd = t.upd; for (let k = 0; k < n0; k++) upd(t, t.live[k]); }
  // collisions: stepBack, then bounce family, then stepBack again, then everything else
  VG.ss = {};
  const SB = VG.stepBacks, ME = VG.moveEffs, NM = VG.nonMove;
  for (let k = 0; k < SB.length; k++) vgApplyEffect(SB[k]);
  for (let k = 0; k < ME.length; k++) vgApplyEffect(ME[k]);
  for (let k = 0; k < SB.length; k++) vgApplyEffect(SB[k]);
  for (let k = 0; k < NM.length; k++) vgApplyEffect(NM[k]);
  VG.ss = null;
  vgFlush();
  vgCheckTerminations();
}
// flush: kills, creations, resource changes (shared with the compiled tick)
function vgFlush() {
  const T = VG.types;
  for (let a = 0; a < T.length; a++) { const t = T[a];
    if (t.n === 0) continue;
    let w = 0;
    for (let k = 0; k < t.n; k++) { const i = t.live[k]; if (t.killed[i]) { vgGridUnlink(t, i); t.cell[i] = -1; t.free.push(i); } else t.live[w++] = i; }
    t.n = w;
  }
  VG.killList.length = 0;
  for (let k = 0; k < VG.createList.length; k += 3) vgCreate(VG.createList[k], VG.createList[k + 1], VG.createList[k + 2]);
  VG.createList.length = 0;
  for (let k = 0; k < VG.resChanges.length; k += 4) {
    const t = T[VG.resChanges[k]], i = VG.resChanges[k + 1], r = VG.resChanges[k + 2], v = VG.resChanges[k + 3];
    vgResSet(t, i, r, vgResClamp(r, vgRes(t, i, r) + v));   // applied even to a sprite killed this tick, as in py
  }
  VG.resChanges.length = 0;
}
function vgCheckTerminations() {
  const TM = VG.spec.terminations;
  for (let q = 0; q < TM.length; q++) { const tm = TM[q];
    let ended = false, won = false; const A = tm.args;
    if (tm.type === 'Timeout') { if (VG.time >= (A.limit || 0)) { ended = true; won = !!A.win; } }
    else if (tm.type === 'SpriteCounter') { if (vgNumSprites(A.stype) <= (A.limit || 0)) { ended = true; won = !!A.win; } }
    else if (tm.type === 'MultiSpriteCounter') { let s = 0; for (const k in A) if (k.startsWith('stype')) s += vgNumSprites(A[k]); if (s === (A.limit || 0)) { ended = true; won = A.win == null ? true : !!A.win; } }
    VG.ended = ended; VG.won = won;
    if (ended) { VG.score += A.scoreChange || 0; break; }
  }
}

// ---------- gate support: structured snapshot, same shape as oracle.py ----------
function vgSnapshot() {
  const rows = [];
  for (const t of VG.types) for (let k = 0; k < t.n; k++) {
    const i = t.live[k]; const o = t.res[i];
    const res = o ? Object.keys(o).sort().map(r => [r, o[r]]) : [];
    rows.push([t.key, t.x[i], t.y[i], res]);
  }
  rows.sort((a, b) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); return sa < sb ? -1 : sa > sb ? 1 : 0; });
  return rows;
}
