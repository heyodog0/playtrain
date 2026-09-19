// ---- Semantics profile 'rcrl': tomov/RC_RL @ fmri (Tsividis-lineage py-vgdl, Python 2). ----
// The fMRI stimuli were played on this fork. It shares the sprite tables and grids
// of 30_engine.js but nothing of its tick: RC_RL updates sprites in sprite_order with
// the avatar last, gates movement on (lastmove+1) % cooldown == 0 without resetting
// lastmove, resolves collisions in a fixpoint loop over new (sprite, sprite) pairs
// with effects pre-sorted by class, flushes kills at the start of the NEXT action,
// increments time after the update, sorts terminations avatar-loss-first and pays
// per-termination bonuses, draws random.choice as Python 2's int(random()*n), and
// skips the avatar's update entirely on a NOOP action. Every one of those is
// reproduced here on purpose; see tests/oracle_rcrl.py for the reference run.

const RC_CLASS = {
  VGDLSprite:     {},
  Immovable:      { is_static: true },
  Passive:        {},
  Resource:       { value: 1, limit: 2, is_resource: true },
  ResourcePack:   { is_static: true, value: 1, limit: 2, is_resource: true },
  Flicker:        { flicker: true, limit: 20 },
  OrientedFlicker:{ flicker: true, limit: 20, oriented: true, speed: 0 },
  Portal:         { is_static: true },
  SpawnPoint:     { is_static: true, spawn: true },
  RandomNPC:      { speed: 1, random: true },
  OrientedSprite: { oriented: true },
  Missile:        { oriented: true, speed: 1 },
  Bomber:         { oriented: true, speed: 1, spawn: true, bomber: true },
  Chaser:         { speed: 1, chaser: true },
  Fleeing:        { speed: 1, chaser: true, fleeing: true },
  MovingAvatar:   { speed: 1, avatar: 'moving' },
  HorizontalAvatar:{ speed: 1, avatar: 'horizontal' },
  FlakAvatar:     { speed: 1, avatar: 'flak' },
  OrientedAvatar: { speed: 1, avatar: 'oriented', oriented: true },
  ShootAvatar:    { speed: 1, avatar: 'shoot', oriented: true },
};
// RC_RL colours (vgdl/colors.py), the palette the fMRI participants saw
const RC_COLORS = {
  GREEN: [129, 199, 132], BLUE: [25, 118, 210], RED: [211, 47, 47], GRAY: [69, 90, 100], WHITE: [250, 250, 250],
  BROWN: [109, 76, 65], BLACK: [55, 71, 79], ORANGE: [230, 81, 0], YELLOW: [255, 245, 157], PINK: [255, 138, 128],
  GOLD: [255, 196, 0], LIGHTRED: [255, 82, 82], LIGHTORANGE: [255, 112, 67], LIGHTBLUE: [144, 202, 249],
  LIGHTGREEN: [185, 246, 202], LIGHTGRAY: [207, 216, 220], DARKGRAY: [68, 90, 100], DARKBLUE: [1, 87, 155], PURPLE: [92, 107, 192],
};
const RC_BASEDIRS = VG_BASEDIRS;   // UP LEFT DOWN RIGHT
const RC_KEY_ORDER = ['wall', 'avatar'];   // BasicGame.sprite_order before the SpriteSet is parsed

// Python 2 random.choice: seq[int(random() * len)]
function rcChoice(n) { return Math.floor(vgRandom() * n); }

// ---------- init ----------
function rcInit(spec, blockSize) {
  VG.spec = spec; VG.B = blockSize || 30; VG.profile = 'rcrl';
  // default constructors for wall / avatar when the SpriteSet does not declare them
  const defs = Object.assign({}, spec.defs);
  if (!defs.wall) defs.wall = { cls: 'Immovable', args: { color: 'DARKGRAY' }, stypes: ['wall'] };
  if (!defs.avatar) defs.avatar = { cls: 'MovingAvatar', args: {}, stypes: ['avatar'] };
  // sprite_order: ['wall','avatar'] then declared keys (moved to their declared position); avatar last at build
  let order = RC_KEY_ORDER.slice();
  for (const k of spec.keys) { const i = order.indexOf(k); if (i >= 0) order.splice(i, 1); order.push(k); }
  order = order.filter(k => k !== 'avatar'); order.push('avatar');
  VG.types = []; VG.byKey = {}; VG.resLimits = {};
  order.forEach((k, idx) => {
    const d = defs[k], cd = RC_CLASS[d.cls] || RC_CLASS.VGDLSprite, A = d.args;
    const t = vgMakeType(idx, k, d);            // storage + generic fields
    // RC_RL parameter semantics (VGDLSprite.__init__: `x = x or default`)
    t.isStatic = !!cd.is_static;
    t.cooldown = A.cooldown ? A.cooldown : 1;
    t.speed = A.speed ? A.speed : (cd.speed != null ? cd.speed : NaN);
    t.hasOrient = true;                          // every sprite has .orientation (class attr (0,0))
    t.orient0 = A.orientation != null ? A.orientation : (cd.oriented ? [1, 0] : [0, 0]);
    t.oriented = !!cd.oriented || A.orientation != null;   // isinstance(OrientedSprite) for transformTo / shooting
    t.flicker = !!cd.flicker; t.limit = A.limit != null ? A.limit : (cd.limit != null ? cd.limit : 2);
    t.spawn = !!cd.spawn; t.bomber = !!cd.bomber;
    t.spawnCooldown = A.spawnCooldown ? A.spawnCooldown : 1;
    t.prob = A.prob ? A.prob : (cd.spawn ? 1 : null);
    t.total = A.total ? A.total : 0;
    t.random = !!cd.random; t.chaser = !!cd.chaser; t.fleeing = !!cd.fleeing;
    t.avatar = cd.avatar || null; t.isAvatarCls = /Avatar/.test(d.cls);
    t.isResource = !!cd.is_resource; t.value = A.value != null ? A.value : 1;
    t.resType = A.res_type != null ? A.res_type : k;
    t.stype = A.stype != null ? A.stype : null; t.ammo = A.ammo != null ? A.ammo : null;
    t.singleton = spec.singletons.has(k);
    t.upd = rcUpdaterFor(t);
    // A static type on the base updater only bumps lastmove/lastrect, which nothing reads for a
    // sprite that never moves: skip its update (same reasoning as the Colas profile's `inert`).
    t.inert = t.isStatic && !cd.spawn && !cd.flicker;
    VG.types.push(t); VG.byKey[k] = t;
  });
  for (const t of VG.types) if (t.isResource && t.args.limit != null) VG.resLimits[t.resType] = t.args.limit;
  // effects sorted by class (parseInteractions), stable, descending key
  const prio = e => {
    const n = e.name, v = e.args.value;
    if (n === 'bounceForward' || n === 'stepBack' || n === 'wallStop') return 1;
    if (['killSprite', 'killIfTooFast', 'killIfHasMore', 'killIfHasLess', 'killIfOtherHasMore', 'killIfOtherHasLess', 'collectResource'].includes(n)) return 2;
    if (['changeScore', 'conveySprite', 'changeResource'].includes(n)) return (v == null || v <= 0) ? 3 : 3.5;
    if (n === 'nothing') return 4;
    return 0;
  };
  VG.rcEffects = spec.interactions.map((e, i) => ({ e, i, p: prio(e) })).sort((a, b) => b.p - a.p || a.i - b.i).map(x => x.e);
  for (const e of VG.rcEffects) e.fn = RC_EFFECTS[e.name] || null;
  // terminations sorted as _isDone does (stable): avatar-loss SpriteCounter, other SpriteCounters, the rest
  const tprio = t => (t.type === 'SpriteCounter' && t.args.stype === 'avatar' && t.args.win === false) ? 1 : t.type === 'SpriteCounter' ? 2 : 3;
  VG.rcTerms = spec.terminations.map((t, i) => ({ t, i, p: tprio(t) })).sort((a, b) => a.p - b.p || a.i - b.i).map(x => x.t);
  VG.groupOrder = null;   // py2 dict order of sprite_groups, supplied by the oracle (setGroupOrder)
  VG.rcMembers = {};      // stype -> member types, in group order (filled lazily; reset when groupOrder is set)
}

function rcReset(levelStr, seed) {
  vgRngSeed(seed);
  vgBuildLevelRc(levelStr);
  VG.time = 0; VG.score = 0; VG.ended = false; VG.won = false;
  VG.killList.length = 0;
  VG.spriteBonusT = -1; VG.timeoutBonusT = -1;
  VG.avatarT = VG.byKey.avatar ? VG.byKey.avatar.idx : -1;
  // softReset: one action-less step (avatar updated, no keys) before the first agent action
  if (VG.tickImpl) VG.tickImpl(null); else rcTick(null);
}
// buildLevel with RC_RL's default_mapping ('w' -> wall, 'A' -> avatar for chars the LevelMapping lacks)
function vgBuildLevelRc(levelStr) {
  const lines = levelStr.split('\n').filter(l => l.length > 0);
  VG.H = lines.length; VG.W = 0; for (const l of lines) if (l.length > VG.W) VG.W = l.length;
  VG.SW = VG.W * VG.B; VG.SH = VG.H * VG.B;
  for (const t of VG.types) { t.n = 0; t.free.length = 0; for (let i = t.cap - 1; i >= 0; i--) t.free.push(i); t.head = new Int32Array(VG.W * VG.H).fill(-1); t.aligned = true; }
  VG.seq = 0;
  const cm = VG.spec.charMap;
  for (let r = 0; r < lines.length; r++) {
    const line = lines[r];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const ks = cm[ch] || (ch === 'w' ? ['wall'] : ch === 'A' ? ['avatar'] : null);
      if (!ks) continue;
      for (const k of ks) rcCreate(k, c * VG.B, r * VG.B);
    }
  }
}
// _createSprite: a singleton anywhere in the stype chain with a live (non-killed) member blocks creation
function rcCreate(key, x, y) {
  const t = VG.byKey[key]; if (!t) return -1;
  for (let s = t.stypes.length - 1; s >= 0; s--) { const pk = t.stypes[s]; const pt = VG.byKey[pk]; if (pt && pt.singleton && rcNumSprites(pk) > 0) return -1; }
  return vgCreate(key, x, y, true);   // RC_RL's own singleton rule above (kill list excluded) replaces the Colas one
}
function rcLiveCount(t) { let n = 0; for (let k = 0; k < t.n; k++) if (!t.killed[t.live[k]]) n++; return n; }
function rcNumSprites(st) {
  const t = VG.byKey[st]; if (t) return rcLiveCount(t);
  let n = 0; for (const ty of VG.types) if (ty.stypes.includes(st)) n += rcLiveCount(ty);
  return n;
}
// getSprites(stype): live minus kill list, as [t, i] pairs, in group order
function rcGetSprites(st) {
  const out = [], types = rcMemberTypes(st);
  for (let a = 0; a < types.length; a++) { const ty = types[a]; for (let k = 0; k < ty.n; k++) { const i = ty.live[k]; if (!ty.killed[i]) out.push([ty, i]); } }
  return out;
}
// sprite_groups in the reference's dict order (needed for abstract groups); falls back to sprite_order
function rcGroupTypes() {
  if (VG.groupOrder) return VG.groupOrder.map(k => VG.byKey[k]).filter(Boolean);
  return VG.types;
}

// ---------- movement (GridPhysics, RC_RL flavour) ----------
function rcUpdatePos(t, i, ox, oy, speed) {
  if ((t.lastmove[i] + 1) % t.cooldown === 0 && Math.abs(ox) + Math.abs(oy) !== 0) {
    vgSetPos(t, i, t.x[i] + Math.trunc(ox * speed), t.y[i] + Math.trunc(oy * speed));
  }
}
function rcSpeed(t) { return Number.isNaN(t.speed) ? 1 : t.speed; }
function rcPassive(t, i) {
  const sp = rcSpeed(t);
  if (sp !== 0) rcUpdatePos(t, i, t.ox[i], t.oy[i], sp * VG.B);
}
function rcActive(t, i, ax, ay) {
  const sp = rcSpeed(t);
  if (sp !== 0) rcUpdatePos(t, i, ax, ay, sp * VG.B);
}
function rcBaseUpdate(t, i, randomNpc) {
  t.lx[i] = t.x[i]; t.ly[i] = t.y[i];
  t.lastmove[i] += 1;
  if (!t.isStatic && !randomNpc) rcPassive(t, i);
}

// ---------- input (MovingAvatar._readMultiActions on a keystate) ----------
function rcReadAction() {
  const k = VG.keys;
  if (k.includes(VG_K_RIGHT)) return [1, 0];
  if (k.includes(VG_K_LEFT)) return [-1, 0];
  if (k.includes(VG_K_UP)) return [0, -1];
  if (k.includes(VG_K_DOWN)) return [0, 1];
  return null;
}

// ---------- class updates ----------
function rcUpdMoving(t, i) { rcBaseUpdate(t, i, false); const a = rcReadAction(); if (a) rcActive(t, i, a[0], a[1]); }
function rcUpdHorizontal(t, i) { rcBaseUpdate(t, i, false); const a = rcReadAction(); if (a && a[1] === 0) rcActive(t, i, a[0], a[1]); }
function rcUpdFlak(t, i) { rcUpdHorizontal(t, i); if (t.stype && VG.keys.includes(VG_K_SPACE)) rcCreate(t.stype, t.x[i], t.y[i]); }
function rcUpdOriented(t, i) {
  const tx = t.ox[i], ty = t.oy[i];
  t.ox[i] = 0; t.oy[i] = 0;
  rcBaseUpdate(t, i, false);
  const a = rcReadAction(); if (a) rcActive(t, i, a[0], a[1]);
  const dx = t.x[i] - t.lx[i], dy = t.y[i] - t.ly[i];
  if (Math.abs(dx) + Math.abs(dy) > 0) { t.ox[i] = dx; t.oy[i] = dy; } else { t.ox[i] = tx; t.oy[i] = ty; }
}
function rcHasAmmo(t, i) { if (t.ammo == null) return true; const o = t.res[i]; return !!(o && t.ammo in o) && o[t.ammo] > 0; }
function rcUnit(x, y) { const L = Math.sqrt(x * x + y * y); return L > 0 ? [x / L, y / L] : [1, 0]; }
function rcUpdShoot(t, i) {
  rcUpdOriented(t, i);
  if (!rcHasAmmo(t, i)) return;
  if (t.stype && VG.keys.includes(VG_K_SPACE)) {
    const u = rcUnit(t.ox[i], t.oy[i]);
    const st = VG.byKey[t.stype];
    const j = rcCreate(t.stype, Math.trunc(t.lx[i] + u[0] * VG.B), Math.trunc(t.ly[i] + u[1] * VG.B));
    if (j >= 0 && st.oriented) { st.ox[j] = u[0]; st.oy[j] = u[1]; }
    if (t.ammo != null && t.res[i] && t.ammo in t.res[i]) t.res[i][t.ammo] -= 1;
  }
}
function rcUpdRandom(t, i) {
  t.lastmove[i] -= 1;
  rcBaseUpdate(t, i, true);
  const d = RC_BASEDIRS[rcChoice(4)];
  t.ox[i] = d[0]; t.oy[i] = d[1];
  rcActive(t, i, d[0], d[1]);
  t.lastmove[i] += 1;
}
function rcDist(x1, y1, x2, y2) { return Math.sqrt((y1 - y2) * (y1 - y2) + (x1 - x2) * (x1 - x2)); }
function rcUpdChaser(t, i) {
  rcBaseUpdate(t, i, false);
  const targets = rcGetSprites(t.stype);
  let bestd = 1e100; const tx = [], ty = [];
  for (const [gt, gi] of targets) {
    const d = rcDist(t.x[i], t.y[i], gt.x[gi], gt.y[gi]);
    if (d < bestd) { bestd = d; tx.length = 0; ty.length = 0; tx.push(gt.x[gi]); ty.push(gt.y[gi]); }
    else if (d === bestd) { tx.push(gt.x[gi]); ty.push(gt.y[gi]); }
  }
  const opts = [];
  for (let k = 0; k < tx.length; k++) {
    const base = rcDist(t.x[i], t.y[i], tx[k], ty[k]);
    for (let q = 0; q < 4; q++) { const a = RC_BASEDIRS[q];
      const nd = rcDist(t.x[i] + a[0], t.y[i] + a[1], tx[k], ty[k]);
      if (t.fleeing && base < nd) opts.push(a);
      if (!t.fleeing && base > nd) opts.push(a);
    }
  }
  const pool = opts.length ? opts : RC_BASEDIRS;
  const d = pool[rcChoice(pool.length)];
  rcActive(t, i, d[0], d[1]);
}
function rcUpdSpawn(t, i) {
  if (t.total && t.counter[i] >= t.total) { rcKill(t, i); return; }
  const sc = t.spawnCooldown, tm = VG.time + 1;
  const hit = sc < 11 ? (tm % sc === 0) : (tm % sc === 3);
  if (hit && t.prob != null && vgRandom() < t.prob) { rcCreate(t.stype, t.x[i], t.y[i]); t.counter[i] += 1; }
  t.lastmove[i] += 1;
}
function rcUpdBomber(t, i) { t.lastmove[i] -= 1; rcBaseUpdate(t, i, false); rcUpdSpawn(t, i); }
function rcUpdFlicker(t, i) { rcBaseUpdate(t, i, false); if (t.age[i] >= t.limit) rcKill(t, i); else t.age[i] += 1; }
function rcUpdaterFor(t) {
  switch (t.cls) {
    case 'MovingAvatar': return rcUpdMoving;
    case 'HorizontalAvatar': return rcUpdHorizontal;
    case 'FlakAvatar': return rcUpdFlak;
    case 'OrientedAvatar': return rcUpdOriented;
    case 'ShootAvatar': return rcUpdShoot;
    case 'RandomNPC': return rcUpdRandom;
    case 'Chaser': case 'Fleeing': return rcUpdChaser;
    case 'SpawnPoint': return rcUpdSpawn;
    case 'Bomber': return rcUpdBomber;
    case 'Flicker': case 'OrientedFlicker': return rcUpdFlicker;
    default: return rcUpdBase;
  }
}
function rcUpdBase(t, i) { rcBaseUpdate(t, i, false); }

// ---------- effects ----------
function rcKill(t, i) { if (!t.killed[i]) { t.killed[i] = 1; VG.killList.push(t.idx, i); } }
// sprite.resources is a defaultdict(int): a read creates the key, and the state dump shows it
function rcResRead(t, i, r) { const o = t.res[i]; if (o && r in o) return o[r]; vgResSet(t, i, r, 0); return 0; }
function rcLimit(r) { return r in VG.resLimits ? VG.resLimits[r] : 0; }   // resources_limits is a defaultdict(int)
const RC_EFFECTS = {
  nothing() {},
  killSprite(a, ai) { rcKill(a, ai); },
  changeScore(a, ai, p, pi, args) { VG.score += args.value; },
  transformTo(a, ai, p, pi, args, ctx) {
    const st = VG.byKey[args.stype || 'wall'];
    const j = rcCreate(args.stype || 'wall', a.x[ai], a.y[ai]);
    if (j >= 0) {
      if (a.oriented && st.oriented) { st.ox[j] = a.ox[ai]; st.oy[j] = a.oy[ai]; st.res[j] = a.res[ai]; }
      rcKill(a, ai);
    }
    if (ctx) ctx.created = j >= 0 ? [st, j] : null;
  },
  stepBack(a, ai) { vgSetPos(a, ai, a.lx[ai], a.ly[ai]); },
  undoAll() { for (const t of VG.types) for (let k = 0; k < t.n; k++) { const i = t.live[k]; vgSetPos(t, i, t.lx[i], t.ly[i]); } },
  bounceForward(a, ai, p, pi) { const u = rcUnit(p.x[pi] - p.lx[pi], p.y[pi] - p.ly[pi]); rcActive(a, ai, u[0], u[1]); },
  reverseDirection(a, ai) { a.ox[ai] = -a.ox[ai]; a.oy[ai] = -a.oy[ai]; },
  turnAround(a, ai, p, pi) {
    vgSetPos(a, ai, a.lx[ai], a.ly[ai]);
    a.lastmove[ai] = a.cooldown - 1;
    rcActive(a, ai, 0, 1);
    RC_EFFECTS.reverseDirection(a, ai);
  },
  wrapAround(a, ai, p, pi, args) {
    const off = args.offset || 0, B = VG.B;
    let x = a.x[ai], y = a.y[ai];
    if (a.ox[ai] > 0) x = off * B; else if (a.ox[ai] < 0) x = VG.SW - B * (1 + off);
    if (a.oy[ai] > 0) y = off * B; else if (a.oy[ai] < 0) y = VG.SH - B * (1 + off);
    vgSetPos(a, ai, x, y); a.lastmove[ai] = 0;
  },
  killIfOtherHasMore(a, ai, p, pi, args) { if (rcResRead(p, pi, args.resource) >= (args.limit == null ? 1 : args.limit)) rcKill(a, ai); },
  killIfHasMore(a, ai, p, pi, args) { if (rcResRead(a, ai, args.resource) >= (args.limit == null ? 1 : args.limit)) rcKill(a, ai); },
  killIfHasLess(a, ai, p, pi, args) { if (rcResRead(a, ai, args.resource) <= (args.limit == null ? 1 : args.limit)) rcKill(a, ai); },
  killIfOtherHasLess(a, ai, p, pi, args) { if (rcResRead(p, pi, args.resource) <= (args.limit == null ? 1 : args.limit)) rcKill(a, ai); },
  killIfAlive(a, ai, p, pi) { if (!p.killed[pi]) rcKill(a, ai); },
  changeResource(a, ai, p, pi, args) { const r = args.resource, v = args.value == null ? 1 : args.value; vgResSet(a, ai, r, Math.max(-1, Math.min(rcResRead(a, ai, r) + v, rcLimit(r)))); },
  collectResource(a, ai, p, pi, args) {
    const r = args.resource != null ? args.resource : a.resType;
    vgResSet(p, pi, r, Math.max(-1, Math.min(rcResRead(p, pi, r) + a.value, rcLimit(r))));
    rcKill(a, ai);
  },
  killIfFromAbove(a, ai, p, pi) { if (a.ly[ai] > p.ly[pi] && p.y[pi] > p.ly[pi]) rcKill(a, ai); },
};

// ---------- event handling (core.py:_eventHandling) ----------
// lastcollisions: stype -> snapshot of the raw group (kill list included) at first use in this
// tick. Membership is frozen at snapshot time (a sprite created later is not in it until the
// entry is invalidated), positions are read live: exactly collidelistall on a copied list.
// Inner-side lookups go through the per-type cell grids; a candidate belongs to the snapshot
// iff its creation seq predates the snapshot.
function rcMemberTypes(st) {
  let m = VG.rcMembers[st];
  if (m) return m;
  const t = VG.byKey[st];
  m = t ? [t] : rcGroupTypes().filter(ty => ty.stypes.includes(st));
  VG.rcMembers[st] = m;
  return m;
}
function rcGroupEntry(st, cache) {
  let e = cache[st];
  if (e) return e;
  const types = rcMemberTypes(st), list = [];
  for (let a = 0; a < types.length; a++) { const ty = types[a]; for (let k = 0; k < ty.n; k++) list.push(ty, ty.live[k]); }
  e = { types, list, seqAt: VG.seq, index: null };
  cache[st] = e;
  return e;
}
function rcSpriteKey(a, ai) { return (a.idx << 20) | ai; }
function rcEntryIndex(e) {
  if (e.index) return e.index;
  const m = new Map(); for (let u = 0; u < e.list.length; u += 2) m.set(rcSpriteKey(e.list[u], e.list[u + 1]), u >> 1);
  e.index = m; return m;
}
// effects that move nothing: the overlapping pair set is fixed for the whole rule, so it may be
// enumerated from whichever side is smaller and then replayed in the reference's (actor, partner) order
const RC_NO_MOVE = new Set(['nothing', 'killSprite', 'changeScore', 'transformTo', 'killIfOtherHasMore', 'killIfHasMore', 'killIfHasLess', 'killIfOtherHasLess', 'killIfAlive', 'changeResource', 'collectResource', 'killIfFromAbove']);
const rcPairs = [];
const rcCand = [];
// candidates of the snapshot `e` overlapping (t,i), in snapshot order (type order, then creation seq)
function rcCollect(t, i, e) {
  rcCand.length = 0;
  const types = e.types;
  for (let a = 0; a < types.length; a++) {
    const P = types[a];
    if (P.n === 0) continue;
    vgCollectType(t, i, P);
    for (let q = 0; q < vgCand.length; q++) { const j = vgCand[q]; if (P.seq[j] < e.seqAt) rcCand.push(P, j); }
  }
}
function rcApplyPair(eff, fn, score, s1, i1, s2, i2, dead, collisionSet, newCollisions, force, cache) {
  if (s1 === s2 && i1 === i2) return;
  const k1 = rcSpriteKey(s1, i1), k2 = rcSpriteKey(s2, i2);
  if (dead.has(k1) || dead.has(k2)) return;
  const pk = k1 * 67108864 + k2;
  if (collisionSet.has(pk)) return;
  newCollisions.add(pk);
  if (score) VG.score += score;
  if (eff.name === 'transformTo') {
    const ctx = {};
    fn(s1, i1, s2, i2, eff.args, ctx);
    if (ctx.created) newCollisions.add(k1 * 67108864 + rcSpriteKey(ctx.created[0], ctx.created[1]));
    dead.add(k1);
  } else if (eff.name === 'bounceForward') {
    for (const set of force) if (set.has(k2)) set.add(k1);
    force.push(new Set([k1, k2]));      // python for/else: the else clause always runs (no break)
    fn(s1, i1, s2, i2, eff.args);
    for (const st of s1.stypes) delete cache[st];   // _updateCollisionDict(sprite1)
  } else if (eff.name === 'stepBack') {
    for (const set of force) if (set.has(k1)) for (const sk of set) { const st = VG.types[sk >> 20], si = sk & 0xfffff; fn(st, si, s2, i2, eff.args); }
    fn(s1, i1, s2, i2, eff.args);       // for/else again: the plain effect always applies too
  } else if (eff.name === 'turnAround') {
    fn(s1, i1, s2, i2, eff.args);
    for (const st of s1.stypes) delete cache[st];
  } else if (fn) {
    fn(s1, i1, s2, i2, eff.args);
  }
}
// position-invariant rule with a large actor group: enumerate from the partner side, replay in reference order
function rcRuleSmallSide(eff, score, e1, e2, dead, collisionSet, newCollisions, force, cache) {
  const fn = eff.fn;
  rcPairs.length = 0;
  const idx1 = rcEntryIndex(e1), l2 = e2.list;
  for (let v = 0; v < l2.length; v += 2) {
    const s2 = l2[v], i2 = l2[v + 1];
    rcCollect(s2, i2, e1);
    for (let q = 0; q < rcCand.length; q += 2) { const s1 = rcCand[q], i1 = rcCand[q + 1]; rcPairs.push(idx1.get(rcSpriteKey(s1, i1)) * 4096 + (v >> 1), s1, i1, s2, i2); }
  }
  if (rcPairs.length > 5) {
    const n = rcPairs.length / 5, ord = new Array(n); for (let k = 0; k < n; k++) ord[k] = k;
    ord.sort((a, b) => rcPairs[a * 5] - rcPairs[b * 5]);
    const sorted = new Array(rcPairs.length); for (let k = 0; k < n; k++) for (let f = 0; f < 5; f++) sorted[k * 5 + f] = rcPairs[ord[k] * 5 + f];
    for (let k = 0; k < sorted.length; k++) rcPairs[k] = sorted[k];
  }
  for (let k = 0; k < rcPairs.length; k += 5) rcApplyPair(eff, fn, score, rcPairs[k + 1], rcPairs[k + 2], rcPairs[k + 3], rcPairs[k + 4], dead, collisionSet, newCollisions, force, cache);
}
function rcEvents() {
  const cache = {};
  const dead = new Set();                     // kill list at entry (kills made during the update phase)
  for (let k = 0; k < VG.killList.length; k += 2) dead.add(rcSpriteKey(VG.types[VG.killList[k]], VG.killList[k + 1]));
  const collisionSet = new Set();
  const force = [];                           // list of Sets of sprite keys (bounceForward chains)
  const EFF = VG.rcEffects;
  let again = true;
  while (again) {
    const newCollisions = new Set();
    for (let q = 0; q < EFF.length; q++) {
      const eff = EFF[q], fn = eff.fn, c1 = eff.actor, c2 = eff.actee;
      const e1 = rcGroupEntry(c1, cache), l1 = e1.list;
      if (c2 === 'EOS') {
        for (let u = 0; u < l1.length; u += 2) { const s = l1[u], si = l1[u + 1]; if (!vgContains(s, si) && fn) fn(s, si, null, -1, eff.args); }
        continue;
      }
      const e2 = rcGroupEntry(c2, cache);
      if (l1.length === 0 || e2.list.length === 0) continue;
      const score = eff.score || 0;
      // enumerate overlapping (actor, partner) pairs as [u, s1, i1, s2, i2, ...] in actor-then-partner order
      if (RC_NO_MOVE.has(eff.name) && l1.length > 4 * e2.list.length) { rcRuleSmallSide(eff, score, e1, e2, dead, collisionSet, newCollisions, force, cache); continue; }
      for (let u = 0; u < l1.length; u += 2) {
        const s1 = l1[u], i1 = l1[u + 1];
        rcCollect(s1, i1, e2);
        if (rcCand.length === 0) continue;
        const cand = rcCand.slice();          // effects below may relink cells
        for (let v = 0; v < cand.length; v += 2) rcApplyPair(eff, fn, score, s1, i1, cand[v], cand[v + 1], dead, collisionSet, newCollisions, force, cache);
      }
    }
    for (const pk of newCollisions) collisionSet.add(pk);
    again = newCollisions.size > 0;
  }
}

// ---------- terminations (_isDone with bonuses) ----------
function rcCheckTerminations() {
  VG.ended = false; VG.won = false;
  for (const tm of VG.rcTerms) {
    const A = tm.args;
    if (tm.type === 'Timeout') {
      if (VG.time >= (A.limit || 0)) { VG.ended = true; VG.won = !!A.win; return; }
      if (VG.time > VG.timeoutBonusT) { VG.score += A.bonus || 0; VG.timeoutBonusT = VG.time; }
    } else if (tm.type === 'SpriteCounter') {
      if (rcNumSprites(A.stype) <= (A.limit || 0)) {
        if (VG.time > VG.spriteBonusT) { VG.score += A.bonus || 0; VG.spriteBonusT = VG.time; }
        VG.ended = true; VG.won = A.win == null ? true : !!A.win; return;
      }
    } else if (tm.type === 'MultiSpriteCounter') {
      let s = 0; for (const k in A) if (k.startsWith('stype')) s += rcNumSprites(A[k]);
      if (s === (A.limit || 0)) {
        if (VG.time > VG.spriteBonusT) { VG.score += A.bonus || 0; VG.spriteBonusT = VG.time; }
        VG.ended = true; VG.won = A.win == null ? true : !!A.win; return;
      }
    }
  }
}

// ---------- tick (RLEnvironmentNonStatic.step + _performAction) ----------
// keys: null for the soft-reset step (avatar updated, no keys); [] for NOOP (avatar skipped).
function rcTick(keys) {
  if (VG.ended) { VG.time += 1; return; }
  const noop = keys !== null && keys.length === 0;
  VG.keys = keys || [];
  const T = VG.types;
  // update phase in sprite_order over the LIVE lists (sprites created mid-phase are updated if their type comes later)
  for (let a = 0; a < T.length; a++) {
    const t = T[a];
    if (noop && a === VG.avatarT) continue;
    if (t.inert) continue;
    const upd = t.upd;
    for (let k = 0; k < t.n; k++) { const i = t.live[k]; if (t.killed[i]) continue; upd(t, i); }
  }
  rcEvents();
  rcFlush();
  VG.time += 1;
  rcCheckTerminations();
}
// kills flush (RC_RL does it at the start of the next action; nothing observes the difference)
function rcFlush() {
  const T = VG.types;
  for (let a = 0; a < T.length; a++) { const t = T[a]; if (t.n === 0) continue; let w = 0;
    for (let k = 0; k < t.n; k++) { const i = t.live[k]; if (t.killed[i]) { vgGridUnlink(t, i); t.cell[i] = -1; t.free.push(i); } else t.live[w++] = i; }
    t.n = w; }
  VG.killList.length = 0;
}
