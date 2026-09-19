// VGDL -> JS compiler, option 2: a game-specific tick() over the shared runtime.
//
// Input: a bundle as tools/bundle_vgdl.mjs assembles it (constants + src/*.js). The
// compiler runs that bundle once in a sandbox, lets the runtime resolve the sprite
// types exactly as it does at load, and emits a tick() in which the two table walks
// the interpreter performs every tick, over the type table for updates and over the
// rule table for collisions, are written out as straight-line code with the types,
// effect functions, scores and arguments baked in. Grids, RNG, sprite storage and
// effect bodies stay in the shared runtime. Semantics are the interpreter's; the
// 516 golden trajectories and the two oracle gates are the proof.
//
//   compileVgdl(bundleText) -> string of JS to append to the bundle
import vm from 'node:vm';

const EFFECT_INLINE = {
  killSprite: (a, ai) => `vgKill(${a}, ${ai})`,
  changeScore: () => null,          // score is added by the caller; the effect body is a no-op
  nothing: () => null,
};

function loadRuntime(bundleText) {
  const held = new Set();
  const ctx = { createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, drawTiles() {}, keyIsDown: c => held.has(c), console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(bundleText, ctx, { filename: 'bundle.js' });
  vm.runInContext('vgPrepare()', ctx);
  const get = expr => vm.runInContext(expr, ctx);
  return { get, profile: get('VG_PROFILE') };
}

const ident = s => s.replace(/[^A-Za-z0-9_]/g, '_');
const lit = v => JSON.stringify(v);

// ----------------------------------------------------------------- Colas profile
function emitColas(get) {
  const types = get('VG.types.map(t => ({ key: t.key, idx: t.idx, cls: t.cls, inert: t.inert, isStatic: t.isStatic, upd: t.upd.name, avatar: t.avatar }))');
  const inter = get('VG.spec.interactions.map((e, i) => ({ i, actor: e.actor, actee: e.actee, name: e.name, score: e.score, args: e.args, A: e.A ? e.A.idx : -1, P: e.P ? e.P.idx : -1 }))');
  const terms = get('VG.spec.terminations');
  for (const t of types) if (!t.inert && !t.upd) throw new Error(`compile: updater of ${t.key} has no name`);
  const byKey = {}; for (const t of types) byKey[t.key] = t;
  const tv = t => `t_${ident(t.key)}`;
  const L = [];
  const push = (...a) => L.push(...a);
  push(`// ---- compiled tick: ${types.length} types, ${inter.length} rules (tools/compile_vgdl.mjs, profile colas) ----`);
  push(`VG.installCompiled = function () {   // called by vgPrepare once the type table is resolved`);
  push(`  const T = VG.types;`);
  for (const t of types) push(`  const ${tv(t)} = T[${t.idx}];   // ${t.key} > ${t.cls}${t.inert ? ' (inert: never updated, never leaves the screen)' : ''}`);
  // hoisted rule arguments
  inter.forEach(e => { if (Object.keys(e.args).length) push(`  const ARGS_${e.i} = ${lit(e.args)};`); });
  push(`  const RULES = VG.spec.interactions;`);
  push(`  function tick(keys) {`);
  push(`    VG.time += 1; if (VG.ended) return; VG.keys = keys;`);
  // just_pushed reset + n0 snapshots
  push(`    // update phase: snapshot counts first (sprites created mid-phase are not updated this tick)`);
  for (const t of types) if (!t.inert) push(`    if (${tv(t)}.jpDirty) { for (let k = 0; k < ${tv(t)}.n; k++) ${tv(t)}.jpT[${tv(t)}.live[k]] = -1; ${tv(t)}.jpDirty = false; }`);
  for (const t of types) if (!t.inert) push(`    const n0_${ident(t.key)} = ${tv(t)}.n;`);
  for (const t of types) if (!t.inert) push(`    for (let k = 0; k < n0_${ident(t.key)}; k++) ${t.upd}(${tv(t)}, ${tv(t)}.live[k]);   // ${t.key} > ${t.cls}`);
  push(`    VG.ss = {};`);
  const passes = [
    ['stepBack pass 1', inter.filter(e => e.name === 'stepBack')],
    ['bounce pass', inter.filter(e => ['bounceForward', 'reverseDirection', 'turnAround'].includes(e.name))],
    ['stepBack pass 2', inter.filter(e => e.name === 'stepBack')],
    ['non-move effects', inter.filter(e => !['stepBack', 'bounceForward', 'reverseDirection', 'turnAround'].includes(e.name))],
  ];
  for (const [label, rules] of passes) {
    if (!rules.length) continue;
    push(`    // ---- ${label} ----`);
    for (const e of rules) push(...emitColasRule(e, types, byKey, tv).map(l => '    ' + l));
  }
  push(`    VG.ss = null;`);
  push(`    vgFlush();`);
  push(`    // terminations, in spec order`);
  push(...emitColasTerms(terms, byKey, tv).map(l => '    ' + l));
  push(`  }`);
  push(`  VG.tickImpl = tick;`);
  push(`};`);
  return L.join('\n') + '\n';
}

function emitColasRule(e, types, byKey, tv) {
  const src = `${e.actor} ${e.actee} > ${e.name}${Object.keys(e.args).map(k => ` ${k}=${JSON.stringify(e.args[k]).replace(/"/g, '')}`).join('')}${e.score ? ` scoreChange=${e.score}` : ''}`;
  const A = e.A >= 0 ? types[e.A] : null, P = e.actee === 'EOS' ? null : (e.P >= 0 ? types[e.P] : null);
  const argsRef = Object.keys(e.args).length ? `ARGS_${e.i}` : 'undefined';
  const score = e.score ? `VG.score += ${e.score}; ` : '';
  const inl = EFFECT_INLINE[e.name];
  const call = (a, ai, p, pi) => { if (inl) { const c = inl(a, ai, p, pi); return c ? c + ';' : ''; } return `VG_EFFECTS.${e.name}(${a}, ${ai}, ${p}, ${pi}, ${argsRef});`; };
  const out = [`// ${src}`];
  if (!A || (e.actee !== 'EOS' && !P)) {   // abstract group somewhere: keep the interpreter's path for this rule
    out.push(`vgApplyEffect(RULES[${e.i}]);`);
    return out;
  }
  if (e.actee === 'EOS') {
    if (A.inert) { out.push(`// (static type: never leaves the screen)`); return out; }
    out.push(`for (let k = ${tv(A)}.n - 1; k >= 0; k--) { const i = ${tv(A)}.live[k]; if (vgContains(${tv(A)}, i)) continue; ${score}${call(tv(A), 'i', 'null', '-1')} if (!vgContains(${tv(A)}, i)) vgKill(${tv(A)}, i); }`);
    return out;
  }
  const a = tv(A), p = tv(P);
  if (A === P) {
    out.push(`if (${a}.n > 1) for (let k = 0; k < ${a}.n; k++) { const i = ${a}.live[k]; vgCollectType(${a}, i, ${a}); const nc = vgCand.length;`);
    out.push(`  for (let q = 0; q < nc; q++) { const j = vgCand[q]; if (j === i) continue; if (!${a}.killed[i]) { ${score}${call(a, 'i', a, 'j')} } } }`);
    return out;
  }
  // actor and partner are distinct types: outer = the smaller group (py-vgdl's swap), actor role unchanged
  out.push(`if (${a}.n !== 0 && ${p}.n !== 0) {`);
  out.push(`  if (${a}.n <= ${p}.n) { for (let k = 0; k < ${a}.n; k++) { const i = ${a}.live[k]; vgCollectType(${a}, i, ${p}); const nc = vgCand.length;`);
  out.push(`    for (let q = 0; q < nc; q++) { const j = vgCand[q]; if (!${a}.killed[i]) { ${score}${call(a, 'i', p, 'j')} } } } }`);
  out.push(`  else { for (let k = 0; k < ${p}.n; k++) { const i = ${p}.live[k]; vgCollectType(${p}, i, ${a}); const nc = vgCand.length;`);
  out.push(`    for (let q = 0; q < nc; q++) { const j = vgCand[q]; if (!${a}.killed[j]) { ${score}${call(a, 'j', p, 'i')} } } } }`);
  out.push(`}`);
  return out;
}

function emitColasTerms(terms, byKey, tv) {
  const out = [];
  const count = st => byKey[st] ? `${tv(byKey[st])}.n` : `vgNumSprites(${lit(st)})`;
  out.push(`VG.ended = false; VG.won = false;`);
  terms.forEach((tm, q) => {
    const A = tm.args, bonus = A.scoreChange ? ` VG.score += ${A.scoreChange};` : '';
    const winLit = tm.type === 'MultiSpriteCounter' ? (A.win == null ? 'true' : String(!!A.win)) : String(!!A.win);
    let cond;
    if (tm.type === 'Timeout') cond = `VG.time >= ${A.limit || 0}`;
    else if (tm.type === 'SpriteCounter') cond = `${count(A.stype)} <= ${A.limit || 0}`;
    else if (tm.type === 'MultiSpriteCounter') cond = `(${Object.keys(A).filter(k => k.startsWith('stype')).map(k => count(A[k])).join(' + ')}) === ${A.limit || 0}`;
    else return;
    const srcArgs = Object.keys(A).map(k => `${k}=${A[k]}`).join(' ');
    out.push(`${q ? 'else ' : ''}if (${cond}) { VG.ended = true; VG.won = ${winLit};${bonus} }   // ${tm.type} ${srcArgs}`);
  });
  return out;
}

// ----------------------------------------------------------------- RC_RL profile
function emitRcrl(get) {
  const types = get('VG.types.map(t => ({ key: t.key, idx: t.idx, cls: t.cls, inert: t.inert, upd: t.upd.name, isAvatar: t.idx === VG.avatarT }))');
  const rules = get('VG.rcEffects.map((e, k) => ({ k, actor: e.actor, actee: e.actee, name: e.name, score: e.score || 0, args: e.args, i: VG.spec.interactions.indexOf(e) }))');
  const terms = get('VG.rcTerms.map(t => ({ type: t.type, args: t.args }))');
  for (const t of types) if (!t.inert && !t.upd) throw new Error(`compile: updater of ${t.key} has no name`);
  const byKey = {}; for (const t of types) byKey[t.key] = t;
  const tv = t => `t_${ident(t.key)}`;
  const L = []; const push = (...a) => L.push(...a);
  push(`// ---- compiled tick: ${types.length} types, ${rules.length} rules (tools/compile_vgdl.mjs, profile rcrl) ----`);
  push(`VG.installCompiled = function () {   // called by vgPrepare once the type table is resolved`);
  push(`  const T = VG.types;`);
  for (const t of types) push(`  const ${tv(t)} = T[${t.idx}];   // ${t.key} > ${t.cls}${t.inert ? ' (inert)' : ''}`);
  push(`  const EFF = VG.rcEffects;`);
  const stypes = [...new Set(rules.flatMap(r => r.actee === 'EOS' ? [r.actor] : [r.actor, r.actee]))];
  const gv = st => `g_${ident(st)}`;
  push(`  function events() {`);
  push(`    const cache = {};`);
  push(`    const dead = new Set();`);
  push(`    for (let k = 0; k < VG.killList.length; k += 2) dead.add(rcSpriteKey(VG.types[VG.killList[k]], VG.killList[k + 1]));`);
  push(`    const collisionSet = new Set(), force = [];`);
  push(`    let again = true;`);
  push(`    while (again) {`);
  push(`      const nc = new Set();`);
  push(`      let ${stypes.map(st => `${gv(st)} = null`).join(', ')};   // group snapshots, one lookup per stype per pass`);
  for (const r of rules) {
    const src = `${r.actor} ${r.actee} > ${r.name}${Object.keys(r.args).map(k => ` ${k}=${r.args[k]}`).join('')}`;
    push(`      // ${src}`);
    push(`      { const e1 = ${gv(r.actor)} || (${gv(r.actor)} = rcGroupEntry(${lit(r.actor)}, cache)), l1 = e1.list;`);
    if (r.actee === 'EOS') {
      push(`        for (let u = 0; u < l1.length; u += 2) { const s = l1[u], si = l1[u + 1]; if (!vgContains(s, si)) EFF[${r.k}].fn(s, si, null, -1, EFF[${r.k}].args); } }`);
      continue;
    }
    push(`        const e2 = ${gv(r.actee)} || (${gv(r.actee)} = rcGroupEntry(${lit(r.actee)}, cache));`);
    push(`        if (l1.length !== 0 && e2.list.length !== 0) {`);
    const noMove = ['nothing', 'killSprite', 'changeScore', 'transformTo', 'killIfOtherHasMore', 'killIfHasMore', 'killIfHasLess', 'killIfOtherHasLess', 'killIfAlive', 'changeResource', 'collectResource', 'killIfFromAbove'].includes(r.name);
    if (noMove) push(`          if (l1.length > 4 * e2.list.length) rcRuleSmallSide(EFF[${r.k}], ${r.score}, e1, e2, dead, collisionSet, nc, force, cache); else`);
    push(`          for (let u = 0; u < l1.length; u += 2) { const s1 = l1[u], i1 = l1[u + 1]; rcCollect(s1, i1, e2); if (rcCand.length === 0) continue; const cand = rcCand.slice();`);
    push(`            for (let v = 0; v < cand.length; v += 2) rcApplyPair(EFF[${r.k}], EFF[${r.k}].fn, ${r.score}, s1, i1, cand[v], cand[v + 1], dead, collisionSet, nc, force, cache); }`);
    push(`        }`);
    if (r.name === 'bounceForward' || r.name === 'turnAround') push(`        ${stypes.map(st => `${gv(st)} = null`).join('; ')};   // _updateCollisionDict may have invalidated snapshots`);
    push(`      }`);
  }
  push(`      for (const pk of nc) collisionSet.add(pk);`);
  push(`      again = nc.size > 0;`);
  push(`    }`);
  push(`  }`);
  push(`  function tick(keys) {`);
  push(`    if (VG.ended) { VG.time += 1; return; }`);
  push(`    const noop = keys !== null && keys.length === 0;`);
  push(`    VG.keys = keys || [];`);
  for (const t of types) {
    if (t.inert) continue;
    const loop = `for (let k = 0; k < ${tv(t)}.n; k++) { const i = ${tv(t)}.live[k]; if (!${tv(t)}.killed[i]) ${t.upd}(${tv(t)}, i); }`;
    push(t.isAvatar ? `    if (!noop) ${loop}   // ${t.key} (skipped on NOOP)` : `    ${loop}   // ${t.key} > ${t.cls}`);
  }
  push(`    events();`);
  push(`    rcFlush();`);
  push(`    VG.time += 1;`);
  push(`    // terminations in _isDone order`);
  push(`    VG.ended = false; VG.won = false;`);
  terms.forEach(tm => {
    const A = tm.args, b = A.bonus ? ` if (VG.time > VG.spriteBonusT) { VG.score += ${A.bonus}; VG.spriteBonusT = VG.time; }` : '';
    const count = st => byKey[st] ? `rcLiveCount(${tv(byKey[st])})` : `rcNumSprites(${lit(st)})`;
    const srcArgs = Object.keys(A).map(k => `${k}=${A[k]}`).join(' ');
    if (tm.type === 'Timeout') {
      push(`    if (VG.time >= ${A.limit || 0}) { VG.ended = true; VG.won = ${String(!!A.win)}; return; }   // Timeout ${srcArgs}`);
      push(`    if (VG.time > VG.timeoutBonusT) { VG.score += ${A.bonus || 0}; VG.timeoutBonusT = VG.time; }`);
    } else if (tm.type === 'SpriteCounter') {
      push(`    if (${count(A.stype)} <= ${A.limit || 0}) {${b} VG.ended = true; VG.won = ${A.win == null ? 'true' : String(!!A.win)}; return; }   // SpriteCounter ${srcArgs}`);
    } else if (tm.type === 'MultiSpriteCounter') {
      push(`    if ((${Object.keys(A).filter(k => k.startsWith('stype')).map(k => count(A[k])).join(' + ')}) === ${A.limit || 0}) {${b} VG.ended = true; VG.won = ${A.win == null ? 'true' : String(!!A.win)}; return; }   // MultiSpriteCounter ${srcArgs}`);
    }
  });
  push(`  }`);
  push(`  VG.tickImpl = tick;`);
  push(`};`);
  return L.join('\n') + '\n';
}

export function compileVgdl(bundleText) {
  const rt = loadRuntime(bundleText);
  return rt.profile === 'rcrl' ? emitRcrl(rt.get) : emitColas(rt.get);
}
