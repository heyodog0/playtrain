// 40_pmove.js - one engine frame of player movement and view.
//
// A Quake-3-style walk, written from the published behaviour of Quake 3
// movement (friction, accelerate toward the wish direction, slide move, snap)
// - not from any GPL source - with constants fitted to DMLab's own
// trajectories (10_constants.js; tools/pmove_fit.py is the double-precision
// prototype). Float32 throughout, Math.fround after every float op, so V8 and
// QuickJS agree bit for bit; Math.cos/sin are the engines' shared ieee754.
//
// World frame is DMLab's: x east, y north, z up, units of 1/100 cell. The walk
// is 2D: tier-1 levels before skymaze have one floor height.

// --- view ---------------------------------------------------------------
// yaw = spawnYaw - U * (SHORT(acc) - n0), SHORT(a) = floor((a + c) / U), c the
// quantisation phase (0 in play; the oracle's own in a G3 replay).
function dmYawCount(st) {
  return Math.floor((st.acc + st.phase) / DM_U);
}

function dmYawUpdate(st, lookPx) {
  st.acc = st.acc + lookPx * DM_LOOK;
  st.yaw = st.spawnYaw - DM_U * (dmYawCount(st) - st.n0);
}

// --- trace --------------------------------------------------------------
// A point trace of the player's centre from (ax, ay) to (bx, by) against the
// obstacles of the cells in [r0, r1] x [c0, c1]. Returns the fraction of the
// move that is free, with the end kept DM_EPS outside the plane it hits, and
// that plane's normal in _trN; fraction 1 and no normal when clear.
let _trNx = 0, _trNy = 0, _trHit = false;

function dmTrace(st, ax, ay, bx, by, r0, r1, c0, c1) {
  const m = st.maze, obs = st.obstacles;
  let best = 1;
  _trHit = false;
  if (m.flat) {
    // Box levels: one flat list, a few dozen boxes, walked whole.
    best = _dmTraceList(m.flatObstacles, ax, ay, bx, by, best);
    return best;
  }
  for (let r = r0; r <= r1; r++) {
    if (r < 0 || r >= m.h) continue;
    for (let c = c0; c <= c1; c++) {
      if (c < 0 || c >= m.w) continue;
      const list = obs[r * m.w + c];
      if (list === null) continue;
      for (let q = 0; q < list.length; q++) {
      const p = list[q];
      let enter = -1, leave = 1, hx = 0, hy = 0, have = false, startOut = false, miss = false;
      for (let i = 0; i < p.length; i += 3) {
        const nx = p[i], ny = p[i + 1], d = p[i + 2];
        const d1 = F(F(F(nx * ax) + F(ny * ay)) - d);
        const d2 = F(F(F(nx * bx) + F(ny * by)) - d);
        if (d1 > 0) startOut = true;
        if (d1 > 0 && (d2 >= DM_EPS || d2 >= d1)) { miss = true; break; }
        if (d1 <= 0 && d2 <= 0) continue;
        if (d1 > d2) {
          let f = F(F(d1 - DM_EPS) / F(d1 - d2));
          if (f < 0) f = 0;
          if (f > enter) { enter = f; hx = nx; hy = ny; have = true; }
        } else {
          const f = F(F(d1 + DM_EPS) / F(d1 - d2));
          if (f < leave) leave = f;
        }
      }
      if (miss || !have || enter > 1 || !startOut || !(enter < leave)) continue;
      const f = enter > 0 ? enter : 0;
      if (f < best) { best = f; _trNx = hx; _trNy = hy; _trHit = true; }
      }
    }
  }
  return best;
}

function _dmTraceList(list, ax, ay, bx, by, best) {
  for (let q = 0; q < list.length; q++) {
    const p = list[q];
    let enter = -1, leave = 1, hx = 0, hy = 0, have = false, startOut = false, miss = false;
    for (let i = 0; i < p.length; i += 3) {
      const nx = p[i], ny = p[i + 1], d = p[i + 2];
      const d1 = F(F(F(nx * ax) + F(ny * ay)) - d);
      const d2 = F(F(F(nx * bx) + F(ny * by)) - d);
      if (d1 > 0) startOut = true;
      if (d1 > 0 && (d2 >= DM_EPS || d2 >= d1)) { miss = true; break; }
      if (d1 <= 0 && d2 <= 0) continue;
      if (d1 > d2) {
        let f = F(F(d1 - DM_EPS) / F(d1 - d2));
        if (f < 0) f = 0;
        if (f > enter) { enter = f; hx = nx; hy = ny; have = true; }
      } else {
        const f = F(F(d1 + DM_EPS) / F(d1 - d2));
        if (f < leave) leave = f;
      }
    }
    if (miss || !have || enter > 1 || !startOut || !(enter < leave)) continue;
    const f = enter > 0 ? enter : 0;
    if (f < best) { best = f; _trNx = hx; _trNy = hy; _trHit = true; }
  }
  return best;
}

function _clip(vx, vy, nx, ny) {
  let back = F(F(vx * nx) + F(vy * ny));
  back = back < 0 ? F(back * DM_OVERCLIP) : F(back / DM_OVERCLIP);
  return [F(vx - F(nx * back)), F(vy - F(ny * back))];
}

// Quake's slide move in the plane: up to 4 bumps; the velocity is clipped
// against every plane touched this move; two planes that both block make a
// crease, which for two vertical planes is vertical, so the walk stops.
const _planes = new Float32Array(10);

function dmSlide(st, dt) {
  const m = st.maze;
  let x = st.x, y = st.y, vx = st.vx, vy = st.vy;
  const ex0 = F(x + F(vx * dt)), ey0 = F(y + F(vy * dt));
  // +-2 cells: an open door's panel reaches a cell beyond its own.
  const c0 = Math.floor((Math.min(x, ex0) - DM_HALF) / DM_CELL) - 2;
  const c1 = Math.floor((Math.max(x, ex0) + DM_HALF) / DM_CELL) + 1;
  const r0 = m.h - 1 - Math.floor((Math.max(y, ey0) + DM_HALF) / DM_CELL) - 1;
  const r1 = m.h - 1 - Math.floor((Math.min(y, ey0) - DM_HALF) / DM_CELL) + 2;
  let np = 0;
  let t = dt;
  for (let bump = 0; bump < 4; bump++) {
    const ex = F(x + F(vx * t)), ey = F(y + F(vy * t));
    const f = dmTrace(st, x, y, ex, ey, r0, r1, c0, c1);
    if (f > 0) { x = F(x + F(F(ex - x) * f)); y = F(y + F(F(ey - y) * f)); }
    if (!_trHit) break;
    t = F(t - F(t * f));
    if (np >= 5) { vx = 0; vy = 0; break; }
    const nx = _trNx, ny = _trNy;
    let same = false;
    for (let i = 0; i < np; i++) {
      if (F(F(nx * _planes[2 * i]) + F(ny * _planes[2 * i + 1])) > 0.99) { same = true; break; }
    }
    if (same) { vx = F(vx + nx); vy = F(vy + ny); continue; }
    _planes[2 * np] = nx; _planes[2 * np + 1] = ny; np++;
    for (let i = 0; i < np; i++) {
      const pix = _planes[2 * i], piy = _planes[2 * i + 1];
      if (F(F(vx * pix) + F(vy * piy)) >= 0.1) continue;
      let [cx, cy] = _clip(vx, vy, pix, piy);
      let stuck = false;
      for (let j = 0; j < np; j++) {
        if (j === i) continue;
        const pjx = _planes[2 * j], pjy = _planes[2 * j + 1];
        if (F(F(cx * pjx) + F(cy * pjy)) >= 0.1) continue;
        [cx, cy] = _clip(cx, cy, pjx, pjy);
        if (F(F(cx * pix) + F(cy * piy)) >= 0) continue;
        stuck = true;
        break;
      }
      if (stuck) { vx = 0; vy = 0; } else { vx = cx; vy = cy; }
      break;
    }
  }
  st.x = x; st.y = y; st.vx = vx; st.vy = vy;
}

// Integer snap, round half away from zero (fits the oracle's frame 0).
function _snap(v) {
  const f = Math.floor(v), d = v - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;   // ties to even
}

// One engine frame: view, then the walk.
function dmPmove(st, act, msec) {
  dmYawUpdate(st, act[0]);
  dmWalk(st, act, msec);
}

// Quake chops a long command into pieces of at most 66 ms.
function dmWalkChopped(st, act, msec) {
  let left = msec;
  while (left > 0) {
    const m = left < 66 ? left : 66;
    dmWalk(st, act, m);
    left -= m;
  }
}

// Friction, accelerate, slide, snap, for one command of `msec` ms.
function dmWalk(st, act, msec) {
  let landVz = 0;
  if (DM_LEVEL.kind === 'sky') {
    // Grounded is decided where the command starts: off the platform's edge
    // the walk turns into a fall (oracle: the last ground frame already ends
    // with the box past the edge).
    const sup = dmSkySupport(st);
    st.groundZ = sup >= 0 ? F(sup + 24.125) : -1e9;
    if (!st.air && st.z > st.groundZ + 0.25) { st.air = true; st.vz = 0; }
    // A fall that ended within 0.25 of the ground, without touching it,
    // lands with its vertical speed: the walk keeps it (below).
    else if (!st.air && st.vz !== 0) { landVz = st.vz; st.vz = 0; }
    if (st.z - 24.125 !== st.obsFeet) dmSkyObstacles(st);
  }
  const dt = F(msec * F(0.001));
  const a = F(F(st.yaw) * F(Math.PI / 180));
  const cs = F(Math.cos(a)), sn = F(Math.sin(a));
  // forward (cos, sin), right (sin, -cos): yaw is counter-clockwise from +x.
  const move = act[3], strafe = act[2];
  const wx = F(F(cs * move) + F(sn * strafe));
  const wy = F(F(sn * move) - F(cs * strafe));
  const wl = F(Math.sqrt(F(F(wx * wx) + F(wy * wy))));
  let vx = st.vx, vy = st.vy;
  const sp = F(Math.sqrt(F(F(vx * vx) + F(vy * vy))));
  if (st.air) {
    // no friction in the air
  } else if (sp < 1) {
    vx = 0; vy = 0;
  } else {
    const control = sp < DM_STOP ? DM_STOP : sp;
    let ns = F(sp - F(F(control * DM_FRICTION) * dt));
    if (ns < 0) ns = 0;
    ns = F(ns / sp);
    vx = F(vx * ns); vy = F(vy * ns);
    landVz = F(landVz * ns);   // friction scales the whole vector
  }
  if (wl > 0) {
    const dx = F(wx / wl), dy = F(wy / wl);
    const cur = F(F(vx * dx) + F(vy * dy));
    const add = F(DM_SPEED - cur);
    if (add > 0) {
      let acc = F(F((st.air ? DM_AIR_ACCEL : DM_ACCEL) * dt) * DM_SPEED);
      if (acc > add) acc = add;
      vx = F(vx + F(acc * dx)); vy = F(vy + F(acc * dy));
    }
  }
  // A hard landing (falling faster than 200 u/s) holds the walk velocity for
  // 250 ms: walls still stop the box but no longer clip the velocity
  // (oracle: skymaze, against a void column right after a drop).
  if (landVz !== 0) {
    // The ground clip (overclip 1.001) leaves a small upward speed, and the
    // walk keeps the length the velocity had with the fall in it.
    const len = F(Math.sqrt(F(F(F(vx * vx) + F(vy * vy)) + F(landVz * landVz))));
    const uz = F(landVz - F(landVz * DM_OVERCLIP));
    const k = F(len / F(Math.sqrt(F(F(F(vx * vx) + F(vy * vy)) + F(uz * uz)))));
    vx = F(vx * k); vy = F(vy * k);
    st.z = F(st.z + F(F(uz * k) * dt));
  }
  if (st.landT > 0) st.landT = st.landT > msec ? st.landT - msec : 0;
  st.vx = vx; st.vy = vy;
  if (st.air && DM_LEVEL.kind === 'sky') {
    dmSkyAir(st, dt);
    st.vx = _snap(st.vx); st.vy = _snap(st.vy); st.vz = _snap(st.vz);
    return;
  }
  dmSlide(st, dt);
  if (st.landT > 0) { st.vx = vx; st.vy = vy; }
  if (st.air) {
    const vz0 = st.vz;
    const vz1 = F(st.vz - F(DM_GRAVITY * dt));
    st.z = F(st.z + F(F(F(st.vz + vz1) * F(0.5)) * dt));
    st.vz = vz1;
    if (st.z <= st.groundZ) {
      st.z = st.groundZ; st.vz = 0; st.air = false;
      if (vz0 < -200) st.landT = 250;
    }
    st.vz = _snap(st.vz);
  }
  st.vx = _snap(st.vx); st.vy = _snap(st.vy);
}

// --- skymaze: the fall in 3D ---------------------------------------------
// Every cell is a column: a platform up to its top, a void cell all the way
// up (invisible). The player is a box +-15 across, -24..+32 about its origin.
// An air move is Quake's step-slide (from its published behaviour): a slide
// with gravity; if anything was touched, the same move again from 18 units
// higher, then pushed down by those 18 onto whatever is below.
const DM_SKY_TOP = F(1e9);
let _s3f = 1, _s3x = 0, _s3y = 0, _s3z = 0, _s3all = false;

function _skyTrace(st, ax, ay, az, bx, by, bz) {
  const m = st.maze, W = m.w, H = m.h, h = DM_PLAYER_HALF;
  const c0 = Math.floor((Math.min(ax, bx) - h) / DM_CELL) - 1, c1 = Math.floor((Math.max(ax, bx) + h) / DM_CELL) + 1;
  const r0 = H - 1 - Math.floor((Math.max(ay, by) + h) / DM_CELL) - 1, r1 = H - 1 - Math.floor((Math.min(ay, by) - h) / DM_CELL) + 1;
  let best = 1;
  _s3f = 1; _s3all = false;
  for (let r = r0 < 0 ? 0 : r0; r <= r1 && r < H; r++) {
    for (let c = c0 < 0 ? 0 : c0; c <= c1 && c < W; c++) {
      const t = m.tops[r * W + c];
      const x0 = c * DM_CELL, y0 = (H - 1 - r) * DM_CELL;
      // planes in a brush's axial order: -x, +x, -y, +y, +z
      _skyP[0] = F(-(x0 - h)); _skyP[1] = F(x0 + DM_CELL + h);
      _skyP[2] = F(-(y0 - h)); _skyP[3] = F(y0 + DM_CELL + h);
      _skyP[4] = t >= 0 ? F(t + 24) : DM_SKY_TOP;
      let enter = -1, leave = 1, hn = -1, startOut = false, getOut = false, miss = false;
      for (let i = 0; i < 5; i++) {
        const k = i >> 1, sg = _skyS[i];
        const pa = k === 0 ? ax : (k === 1 ? ay : az), pb = k === 0 ? bx : (k === 1 ? by : bz);
        const d1 = F(F(sg * pa) - _skyP[i]), d2 = F(F(sg * pb) - _skyP[i]);
        if (d2 > 0) getOut = true;
        if (d1 > 0) startOut = true;
        if (d1 > 0 && (d2 >= DM_EPS || d2 >= d1)) { miss = true; break; }
        if (d1 <= 0 && d2 <= 0) continue;
        if (d1 > d2) {
          let f = F(F(d1 - DM_EPS) / F(d1 - d2));
          if (f < 0) f = 0;
          if (f > enter) { enter = f; hn = i; }
        } else {
          let f = F(F(d1 + DM_EPS) / F(d1 - d2));
          if (f > 1) f = 1;
          if (f < leave) leave = f;
        }
      }
      if (miss) continue;
      if (!startOut) { if (!getOut) { _s3all = true; best = 0; } continue; }
      if (enter < leave && enter > -1 && enter < best) {
        best = enter < 0 ? 0 : enter;
        const k = hn >> 1, sg = _skyS[hn];
        _s3x = k === 0 ? sg : 0; _s3y = k === 1 ? sg : 0; _s3z = k === 2 ? sg : 0;
      }
    }
  }
  _s3f = best;
  return best;
}
const _skyP = new Float32Array(5);
const _skyS = [-1, 1, -1, 1, 1];
const _skyPl = new Float32Array(15);

function _clip3(v, n) {
  let back = F(F(F(v[0] * n[0]) + F(v[1] * n[1])) + F(v[2] * n[2]));
  back = back < 0 ? F(back * DM_OVERCLIP) : F(back / DM_OVERCLIP);
  return [F(v[0] - F(n[0] * back)), F(v[1] - F(n[1] * back)), F(v[2] - F(n[2] * back))];
}
function _dot3(a, b) { return F(F(F(a[0] * b[0]) + F(a[1] * b[1])) + F(a[2] * b[2])); }
function _unit3(a) {
  const l = F(Math.sqrt(_dot3(a, a)));
  if (l === 0) return [0, 0, 0];
  const il = F(1 / l);
  return [F(a[0] * il), F(a[1] * il), F(a[2] * il)];
}

// One slide with gravity from the state's position and velocity (vz the
// speed at the command's start). Returns whether anything was touched.
function _skySlide(st, dt) {
  const vz1 = F(st.vz - F(DM_GRAVITY * dt));
  let v = [st.vx, st.vy, F(F(st.vz + vz1) * F(0.5))];
  let e = [st.vx, st.vy, vz1];
  const primal = [st.vx, st.vy, vz1];
  let x = st.x, y = st.y, z = st.z;
  const pl = [];
  pl.push(_unit3(v));
  let t = dt, bump = 0, dead = false;
  for (; bump < 4; bump++) {
    const ex = F(x + F(v[0] * t)), ey = F(y + F(v[1] * t)), ez = F(z + F(v[2] * t));
    const f = _skyTrace(st, x, y, z, ex, ey, ez);
    if (_s3all) { v[2] = 0; e = null; break; }
    if (f > 0) { x = F(x + F(F(ex - x) * f)); y = F(y + F(F(ey - y) * f)); z = F(z + F(F(ez - z) * f)); }
    if (f === 1) break;
    t = F(t - F(t * f));
    if (pl.length >= 5) { v = [0, 0, 0]; e = null; dead = true; break; }
    const n = [_s3x, _s3y, _s3z];
    let same = false;
    for (let i = 0; i < pl.length; i++) if (_dot3(n, pl[i]) > 0.99) { same = true; break; }
    if (same) { v = [F(v[0] + n[0]), F(v[1] + n[1]), F(v[2] + n[2])]; continue; }
    pl.push(n);
    for (let i = 0; i < pl.length; i++) {
      if (_dot3(v, pl[i]) >= 0.1) continue;
      let cv = _clip3(v, pl[i]), ce = _clip3(e, pl[i]);
      for (let j = 0; j < pl.length && !dead; j++) {
        if (j === i) continue;
        if (_dot3(cv, pl[j]) >= 0.1) continue;
        cv = _clip3(cv, pl[j]); ce = _clip3(ce, pl[j]);
        if (_dot3(cv, pl[i]) >= 0) continue;
        // along the crease of the two planes
        const a = pl[i], b = pl[j];
        const dir = _unit3([F(F(a[1] * b[2]) - F(a[2] * b[1])), F(F(a[2] * b[0]) - F(a[0] * b[2])), F(F(a[0] * b[1]) - F(a[1] * b[0]))]);
        const dv = _dot3(dir, v), de = _dot3(dir, e);
        cv = [F(dir[0] * dv), F(dir[1] * dv), F(dir[2] * dv)];
        ce = [F(dir[0] * de), F(dir[1] * de), F(dir[2] * de)];
        for (let k = 0; k < pl.length; k++) {
          if (k === i || k === j) continue;
          if (_dot3(cv, pl[k]) >= 0.1) continue;
          dead = true;   // a third plane: stop dead
          break;
        }
      }
      if (dead) { v = [0, 0, 0]; e = null; break; }
      v = cv; e = ce;
      break;
    }
    if (dead) break;
  }
  if (e !== null) v = e;
  if (st.landT > 0) v = primal;
  st.x = x; st.y = y; st.z = z; st.vx = v[0]; st.vy = v[1]; st.vz = v[2];
  return bump !== 0 || dead;
}

function dmSkyAir(st, dt) {
  const vz0 = st.vz, sx = st.x, sy = st.y, sz = st.z, svx = st.vx, svy = st.vy;
  if (_skySlide(st, dt)) {
    _skyTrace(st, sx, sy, sz, sx, sy, F(sz + DM_STEP));
    if (!_s3all) {
      const uz = F(sz + F(F(DM_STEP) * _s3f));
      const step = F(uz - sz);
      st.x = sx; st.y = sy; st.z = uz; st.vx = svx; st.vy = svy; st.vz = vz0;
      _skySlide(st, dt);
      const f = _skyTrace(st, st.x, st.y, st.z, st.x, st.y, F(st.z - step));
      if (!_s3all) st.z = F(st.z + F(F(-step) * f));
      if (f < 1) {
        const c = _clip3([st.vx, st.vy, st.vz], [_s3x, _s3y, _s3z]);
        st.vx = c[0]; st.vy = c[1]; st.vz = c[2];
      }
    }
  }
  // ground under the box within 0.25: landed (hard landings hold the walk)
  const sup = dmSkySupport(st);
  st.groundZ = sup >= 0 ? F(sup + 24.125) : -1e9;
  if (st.vz <= 1 && st.z <= F(st.groundZ + F(0.25))) {
    st.air = false;
    if (vz0 < -200) st.landT = 250;
  }
}
