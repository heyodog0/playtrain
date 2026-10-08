// 50_tasks/psychlab.js - the psychlab room (PLAN.md section 11, T7).
//
// The player stands at one point and only looks: the factory zeroes the walk.
// Yaw and pitch are Quake view accumulators like the maze levels' yaw
// (40_pmove.js): 20 px a look action, LOOK degrees a pixel, kept in 1/65536
// turns, each with its own quantisation phase. Pitch starts level; look down
// raises it (Quake's sign).
//
// The gaze is where the view meets the screen (dmGaze), in screen units: x
// from its left edge, y down from its top, 0..1 across. A frame's task step
// sees the view as the frame began (DMLab's lookat runs before the look).

function dmPitchCount(st) {
  return Math.floor((st.pacc + st.pphase) / DM_U);
}

function dmPsychLoad(st, seed) {
  const n = DM_LEVEL.seeds.length;
  st.seedIdx = ((seed >>> 0) % n);
  st.maze = null;
  const s = DM_LEVEL.seeds[st.seedIdx];
  const e = DM_LEVEL.eye;
  st.x = F(e[0]); st.y = F(e[1]); st.z = F(e[2]); st.vx = 0; st.vy = 0; st.vz = 0;
  st.acc = 0; st.phase = 0;
  st.spawnYaw = DM_U * Math.round(s.spawn_yaw / DM_U);
  st.n0 = dmYawCount(st);
  st.yaw = s.spawn_yaw;
  st.pacc = 0; st.pphase = 0; st.pn0 = 0; st.pitch = 0;
  pcgSeed(st.pcg, seed >>> 0);
  st.frame = 0; st.spawnFrame = 0; st.score = 0;
  st.pendingAt = -1; st.pendingReward = 0; st.restartAt = -1;
  st.holdLeft = -1; st.queue.length = 0;
  st.items = []; st.alive = new Uint8Array(0);
  // the screen texture before the level first draws it (80_render.js dmPsychQuads)
  st.screen = [[0, 0, 1, 1, 0, 0, 0]];
  st.replayMsec = null; st.replayRespawns = null; st.replayTrials = null;
  dmPsyReset(st);
  dmGaze(st, st.pitch, st.yaw);
}

// Where the view (pitch, yaw) meets the screen: st.gaze = [on screen, x, y],
// DMLab's lookat (DM_LEVEL.lookat, tools/compile_psychlab.py): a trace from
// the muzzle point, eye + muzzle * forward truncated to whole units, to the
// plane just short of the screen, normalised over the trigger's bounds.
function dmGaze(st, pitch, yaw) {
  const L = DM_LEVEL.lookat;
  const p = F(F(pitch) * F(Math.PI / 180)), y = F(F(yaw) * F(Math.PI / 180));
  const cp = F(Math.cos(p));
  const dx = F(cp * F(Math.cos(y))), dy = F(cp * F(Math.sin(y))), dz = F(-Math.sin(p));
  if (!(dy > 0)) { st.gaze[0] = 0; return; }
  const ox = Math.trunc(F(L.eye[0] + F(L.muzzle * dx)));
  const oy = Math.trunc(F(L.eye[1] + F(L.muzzle * dy)));
  const oz = Math.trunc(F(L.eye[2] + F(L.muzzle * dz)));
  const t = F(F(L.y - oy) / dy);
  const gx = F(F(F(ox + F(t * dx)) - L.x0) / F(L.x1 - L.x0));
  const gy = F(F(L.z1 - F(oz + F(t * dz))) / F(L.z1 - L.z0));
  st.gaze[0] = gx >= 0 && gx <= 1 && gy >= 0 && gy <= 1 ? 1 : 0;
  st.gaze[1] = gx; st.gaze[2] = gy;
}

// One engine frame: the screen task steps with the gaze of the view as it
// was (the level's lookat comes from the frame before), then the look.
function dmPsychFrame(st, act) {
  // DMLab reports a frame's score change with the next frame (as the maze
  // levels' touches, explore.js)
  const owed = st.psy.reward;
  st.psy.reward = 0;
  dmGaze(st, st.pitch, st.yaw);
  dmPsyStep(st);
  dmPsyScreen(st);
  dmYawUpdate(st, act[0]);
  st.pacc = st.pacc + act[1] * DM_LOOK;
  st.pitch = DM_U * (dmPitchCount(st) - st.pn0);
  return owed;
}

// --- the screen's widgets (psychlab's point_and_click, read as spec) -----
// The screen is PSY_PX square (512 or 256 px), y down. A widget has float bounds (Lua's pos *
// size arithmetic, in doubles), a hover count and optional callbacks: each
// frame the gaze is the mouse (gaze * PSY_PX; off the screen it is -PSY_PX); for every widget with callbacks, inside its bounds
// (inclusive) its hover count goes up and its hover callback is due, outside
// with a count it gets its hover-end callback and the count goes back to 0.
// The due callbacks then run in that order (a widget removed meanwhile is
// skipped). Before that the frame's timers count down and fire: [frames, fn],
// fired on the frame they reach 0.
let PSY_PX = 512;

function dmPsyWidget(st, name, x0, y0, w, h, draw, hover, end) {
  st.psy.widgets = st.psy.widgets.filter((wd) => wd.name !== name);
  st.psy.widgets.push({ name, b: [x0 * PSY_PX, y0 * PSY_PX, (x0 + w) * PSY_PX, (y0 + h) * PSY_PX],
    draw, hover, end, n: 0 });
}

function dmPsyRemove(st, name) {
  st.psy.widgets = st.psy.widgets.filter((wd) => wd.name !== name);
}

function dmPsyGet(st, name) {
  for (const wd of st.psy.widgets) if (wd.name === name) return wd;
  return null;
}

function dmPsyStep(st) {
  const P = st.psy;
  const fire = [];
  for (const t of P.timers) if (--t[0] <= 0) fire.push(t);
  P.timers = P.timers.filter((t) => t[0] > 0);
  for (const t of fire) t[1](st);
  const mx = st.gaze[0] ? st.gaze[1] * PSY_PX : -PSY_PX, my = st.gaze[0] ? st.gaze[2] * PSY_PX : -PSY_PX;
  const due = [];
  for (const wd of P.widgets) {
    if (!wd.hover && !wd.end) continue;
    if (wd.b[0] <= mx && mx <= wd.b[2] && wd.b[1] <= my && my <= wd.b[3]) {
      wd.n++;
      if (wd.hover) due.push([wd, wd.hover, wd.n]);
    } else if (wd.n > 0) {
      if (wd.end) due.push([wd, wd.end, 0]);
      wd.n = 0;
    }
  }
  for (const [wd, f, n] of due) if (P.widgets.indexOf(wd) >= 0) f(st, wd, n);
}

// What the screen shows: the background, then each widget's drawing, as
// rects in screen units (80_render.js dmPsychQuads). Images land on whole
// pixels (the Lua tensor copy truncates the float offset).
function dmPsyScreen(st) {
  const out = [[0, 0, 1, 1, 255, 255, 255]];
  for (const wd of st.psy.widgets) {
    if (!wd.draw) continue;
    const ox = Math.trunc(wd.b[0]), oy = Math.trunc(wd.b[1]);
    for (const [x0, y0, x1, y1, r, g, b] of wd.draw) {
      out.push([(ox + x0) / PSY_PX, (oy + y0) / PSY_PX, (ox + x1) / PSY_PX, (oy + y1) / PSY_PX, r, g, b]);
    }
  }
  st.screen = out;
}

// --- psychlab_visual_search (visual_search_factory.lua, read as spec) ----
// A red fixation cross; one frame of gaze on its centre (the middle 0.05)
// brings the search array (a 7 x 7 grid of 56 px cells in the middle 0.8 of
// the screen, objects drawn as 4 x 4 masks of 14 px) and two black buttons
// at the bottom, 'target absent' left and 'target present' right. While the
// gaze is on a button it turns green (right answer) or red (wrong); when the
// gaze leaves it, the answer counts: +1 if right, 0 if wrong; the array goes,
// and a frame later the cross is back. The target is a magenta T. 80 trials
// end the episode. Play draws trials as the factory does (interleaved shape /
// colour / conjunction search, a staircase over set sizes); a G3 replay takes
// each trial's objects from the oracle's screens (st.replayTrials).
const PSY_SHAPES = [
  [[1, 1, 1, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0]], [[0, 1, 0, 0], [0, 1, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0]],
  [[1, 0, 0, 0], [1, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0]], [[0, 0, 1, 0], [0, 0, 1, 0], [1, 1, 1, 0], [0, 0, 0, 0]],
  [[1, 1, 1, 0], [1, 0, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0]], [[1, 1, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 0, 0]],
  [[0, 1, 1, 0], [0, 1, 0, 0], [1, 1, 0, 0], [0, 0, 0, 0]], [[1, 1, 0, 0], [0, 1, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0]]];
const PSY_COLORS = [[255, 0, 191], [255, 191, 0], [0, 255, 255], [0, 63, 255], [127, 0, 255]];
const PSY_SET_SIZES = [1, 1, 1, 2, 2, 4, 8, 16, 24, 32];
const PSY_BUTTON = 0.1, PSY_CELL = 56, PSY_GRID = Math.floor(512 * (1 - 2 * PSY_BUTTON));
const PSY_TRIAL_CAP = 80;

function dmPsyFixation(st) {
  // the cross image, 0.1 of the screen: at 512 px 51 px with bands 13 px wide
  // from px 19 (helpers.getFixationImage)
  const n = Math.floor(0.1 * PSY_PX), a = Math.floor(0.5 + 0.4 * n) - 1, b = n - a;
  dmPsyWidget(st, 'fixation', 0.5 - 0.05, 0.5 - 0.05, 0.1, 0.1,
    [[0, 0, n, n, 255, 255, 255], [a, 0, b, n, 255, 0, 0], [0, a, n, b, 255, 0, 0]], null, null);
  dmPsyWidget(st, 'center_of_fixation', 0.5 - 0.025, 0.5 - 0.025, 0.05, 0.05, null,
    DM_LEVEL.name === 'psychlab_sequential_comparison' ? dmSeqFixated : dmPsyFixated, null);
}

function dmPsyFixated(st, wd, n) {
  if (n !== 1) return;
  dmPsyRemove(st, 'fixation');
  dmPsyRemove(st, 'center_of_fixation');
  const items = st.replayTrials ? (st.replayTrials[st.psy.trial] || []) : dmPsySearchItems(st);
  st.psy.present = items.some((it) => it[2] === 0 && it[3] === 0);
  // the array: its 409 px image, objects at 8 px in from its edge
  const draw = [[0, 0, PSY_GRID, PSY_GRID, 255, 255, 255]];
  const off = Math.floor((PSY_GRID % PSY_CELL) / 2), q = PSY_CELL / 4;
  for (const [r, c, sh, co] of items) {
    const m = PSY_SHAPES[sh], col = PSY_COLORS[co];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      if (!m[i][j]) continue;
      const x = off + c * PSY_CELL + j * q, y = off + r * PSY_CELL + i * q;
      draw.push([x, y, x + q, y + q, col[0], col[1], col[2]]);
    }
  }
  dmPsyWidget(st, 'image', PSY_BUTTON, PSY_BUTTON, 1 - 2 * PSY_BUTTON, 1 - 2 * PSY_BUTTON, draw, null, null);
  const bx = 0.5 - PSY_BUTTON * 1.5, side = Math.floor(PSY_BUTTON * PSY_PX);
  const black = [[0, 0, side, side, 0, 0, 0]];
  dmPsyWidget(st, 'targetAbsent', bx, 1 - PSY_BUTTON, PSY_BUTTON, PSY_BUTTON, black, dmPsyButtonHover, dmPsyAnswer);
  dmPsyWidget(st, 'targetPresent', 1 - bx - PSY_BUTTON, 1 - PSY_BUTTON, PSY_BUTTON, PSY_BUTTON, black,
    dmPsyButtonHover, dmPsyAnswer);
}

function dmPsyRight(st, wd) {
  return (wd.name === 'targetPresent') === st.psy.present;
}

function dmPsyButtonHover(st, wd) {
  const side = Math.floor(PSY_BUTTON * PSY_PX);
  wd.draw = [[0, 0, side, side].concat(dmPsyRight(st, wd) ? [100, 255, 100] : [255, 100, 100])];
}

function dmPsyAnswer(st, wd) {
  const right = dmPsyRight(st, wd);
  st.psy.reward += right ? 1 : 0;
  dmPsyStaircase(st, right ? 1 : 0);
  dmPsyRemove(st, 'image');
  dmPsyRemove(st, 'targetPresent');
  dmPsyRemove(st, 'targetAbsent');
  st.psy.timers.push([1, dmPsyFixation]);
  st.psy.trial++;
  if (st.psy.trial >= PSY_TRIAL_CAP) st.endAt = st.frame + 1;
}

// The staircase: level K (K trials) promotes after K right in a row, demotes
// when at most K/2 were right; the set size follows the level.
function dmPsyStaircase(st, right) {
  const S = st.psy.stair;
  S.index++;
  if (right !== 1) S.perfect = false;
  S.correct += right;
  if (S.index === S.level) {
    if (S.correct <= Math.floor(S.level / 2)) S.worse = true;
    S.index = 0; S.correct = 0;
    if (S.perfect) {
      S.level++;
      if (st.psy.setSizeId < PSY_SET_SIZES.length - 1) st.psy.setSizeId++;
    } else if (S.worse) {
      if (S.level > 1) S.level--;
      if (st.psy.setSizeId > 0) st.psy.setSizeId--;
    }
    S.perfect = true; S.worse = false;
  }
}

// A play trial: [row, col, shape, colour] per object (0-based; the target is
// shape 0, colour 0), on distinct random cells.
function dmPsySearchItems(st) {
  const ri = (n) => crRi(st.pcg, n);
  const present = ri(2) === 0;
  const mode = ri(3);   // shape, colour, conjunction
  const distractor = () => {
    if (mode === 1) return [0, 1 + ri(PSY_COLORS.length - 1)];
    if (mode === 0) return [1 + ri(PSY_SHAPES.length - 1), 0];
    const k = 1 + ri(PSY_SHAPES.length * PSY_COLORS.length - 1);
    return [k % PSY_SHAPES.length, Math.floor(k / PSY_SHAPES.length)];
  };
  const size = PSY_SET_SIZES[st.psy.setSizeId];
  const per = Math.floor(PSY_GRID / PSY_CELL);
  const cells = _dmShuffle(st, Array.from({ length: per * per }, (_, i) => i)).slice(0, size);
  return cells.map((cell, i) => {
    const [sh, co] = i === 0 && present ? [0, 0] : distractor();
    return [Math.floor(cell / per), cell % per, sh, co];
  });
}

function dmPsyReset(st) {
  PSY_PX = DM_LEVEL.screen_px;
  st.psy = { widgets: [], timers: [], trial: 0, reward: 0, present: false, setSizeId: 0, setSize: 1,
    stair: { level: 1, index: 0, correct: 0, perfect: true, worse: false },
    deliver: 0, correct: 0, isNew: false, cur: null };
  dmPsyFixation(st);
  st.endAt = -1;
}

// --- psychlab_sequential_comparison (sequential_comparison_factory.lua, read as spec)
// Self-paced change detection on a 256 px screen. One frame of gaze on the
// cross's centre shows the study array (0.75 of the screen, centred: a 64 x 64
// grid of 8-unit cells, 3 px a unit, objects E or square in 7 colours) and a
// small turquoise 'end study' button at one of 4 spots; looking at the button
// fills it, looking away starts a delay of 8..256 frames with a blank screen;
// then the test array (the study array, or with one object changed) and the
// 'new' (left edge) and 'old' (right edge) buttons. A button turns green or
// red while looked at; looking away answers (+1 right, 0 wrong); a frame later
// the cross is back. 60 trials end the episode. A G3 replay takes each trial's
// button spot, arrays and delay from the oracle (st.replayTrials, decoded by
// tools/compile_psychlab.py); play draws them as the factory does.
const SEQ_COLORS = [[255, 0, 0], [255, 191, 0], [127, 255, 0], [0, 255, 255], [0, 63, 255], [127, 0, 255], [255, 0, 191]];
const SEQ_DELAYS = [8, 16, 32, 64, 128, 256];
const SEQ_TARGET = 0.75, SEQ_GRID = 64, SEQ_STEP = 8, SEQ_END = 0.09375, SEQ_CAP = 60;
const SEQ_TURQUOISE = [59, 165, 170];
const SEQ_DOMAINS = ['E_ALL', 'E_COLOR', 'E_ORIENTATION', 'SQUARE_COLOR', 'ALL'];

// One object, [x, y, colour, optotype (0 E, 1 square), orientation (0 left,
// 1 right, 2 up, 3 down)], as rects in the array image's px. The Lua fills
// with 1-based narrow(), so every rect starts a pixel up and left.
function dmSeqObject(o) {
  const f = (PSY_PX * SEQ_TARGET) / SEQ_GRID;
  const L = Math.trunc(o[0] * f), R = Math.trunc((o[0] + SEQ_STEP) * f);
  const T = Math.trunc(o[1] * f), B = Math.trunc((o[1] + SEQ_STEP) * f);
  const col = SEQ_COLORS[o[2]], out = [];
  const fill = (r0, nr, c0, nc, c) => { if (nr > 0 && nc > 0) out.push([c0 - 1, r0 - 1, c0 - 1 + nc, r0 - 1 + nr].concat(c)); };
  fill(T, B - T, L, R - L, col);
  if (o[3] === 1) return out;
  const h = B - T, w = R - L, p = (k, sz, off) => Math.floor(0.5 + k * sz) + off;
  const t2 = p(0.2, h, T), t4 = p(0.4, h, T), t6 = p(0.6, h, T), t8 = p(0.8, h, T);
  const l2 = p(0.2, w, L), l4 = p(0.4, w, L), l6 = p(0.6, w, L), l8 = p(0.8, w, L);
  const W = [255, 255, 255];
  if (o[4] === 1) { fill(t2, t4 - t2, l4, R - l4, W); fill(t6, t8 - t6, l4, R - l4, W); }
  else if (o[4] === 0) { fill(t2, t4 - t2, L, l6 - L, W); fill(t6, t8 - t6, L, l6 - L, W); }
  else if (o[4] === 2) { fill(T, t6 - T, l2, l4 - l2, W); fill(T, t6 - T, l6, l8 - l6, W); }
  else { fill(t4, B - t4, l2, l4 - l2, W); fill(t4, B - t4, l6, l8 - l6, W); }
  return out;
}

function dmSeqArray(st, objs) {
  const n = Math.floor(SEQ_TARGET * PSY_PX);
  let draw = [[0, 0, n, n, 255, 255, 255]];
  for (const o of objs) draw = draw.concat(dmSeqObject(o));
  dmPsyWidget(st, 'target', 0.5 - SEQ_TARGET / 2, 0.5 - SEQ_TARGET / 2, SEQ_TARGET, SEQ_TARGET, draw, null, null);
}

function dmSeqTrial(st) {
  return st.replayTrials ? st.replayTrials[st.psy.trial] || null : null;
}

function dmSeqFixated(st, wd, n) {
  if (n !== 1) return;
  const P = st.psy;
  dmPsyRemove(st, 'fixation');
  dmPsyRemove(st, 'center_of_fixation');
  P.deliver = 0;
  const tr = dmSeqTrial(st);
  // a replayed trial the dump ended in: its delay ran past the dump's end
  P.cur = tr ? { study: tr.study, loc: tr.loc, delay: tr.delay === undefined ? 1e9 : tr.delay, test: tr.test,
    domain: 'ALL' } : dmSeqStudy(st);
  dmSeqArray(st, P.cur.study);
  const side = Math.floor(SEQ_END * PSY_PX), b = Math.round(side / 4);
  dmPsyWidget(st, 'endStudyPhaseButton', P.cur.loc[0], P.cur.loc[1], SEQ_END, SEQ_END,
    [[0, 0, side, side].concat(SEQ_TURQUOISE), [b, b, side - b, side - b, 0, 0, 0]],
    (s2, w2) => { w2.draw = [[0, 0, side, side].concat(SEQ_TURQUOISE)]; s2.psy.deliver = 0; },
    dmSeqDelay);
}

function dmSeqDelay(st) {
  const P = st.psy;
  P.reward += P.deliver;
  const delay = P.cur.delay !== undefined && P.cur.delay !== null ? P.cur.delay : SEQ_DELAYS[crRi(st.pcg, SEQ_DELAYS.length)];
  dmPsyRemove(st, 'endStudyPhaseButton');
  dmPsyRemove(st, 'target');
  P.timers.push([delay, dmSeqTest]);
}

function dmSeqTest(st) {
  const P = st.psy;
  if (!P.cur.test) dmSeqTestArray(st);
  // a replay's arrays are as drawn (a square's orientation reads as 0): changed or not
  P.isNew = P.cur.isNew !== undefined ? P.cur.isNew : JSON.stringify(P.cur.test) !== JSON.stringify(P.cur.study);
  dmSeqArray(st, P.cur.test);
  const side = Math.floor(PSY_BUTTON * PSY_PX), black = [[0, 0, side, side, 0, 0, 0]];
  const hover = (s2, w2) => {
    const right = (w2.name === 'newButton') === s2.psy.isNew;
    w2.draw = [[0, 0, side, side].concat(right ? [100, 255, 100] : [255, 100, 100])];
    s2.psy.correct = right ? 1 : 0;
    s2.psy.deliver = right ? 1 : 0;
  };
  const y = 0.5 - PSY_BUTTON / 2;
  dmPsyWidget(st, 'newButton', 0, y, PSY_BUTTON, PSY_BUTTON, black, hover, dmSeqAnswer);
  dmPsyWidget(st, 'oldButton', 1 - PSY_BUTTON, y, PSY_BUTTON, PSY_BUTTON, black, hover, dmSeqAnswer);
}

function dmSeqAnswer(st) {
  const P = st.psy;
  P.reward += P.deliver;
  // the staircase: as visual_search's, the set size following the level
  const S = P.stair;
  S.index++;
  if (P.correct !== 1) S.perfect = false;
  S.correct += P.correct;
  if (S.index === S.level) {
    if (S.correct <= Math.floor(S.level / 2)) S.worse = true;
    S.index = 0; S.correct = 0;
    if (S.perfect) { S.level++; P.setSize++; }
    else if (S.worse) { if (S.level > 1) S.level--; if (P.setSize > 1) P.setSize--; }
    S.perfect = true; S.worse = false;
  }
  dmPsyRemove(st, 'target');
  dmPsyRemove(st, 'newButton');
  dmPsyRemove(st, 'oldButton');
  P.timers.push([1, dmPsyFixation]);
  P.trial++;
  if (P.trial >= SEQ_CAP) st.endAt = st.frame + 1;
}

// Play: the study array (getStudyArrayData) and its button spot.
function dmSeqCoords(st) {
  const lim = SEQ_GRID - SEQ_STEP, dom = [];
  for (let v = SEQ_STEP / 2; v <= lim; v += SEQ_STEP) dom.push(v);
  const mid = dom.length % 2 ? dom[(dom.length - 1) / 2] : (dom[dom.length / 2 - 1] + dom[dom.length / 2]) / 2;
  const bad = new Set([-2, -1, 1, 2].map((i) => mid + i * SEQ_STEP));
  let x, y;
  do { x = dom[crRi(st.pcg, dom.length)]; y = dom[crRi(st.pcg, dom.length)]; } while (bad.has(x) && bad.has(y));
  return [x, y];
}

function dmSeqStudy(st) {
  const ri = (n) => crRi(st.pcg, n);
  const domain = SEQ_DOMAINS[ri(SEQ_DOMAINS.length)];
  let colors = [0, 1, 2, 3, 4, 5, 6], oris = [0, 1, 2, 3], opts = [0];
  if (domain === 'E_COLOR') oris = [oris[ri(4)]];
  else if (domain === 'E_ORIENTATION') colors = [colors[ri(7)]];
  else if (domain === 'SQUARE_COLOR') opts = [1];
  else if (domain === 'ALL') opts = [0, 1];
  const used = new Set(), study = [];
  for (let i = 0; i < st.psy.setSize; i++) {
    let loc = dmSeqCoords(st);
    const c = colors[ri(colors.length)], o = opts[ri(opts.length)], r = oris[ri(oris.length)];
    while (used.has(loc.join())) loc = dmSeqCoords(st);
    used.add(loc.join());
    study.push([loc[0], loc[1], c, o, r]);   // a square keeps its (unused) orientation
  }
  // the end-study button: 4 spots around the grid centre
  const g = SEQ_GRID - SEQ_STEP, a = g / 2 - 2 * SEQ_STEP, off = 1 - SEQ_TARGET;
  const spots = [[a - SEQ_STEP, a - SEQ_STEP], [a - SEQ_STEP, a + SEQ_STEP], [a + SEQ_STEP, a - SEQ_STEP], [a + SEQ_STEP, a + SEQ_STEP]];
  const s = spots[ri(4)];
  return { study, domain, loc: [off + s[0] / SEQ_GRID, off + s[1] / SEQ_GRID], delay: null, test: null };
}

// Play: the test array (getTestArrayData): half the time one object changes.
function dmSeqTestArray(st) {
  const ri = (n) => crRi(st.pcg, n), P = st.psy;
  const test = P.cur.study.map((o) => o.slice());
  if (ri(2) === 1) {
    const k = ri(test.length), o = test[k], d = P.cur.domain;
    let legal = d === 'E_ALL' ? ['COLOR', 'ORIENTATION'] : d === 'E_COLOR' || d === 'SQUARE_COLOR' ? ['COLOR']
      : d === 'E_ORIENTATION' ? ['ORIENTATION'] : o[3] === 0 ? ['OPTOTYPE', 'COLOR', 'ORIENTATION'] : ['OPTOTYPE', 'COLOR'];
    const tf = legal[ri(legal.length)];
    if (tf === 'COLOR') { let c; do { c = ri(7); } while (c === o[2]); o[2] = c; }
    else if (tf === 'ORIENTATION') { let r; do { r = ri(4); } while (r === o[4]); o[4] = r; }
    else o[3] = 1 - o[3];
    P.cur.isNew = true;
  } else {
    P.cur.isNew = false;
  }
  P.cur.test = test;
}
