// 50_tasks/explore.js - the explore family's task rules (DMLab-30 README and
// the explore factories, read as specification; timing from the oracle).
//
//   goal     explore_goal_locations / explore_obstructed_goals: reach the goal
//            for 10, restart at a spawn point; obstructed levels also re-draw
//            which doors are open at every restart.
//   objects  explore_object_locations: apples worth 1 each, not respawning;
//            when all are taken the map restarts with all of them back.
//   rewards  explore_object_rewards: objects of good (+2) and bad (-1)
//            categories; when every good one is taken the map restarts with
//            a new spawn and a new placement.
//   language (tier 2) language_select_described_object: pick the object the
//            instruction names (+10) or another (-10); any pick restarts the
//            map with a new round: objects, instruction, spawn. Items carry
//            their own reward and colours: [x, y, tile, w, h, reward, rgb1, rgb2].
//
// Timing (fitted, PROGRESS.md U04): a touch is tested on a frame's END
// position; its reward is reported on the NEXT frame; a restart it causes
// places the player on the frame after that. In a G3 replay the restart's
// pose, doors and items are the oracle's; in play they are drawn with the
// episode's PCG following the factories' rules (DMLab uses its own Lua RNG,
// which nothing here reproduces).

// After a restart the server holds the player `hold` frames and then runs
// the queued commands (90_playtrain.js). Play default: no hold, 17 ms.
const DM_RESPAWN_HOLD = 0, DM_RESPAWN_CATCH = 17;

function _dmTouches(st, ix, iy) {
  const dx = st.x - ix, dy = st.y - iy;
  return dx >= DM_TOUCH_X0 && dx <= DM_TOUCH_X1 && dy >= DM_TOUCH_Y0 && dy <= DM_TOUCH_Y1;
}

// Is the episode's task finished, so the map restarts?
function _dmFinished(st) {
  const m = st.maze, kind = DM_LEVEL.kind;
  if (kind === 'language') return st.lend === 1;   // a pick that ends the round (see dmTaskFrame)
  if (kind === 'objects') {
    for (let i = 0; i < st.alive.length; i++) if (st.alive[i]) return false;
    return st.alive.length > 0;
  }
  if (kind === 'rewards') {
    for (let i = 0; i < st.items.length; i++) {
      if (st.alive[i] && m.cats[st.items[i][2]][3] > 0) return false;
    }
    return true;
  }
  return false;
}

// Returns the reward reported this frame.
function dmTaskFrame(st) {
  if (DM_LEVEL.kind === 'water') return dmWaterFrame(st);
  if (st.maze.flat) return dmRoomsFrame(st);
  if (DM_LEVEL.kind === 'keys' || DM_LEVEL.kind === 'sky') return dmKeysFrame(st);
  let reward = 0;
  if (st.pendingAt >= 0 && st.frame === st.pendingAt + 1) {
    reward = st.pendingReward;
    st.pendingReward = 0;
  }
  if (st.restartAt === st.frame) {
    st.restartAt = -1;
    st.pendingAt = -1;
    dmRestart(st);
    return reward;
  }
  if (st.restartAt >= 0) return reward;
  const m = st.maze;
  let touched = 0, got = 0;
  if (m.goal !== null && _dmTouches(st, m.goal[0], m.goal[1])) {
    got += DM_GOAL_REWARD; touched = 1;
    st.restartAt = st.frame + 2;
  }
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i];
    if (it.length > 9 && it[9]) continue;     // language: only to look at
    if (_dmTouches(st, it[0], it[1])) {
      st.alive[i] = 0;
      got += it.length >= 8 ? it[5] : m.cats[it[2]][3];
      touched = 1;
      if (it.length >= 8) {
        // language: a counting round ('Every ...') goes on until its last goal
        // object, which adds the bonus; any other pick ends the round
        if (st.lcount && it[8]) {
          let left = 0;
          for (let j = 0; j < st.items.length; j++) if (st.alive[j] && st.items[j][8]) left++;
          if (left === 0) { got += DM_LEVEL.lang.goal_reward; st.lend = 1; }
        } else {
          st.lend = 1;
        }
      }
    }
  }
  if (touched) {
    st.pendingAt = st.frame;
    st.pendingReward = F(st.pendingReward + got);
    if (st.restartAt < 0 && _dmFinished(st)) st.restartAt = st.frame + 2;
  }
  return reward;
}

// --- restarts -----------------------------------------------------------
function _dmOpenCell(m, r, c) {
  return r >= 0 && c >= 0 && r < m.h && c < m.w && m.rows[r][c] !== '*';
}

// Cells reachable from (r0, c0) through non-wall cells, doors counted open
// (the factories' visitFill), in BFS order.
function _dmReach(m, r0, c0) {
  const seen = new Uint8Array(m.w * m.h), out = [[r0, c0]];
  seen[r0 * m.w + c0] = 1;
  for (let k = 0; k < out.length; k++) {
    const [r, c] = out[k];
    for (const [dr, dc] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) {
      const rr = r + dr, cc = c + dc;
      if (!_dmOpenCell(m, rr, cc) || seen[rr * m.w + cc]) continue;
      seen[rr * m.w + cc] = 1;
      out.push([rr, cc]);
    }
  }
  return out;
}

function _dmShuffle(st, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crRi(st.pcg, i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function _dmCellOf(m, x, y) {
  return [m.h - 1 - Math.floor(y / DM_CELL), Math.floor(x / DM_CELL)];
}

// A random path from the goal to the spawn through open cells (randomised
// depth-first search); the doors on it are opened, then of the doors still
// shut, a (1 - doors_closed) share is opened at random.
function _dmDrawDoors(st, sr, sc) {
  const m = st.maze;
  const [gr, gc] = _dmCellOf(m, m.goal[0], m.goal[1]);
  const from = new Int32Array(m.w * m.h).fill(-1);
  const stack = [[gr, gc]];
  from[gr * m.w + gc] = gr * m.w + gc;
  while (stack.length) {
    const [r, c] = stack.pop();
    if (r === sr && c === sc) break;
    const nb = _dmShuffle(st, [[-1, 0], [0, 1], [1, 0], [0, -1]]);
    for (const [dr, dc] of nb) {
      const rr = r + dr, cc = c + dc;
      if (!_dmOpenCell(m, rr, cc) || from[rr * m.w + cc] >= 0) continue;
      from[rr * m.w + cc] = r * m.w + c;
      stack.push([rr, cc]);
    }
  }
  const onPath = new Uint8Array(m.w * m.h);
  for (let i = sr * m.w + sc; from[i] >= 0 && from[i] !== i; i = from[i]) onPath[i] = 1;
  const shut = [];
  for (const d of st.doors) {
    d[2] = onPath[d[0] * m.w + d[1]] ? 1 : 0;
    if (!d[2]) shut.push(d);
  }
  _dmShuffle(st, shut);
  const extra = Math.floor(shut.length * (1 - DM_LEVEL.doors_closed));
  for (let i = 0; i < extra; i++) shut[i][2] = 1;
}

// A new language round in play (language_select_described_object.lua, read as
// spec): a goal object and one of a different shape, each with a random
// pattern and two random named colours, on two random 'O' cells; the
// instruction names the goal's shape. DMLab adds colour noise; the port uses
// the named colours exactly.
function _dmLangRound(st) {
  st.lend = 0; st.lcount = 0;
  if (DM_LEVEL.lang.task === 'located') { _dmLocatedRound(st); return; }
  if (DM_LEVEL.lang.task === 'execute') { _dmExecuteRound(st); return; }
  if (DM_LEVEL.lang.task === 'answer') { _dmAnswerRound(st); return; }
  const m = st.maze, L = DM_LEVEL.lang;
  const keys = Object.keys(L.tiles).sort();
  const shapes = [...new Set(keys.map((k) => k.split('__')[0]))];
  const pats = [...new Set(keys.map((k) => k.split('__')[1]))];
  const cols = Object.keys(L.colors).sort();
  const g = shapes[crRi(st.pcg, shapes.length)];
  const others = shapes.filter((s) => s !== g);
  const o = others[crRi(st.pcg, others.length)];
  const cells = _dmShuffle(st, m.ocells.slice());
  const item = (shape, k, reward) => {
    const pat = pats[crRi(st.pcg, pats.length)];
    const t = L.tiles[shape + '__' + pat], sc = L.scales[shape] || 1;
    const c1 = L.colors[cols[crRi(st.pcg, cols.length)]];
    const c2 = pat === 'solid' ? c1 : L.colors[cols[crRi(st.pcg, cols.length)]];
    const [r, c] = cells[k];
    return [(c + 0.5) * DM_CELL, (m.h - r - 0.5) * DM_CELL, t[0], F(t[1] * sc), F(t[2] * sc), reward, c1, c2];
  };
  dmSetItems(st, [item(o, 1, -L.goal_reward), item(g, 0, L.goal_reward)]);
  st.instr = g;
}

// A new round of language_select_located_object in play (its level script,
// read as spec): a 2-room task (weight 2, on the two-area or two-room map), a
// 4-room or a 6-room one (weight 1 each). Rooms take shuffled distinct floor
// colours. Objects: the goal (random room and colour); one of another colour
// in its room; one of its colour in another room; one of the second's colour
// in the third's room (2-room) or anywhere; then 4 (4-room) or 8 (6-room)
// random ones anywhere. Each on a random free 'O' cell of its room, a random
// shape, solid. A distractor costs floor(10 / #distractors + 0.5).

const DM_LOCATED_TASKS = [[2, 'twoAreaMap_customFloors', 'twoRoomMap_customFloors'], [2, null, null],
  [4, 'fourRoomMap_customFloors'], [6, 'sixRoomMap_customFloors']];
function _dmLocatedRound(st) {
  const L = DM_LEVEL.lang, pick = (a) => a[crRi(st.pcg, a.length)];
  let task = pick(DM_LOCATED_TASKS);
  if (task[1] === null) task = DM_LOCATED_TASKS[0];       // weights 2:1:1
  const rooms = task[0], name = rooms === 2 ? task[1 + crRi(st.pcg, 2)] : task[1];
  const g = L.maps[name];
  const regions = [...new Set(g.oregions)].filter((v) => v !== '.' && v !== '0').sort();
  const cols = Object.keys(L.colors).sort();
  const order = _dmShuffle(st, cols.slice()), floors = {};
  regions.forEach((v, i) => { floors[v] = order[i]; });
  st.maze = dmLangMaze(DM_LEVEL.seeds[st.seedIdx], name, floors);
  st.doors = [];
  dmDoorsChanged(st);
  const other = (a, x) => pick(a.filter((v) => v !== x));
  const r1 = pick(regions), c1 = pick(cols), c2 = other(cols, c1), r3 = other(regions, r1);
  const want = [[r1, c1], [r1, c2], [r3, c1], [rooms === 2 ? r3 : 'any', c2]];
  for (let k = 0; k < (rooms === 2 ? 0 : rooms === 4 ? 4 : 8); k++) want.push(['any', pick(cols)]);
  const m = st.maze, free = m.ocells.map((rc, i) => [rc, m.oregions[i]]);
  const n = want.length - 1, bad = -Math.floor(L.goal_reward / n + 0.5);
  const items = [];
  want.forEach(([reg, col], k) => {
    const cand = free.filter(([, v]) => reg === 'any' || v === reg);
    const [rc] = pick(cand);
    free.splice(free.findIndex(([x]) => x === rc), 1);
    const shape = pick(Object.keys(L.tiles).map((s) => s.split('__')[0]));
    const t = L.tiles[shape + '__solid'], sc = L.scales[shape] || 1, rgb = L.colors[col];
    items.push([(rc[1] + 0.5) * DM_CELL, (m.h - rc[0] - 0.5) * DM_CELL, t[0], F(t[1] * sc), F(t[2] * sc),
      k === 0 ? L.goal_reward : bad, rgb, rgb]);
  });
  dmSetItems(st, items);
  st.instr = 'Pick the ' + c1 + ' object in the ' + floors[r1] + ' room';
}

// A new round of language_execute_random_task in play (its level script and
// language/*.lua, read as spec). One of 14 tasks by weight; each lists object
// groups whose colour, shape and room are drawn as random ('r'), shared by the
// whole group ('c'), the same as group g's (['s', g]) or different to every
// value groups gs used (['d', gs]). Unlisted attributes are random (the
// colour-near-colour task defaults shape to group 1's). Rewards are balanced:
// a goal-group pick +10, a distractor -floor(10 / #distractors + 0.5). The
// 'Every' tasks count instead: +1 per goal, the last adds 10 and ends the
// round, a distractor costs -floor((#goals + 10) / #distractors + 0.5) and
// ends it. Room tasks place each object on a free 'O' cell of its room, the
// others on random 'O' cells. Instructions use group 1 (goal) and group 2.
const DM_EXEC_PICK = [{}, { color: ['d', [1]], shape: ['d', [1]] }];
const DM_EXEC_BOTH = [{}, { color: ['s', 1], shape: ['d', [1]] }, { color: ['d', [1]], shape: ['s', 1] }];
const DM_EXEC_NEAR4 = (g1, g2, g3, g4, g5, g6, g7) => [
  Object.assign({ region: 'r' }, g1), Object.assign({ region: ['s', 1] }, g2),
  Object.assign({ region: ['d', [1]] }, g3), Object.assign({ region: ['s', 3] }, g4),
  Object.assign({ region: ['d', [1, 3]] }, g5), Object.assign({ region: ['s', 5] }, g6),
  Object.assign({ region: ['d', [1, 3, 5]] }, g7)];
const DM_EXEC_TASKS = [
  // [weight, rooms, groups, counts ('every' = 2..6 goals of at most 8), instructions, room placer, counting]
  [2, 2, DM_EXEC_PICK, [1, 2], ['C', 'S', 'C S']],
  [1, 4, DM_EXEC_PICK, [1, 4], ['C', 'S', 'C S']],
  [1, 6, DM_EXEC_PICK, [1, 8], ['C', 'S', 'C S']],
  [2, 2, DM_EXEC_BOTH, [1, 1, 1], ['C S']],
  [1, 4, DM_EXEC_BOTH, [1, 3, 3], ['C S']],
  [1, 6, DM_EXEC_BOTH, [1, 5, 5], ['C S']],
  [2, 2, [{ shape: 'c' }, { shape: ['d', [1]] }], [2, 2], ['Every S'], 0, 1],
  [1, 4, [{ shape: 'c' }, { shape: ['d', [1]] }], 'every', ['Every S'], 0, 1],
  [2, 2, [{ color: 'c' }, { color: ['d', [1]] }], [2, 2], ['Every C object'], 0, 1],
  [1, 4, [{ color: 'c' }, { color: ['d', [1]] }], 'every', ['Every C object'], 0, 1],
  [2, 2, [{ region: 'r' }, { shape: ['d', [1]], region: ['s', 1] }, { shape: ['s', 1], region: ['d', [1]] },
    { shape: ['d', [2]], region: ['s', 3] }], [1, 1, 1, 1], ['S near S2'], 1],
  [1, 4, DM_EXEC_NEAR4({}, { shape: ['d', [1]] }, { shape: ['s', 1] }, { shape: ['d', [2]] },
    { shape: ['s', 2] }, { shape: ['d', [1]] }, { shape: ['d', [1, 2]] }), [1, 1, 1, 1, 1, 1, 2], ['S near S2'], 1],
  [1, 4, DM_EXEC_NEAR4({}, { color: ['d', [1]] }, { shape: ['s', 1], color: ['d', [2]] }, { color: ['d', [2]] },
    { color: ['s', 2], shape: ['d', [1]] }, { shape: ['d', [1]] }, { shape: ['d', [1]], color: ['d', [2]] }),
  [1, 1, 1, 1, 1, 1, 2], ['S near C2 object'], 1],
  [1, 4, DM_EXEC_NEAR4({ shape: 'r' }, { color: ['d', [1]] }, { color: ['s', 1] }, { color: ['d', [2]] },
    { color: ['s', 2] }, { color: ['d', [1]] }, { color: ['d', [1, 2]] }), [1, 1, 1, 1, 1, 1, 2],
  ['C object near C2 object'], 1, 0, 1],
];
const DM_EXEC_MAPS = { 2: ['twoAreaMap', 'twoRoomMap'], 4: ['fourRoomMap'], 6: ['sixRoomMap'] };

// item_count.createGroupCounts{groupMin = {2, 2}, maxObjects = 8}
function _dmExecEvery(st) {
  const out = [2, 2], idx = _dmShuffle(st, [0, 1]);
  let left = crRi(st.pcg, 5);              // 4..8 objects in all
  while (left > 0) {
    for (const i of idx) {
      const v = out[i] + crRi(st.pcg, left + 1);
      left -= v - out[i]; out[i] = v;
    }
  }
  return out;
}

function _dmExecuteRound(st) {
  const L = DM_LEVEL.lang, pick = (a) => a[crRi(st.pcg, a.length)];
  let w = crRi(st.pcg, DM_EXEC_TASKS.reduce((s, t) => s + t[0], 0)), task = DM_EXEC_TASKS[0];
  for (const t of DM_EXEC_TASKS) { if (w < t[0]) { task = t; break; } w -= t[0]; }
  const [, rooms, groups, counts0, keys, byRoom, counting, sameShape] = task;
  const name = pick(DM_EXEC_MAPS[rooms]);
  st.maze = dmLangMaze(DM_LEVEL.seeds[st.seedIdx], name, {});
  st.doors = [];
  dmDoorsChanged(st);
  const m = st.maze;
  const vals = {
    color: Object.keys(L.colors).sort(),
    shape: [...new Set(Object.keys(L.tiles).map((s) => s.split('__')[0]))].sort(),
    region: [...new Set(m.oregions)].filter((v) => v !== '.' && v !== '0').sort(),
  };
  const counts = counts0 === 'every' ? _dmExecEvery(st) : counts0;
  const made = groups.map(() => []);
  groups.forEach((g, gi) => {
    for (let k = 0; k < counts[gi]; k++) {
      const o = {};
      for (const a of ['color', 'region', 'shape']) {
        let spec = g[a];
        if (spec === undefined) spec = a === 'region' ? (byRoom ? 'r' : 'any') : a === 'shape' && sameShape ? ['s', 1] : 'r';
        if (spec === 'any') o[a] = 'any';
        else if (spec === 'r') o[a] = pick(vals[a]);
        else if (spec === 'c') o[a] = k > 0 ? made[gi][0][a] : pick(vals[a]);
        else if (spec[0] === 's') o[a] = made[spec[1] - 1][0][a];
        else {
          const used = new Set(spec[1].flatMap((j) => made[j - 1].map((x) => x[a])));
          o[a] = pick(vals[a].filter((v) => !used.has(v)));
        }
      }
      made[gi].push(o);
    }
  });
  const goals = made[0].length, distract = made.slice(1).reduce((s, g) => s + g.length, 0);
  const bad = -Math.floor((counting ? goals + L.goal_reward : L.goal_reward) / distract + 0.5);
  const free = m.ocells.map((rc, i) => [rc, m.oregions[i]]);
  if (!byRoom) _dmShuffle(st, free);
  const items = [];
  made.forEach((g, gi) => g.forEach((o) => {
    let j = 0;
    if (byRoom) {
      const cand = free.map((f, i) => [f, i]).filter(([f]) => f[1] === o.region);
      j = pick(cand)[1];
    }
    const [rc] = free.splice(j, 1)[0];
    const t = L.tiles[o.shape + '__solid'], sc = L.scales[o.shape] || 1, rgb = L.colors[o.color];
    const reward = gi === 0 ? (counting ? 1 : L.goal_reward) : bad;
    items.push([(rc[1] + 0.5) * DM_CELL, (m.h - rc[0] - 0.5) * DM_CELL, t[0], F(t[1] * sc), F(t[2] * sc),
      reward, rgb, rgb, gi === 0 ? 1 : 0]);
  }));
  dmSetItems(st, items);
  st.lcount = counting ? goals : 0;
  const g1 = made[0][0], g2 = made[1][0];
  st.instr = pick(keys).replace(/C2|S2|C|S/g, (k) => ({ C: g1.color, S: g1.shape, C2: g2.color, S2: g2.shape }[k]));
}

// item_count.createGroupCounts (read as spec): min per group, max (-1 none),
// a fixed total; the remainder handed out in shuffled group order.
function _dmGroupCounts(st, min, max, total) {
  const out = min.slice(), idx = _dmShuffle(st, min.map((_, i) => i));
  let left = total - min.reduce((s, v) => s + v, 0);
  while (left > 0) {
    for (const i of idx) {
      const hi = max[i] >= 0 ? Math.min(max[i], out[i] + left) : out[i] + left;
      const v = out[i] + crRi(st.pcg, hi - out[i] + 1);
      left -= v - out[i]; out[i] = v;
    }
  }
  return out;
}

// A new round of language_answer_quantitative_question in play (its level
// script, read as spec). A question on the 4 'D' cells' objects, answered by
// picking the white 'yes' ball (room A) or the black 'no' ball (room B): +10
// when right, -10 when wrong; the other objects are only to look at. One of 4
// questions, the counts drawn so that yes and no come about equally often:
//   'Are all S objects C?'   1-4 S objects in C, the rest S in other colours
//   'Is any S C?'            S in C / S in another colour / another shape
//   'Is anything C?'         C / another colour / another colour
//   'Are most S objects C?'  as 'any', 7 count setups (4 yes, 3 no)
const DM_ANSWER_MOST = [[1, [1, 0, 0], [-1, 0, -1]], [1, [2, 0, 0], [-1, 1, -1]], [1, [3, 0, 0], [-1, 1, -1]],
  [1, [4, 0, 0], [-1, 0, -1]], [1, [0, 1, 0], [0, -1, -1]], [2, [0, 1, 0], [1, -1, -1]], [1, [0, 2, 0], [2, -1, -1]]];
const DM_ANSWER_COLOURS = ['red', 'green', 'blue', 'cyan', 'magenta', 'yellow'];
function _dmAnswerRound(st) {
  const L = DM_LEVEL.lang, pick = (a) => a[crRi(st.pcg, a.length)];
  st.maze = dmLangMaze(DM_LEVEL.seeds[st.seedIdx], 'quantificationSmallMap',
    { A: 'green', B: 'red', C: 'orange', D: 'black' });
  st.doors = [];
  dmDoorsChanged(st);
  const m = st.maze, cols = DM_ANSWER_COLOURS;
  const shapes = [...new Set(Object.keys(L.tiles).map((s) => s.split('__')[0]))].sort();
  const other = (a, x) => pick(a.filter((v) => v !== x));
  const task = crRi(st.pcg, 4), gs = pick(shapes), gc = pick(cols);
  let objs = [], truth, instr;
  if (task === 0) {
    const n = crRi(st.pcg, 2) === 0 ? [4, 0] : _dmGroupCounts(st, [1, 1], [-1, -1], 4);
    for (let k = 0; k < n[0]; k++) objs.push([gs, gc]);
    for (let k = 0; k < n[1]; k++) objs.push([gs, other(cols, gc)]);
    truth = n[1] === 0; instr = 'Are all ' + gs + ' objects ' + gc + '?';
  } else {
    let n;
    if (task === 3) {
      let w = crRi(st.pcg, 8), e = DM_ANSWER_MOST[0];
      for (const x of DM_ANSWER_MOST) { if (w < x[0]) { e = x; break; } w -= x[0]; }
      n = _dmGroupCounts(st, e[1], e[2], 4);
    } else {
      n = crRi(st.pcg, 2) === 0 ? _dmGroupCounts(st, [1, 0, 0], [-1, -1, -1], 4)
        : _dmGroupCounts(st, [0, 0, 0], [0, -1, -1], 4);
    }
    const anything = task === 2;
    for (let k = 0; k < n[0]; k++) objs.push([anything ? pick(shapes) : gs, gc]);
    for (let k = 0; k < n[1]; k++) objs.push([anything ? pick(shapes) : gs, other(cols, gc)]);
    for (let k = 0; k < n[2]; k++) objs.push(anything ? [pick(shapes), other(cols, gc)] : [other(shapes, gs), pick(cols)]);
    truth = task === 3 ? n[0] > n[1] : n[0] > 0;
    instr = task === 1 ? 'Is any ' + gs + ' ' + gc + '?' : task === 2 ? 'Is anything ' + gc + '?'
      : 'Are most ' + gs + ' objects ' + gc + '?';
  }
  const cells = (v) => m.ocells.filter((_, i) => m.oregions[i] === v);
  const free = _dmShuffle(st, cells('D'));
  const mk = ([r, c], shape, col, reward, goal, look) => {
    const t = L.tiles[shape + '__solid'], sc = L.scales[shape] || 1, rgb = L.colors[col];
    return [(c + 0.5) * DM_CELL, (m.h - r - 0.5) * DM_CELL, t[0], F(t[1] * sc), F(t[2] * sc), reward, rgb, rgb, goal, look];
  };
  const items = [mk(cells('A')[0], 'ball', 'white', truth ? L.goal_reward : -L.goal_reward, truth ? 1 : 0, 0),
    mk(cells('B')[0], 'ball', 'black', truth ? -L.goal_reward : L.goal_reward, truth ? 0 : 1, 0)];
  objs.forEach(([shape, col], k) => items.push(mk(free[k], shape, col, 0, 0, 1)));
  dmSetItems(st, items);
  st.instr = instr;
}

function dmRestart(st) {
  const m = st.maze;
  let ev = null;
  if (st.replayRespawns !== null) {
    for (const r of st.replayRespawns) if (r.frame === st.frame) { ev = r; break; }
  }
  if (ev !== null) {
    st.acc = 0; st.phase = ev.yaw_phase / 512 * DM_U;
    dmPlace(st, ev.pos[0], ev.pos[1], ev.rot);
    if (m.flat) { st.z = st.groundZ; st.vz = 0; st.air = false; }
    if (ev.doors) dmSetDoors(st, ev.doors);
    if (ev.lang) {
      st.maze = dmLangMaze(DM_LEVEL.seeds[st.seedIdx], ev.lang.map, ev.lang.floors);
      st.doors = [];
      dmDoorsChanged(st);
      dmSetItems(st, ev.lang.items);
      st.instr = ev.lang.instr;
      st.lcount = ev.lang.count || 0; st.lend = 0;
    }
    else if (ev.items) dmSetItems(st, ev.items);
    else st.alive.fill(1);
    st.holdLeft = ev.hold; st.catchMs = ev.catch; st.queue.length = 0;
    return;
  }
  if (m.flat) {
    // Box levels restart at their one spawn point, every item back.
    dmPlace(st, m.spawn[0], m.spawn[1], m.spawn[3]);
    st.z = st.groundZ; st.vz = 0; st.air = false;
    st.alive.fill(1);
    st.holdLeft = DM_RESPAWN_HOLD; st.catchMs = DM_RESPAWN_CATCH; st.queue.length = 0;
    return;
  }
  // Play: the factories' rules, the port's PCG.
  if (DM_LEVEL.kind === 'language') {
    // a new round first: it may switch the map the spawn is drawn on
    _dmLangRound(st);
    const mm = st.maze, [r, c] = mm.pcells[crRi(st.pcg, mm.pcells.length)];
    const yaw = F(F(crRf(st.pcg) * 360) - 180);
    st.acc = 0; st.phase = 0;
    dmPlace(st, (c + 0.5) * DM_CELL, (mm.h - r - 0.5) * DM_CELL, yaw);
    st.holdLeft = DM_RESPAWN_HOLD; st.catchMs = DM_RESPAWN_CATCH; st.queue.length = 0;
    return;
  }
  let reach = m.pcells;
  if (DM_LEVEL.kind === 'goal' && m.goal !== null) {
    const [gr, gc] = _dmCellOf(m, m.goal[0], m.goal[1]);
    const ok = new Set(_dmReach(m, gr, gc).map(([r, c]) => r * m.w + c));
    reach = m.pcells.filter(([r, c]) => ok.has(r * m.w + c));
  }
  const [r, c] = reach[crRi(st.pcg, reach.length)];
  const yaw = F(F(crRf(st.pcg) * 360) - 180);
  st.acc = 0; st.phase = 0;
  dmPlace(st, (c + 0.5) * DM_CELL, (m.h - r - 0.5) * DM_CELL, yaw);
  if (st.doors.length) { _dmDrawDoors(st, r, c); dmDoorsChanged(st); }
  if (DM_LEVEL.kind === 'objects') st.alive.fill(1);
  if (DM_LEVEL.kind === 'rewards') {
    const ok = new Set(_dmReach(m, r, c).map(([rr, cc]) => rr * m.w + cc));
    const locs = m.acells.filter(([rr, cc]) => ok.has(rr * m.w + cc));
    _dmShuffle(st, locs);
    const n = Math.floor(DM_LEVEL.pickup_density * locs.length);
    const items = [];
    for (let k = 0; k < n; k++) {
      const pc = k < m.pucats.length ? k : crRi(st.pcg, m.pucats.length);
      const [rr, cc] = locs[k];
      items.push([(cc + 0.5) * DM_CELL, (m.h - rr - 0.5) * DM_CELL, m.pucats[pc]]);
    }
    dmSetItems(st, items);
  }
  st.holdLeft = DM_RESPAWN_HOLD; st.catchMs = DM_RESPAWN_CATCH; st.queue.length = 0;
}
