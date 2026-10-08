// 50_tasks/rooms.js - the rooms family's task rules (the rooms factories and
// level scripts, read as specification; timing from the oracle).
//
//   collect  rooms_collect_good_objects: 10 good (+1) and 10 bad (-1)
//            objects; the episode ends 0.2 s after the 10th pickup.
//   exploit  rooms_exploit_deferred_effects: apples (+1), cakes (+10, in the
//            second room) and a box (-3) whose pickup brightens the floor and
//            fires its target, the door between the rooms; the episode ends
//            0.2 s after the 10th pickup.
//
//   nonmatch rooms_select_nonmatching_object: a teleport pad (+1) carries the
//            player from the room with the example object to the room with
//            two choices; the non-matching one is +10, the matching one -10,
//            and either restarts the map at the spawn.
//
// A TELEPORT: the player's box (+-15, z -24..+32) overlapping the trigger's
// box at a frame's end gives +1 and, a frame later, places the player at the
// destination facing its angle, moving 400 units/s that way, in the air. In
// a G3 replay the frame the +1 arrives and the arrival's movement time are
// the oracle's (server timing varies 0-3 frames); the port must have touched
// the pad by then or nothing happens and the gate fails.
//
// Touch and reward timing are the explore family's (50_tasks/explore.js):
// tested on a frame's end position, the reward reported one frame later.
const DM_ROOMS_END_FRAMES = 12;   // 0.2 s at 60 fps after the last pickup
const DM_ROOMS_PICKUPS_TO_END = 10;

function _dmInTrigger(st, t) {
  return st.x + DM_PLAYER_HALF > t.min[0] && st.x - DM_PLAYER_HALF < t.max[0] &&
    st.y + DM_PLAYER_HALF > t.min[1] && st.y - DM_PLAYER_HALF < t.max[1] &&
    st.z + 32 > t.min[2] && st.z - 24 < t.max[2];
}

// Called by 90_playtrain.js INSTEAD of the frame's walk when a teleport lands
// this frame; returns true if it did.
function dmTeleportFrame(st, act) {
  const tps = DM_LEVEL.maps[st.maze.map] && DM_LEVEL.maps[st.maze.map].teleports;
  if (!tps || tps.length === 0 || st.teleTouched < 0) return false;
  let ms = 17, at = st.teleTouched + 1, ev = null;
  if (st.replayTeleports !== null) {
    ev = st.replayTeleports.find((e) => e.frame >= st.teleTouched && e.frame === st.frame);
    if (!ev) return false;
    ms = ev.ms;
  } else if (st.frame !== at) {
    return false;
  }
  const t = tps[0], a = t.yaw * Math.PI / 180;
  // The arrival frame's yaw is the destination's plus the looks made since the
  // touch; in a replay it is the oracle's, as a respawn's is.
  st.acc = 0; st.phase = ev ? ev.yaw_phase / 512 * DM_U : 0;
  dmPlace(st, t.dest[0], t.dest[1], ev ? ev.rot : t.yaw);
  if (!ev) dmYawUpdate(st, act[0]);
  st.z = F(t.dest[2]); st.vz = 0; st.air = true;
  st.vx = F(DM_TELEPORT_SPEED * F(Math.cos(a))); st.vy = F(DM_TELEPORT_SPEED * F(Math.sin(a)));
  // The arrival moves `ms`: all but this frame's own time under the command
  // that was held when the pad fired, then this frame's (oracle: the sideways
  // speed gained on arrival is one frame of air acceleration).
  const own = st.replayMsec !== null ? st.replayMsec[st.frame] : DM_MSEC_CYCLE[st.frame % 3];
  if (ms > own) dmWalkChopped(st, st.prevAct || act, ms - own);
  dmWalkChopped(st, act, ms > own ? own : ms);
  st.teleTouched = -1;
  return true;
}

function dmRoomsFrame(st) {
  let reward = 0;
  // the teleport pad
  const tps = DM_LEVEL.maps[st.maze.map] && DM_LEVEL.maps[st.maze.map].teleports;
  if (tps && tps.length && st.teleTouched < 0 && !st.air && _dmInTrigger(st, tps[0])) {
    st.teleTouched = st.frame;
    if (st.replayTeleports !== null) {
      const ev = st.replayTeleports.find((e) => e.reward_frame >= st.frame);
      st.teleRewardAt = ev ? ev.reward_frame : -1;
    } else {
      st.teleRewardAt = st.frame + 1;
    }
  }
  if (st.teleRewardAt === st.frame) { reward = F(reward + 1); st.teleRewardAt = -1; }
  if (st.restartAt === st.frame) {
    st.restartAt = -1;
    dmRestart(st);
  }
  if (st.pendingAt >= 0 && st.frame === st.pendingAt + 1) {
    reward = F(reward + st.pendingReward);
    st.pendingReward = 0;
    st.pendingAt = -1;
  }
  const m = st.maze;
  let got = 0, touched = 0;
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i];
    if (_dmTouches(st, it[0], it[1])) {
      st.alive[i] = 0;
      got += m.cats[it[2]][3];
      touched = 1;
      st.picked++;
      if (DM_LEVEL.kind === 'nonmatch') st.restartAt = st.frame + 2;
      else if (st.picked === DM_ROOMS_PICKUPS_TO_END) st.endAt = st.frame + DM_ROOMS_END_FRAMES;
      if (m.cats[it[2]][4] === 'box_door') {
        st.bright = true;
        if (!st.doorOpen && st.doorAt < 0) st.doorAt = st.frame;
        dmBoxGeometry(st);
      }
    }
  }
  if (touched) {
    st.pendingAt = st.frame;
    st.pendingReward = F(st.pendingReward + got);
  }
  if (st.doorAt >= 0 && !st.doorOpen && (DM_LEVEL.maps[m.map + '#dark'].doors || []).length) {
    dmBoxGeometry(st);   // the door is moving
    if (dmDoorOpen(st, 0) >= 1) st.doorOpen = true;
  }
  return reward;
}

// rooms_keys_doors_puzzle: keys (+1; a new key replaces the one carried),
// fence doors that open (+1, the key is used up) when the player's box
// reaches the door's cell while carrying its colour, and the goal (+50; the
// episode ends 0.2 s later). keys_doors_puzzle_factory.lua, read as spec.
// A triggered fence door SLIDES along its angle (H +x, I +y) at 300 units/s,
// starting the frame after the touch, to 95 units, so a stub stays at the far
// end of the cell: a player pressed against that end never gets through
// (oracle seed 8), and the stub's face caps a player beside it at 15.125 off
// (seed 31: 379.875 = 395 - 15.125; the obstructed doors' 94 is the same face
// measured with the text maze's 16). The probe
// (reference/oracle/probe_fence_door.py) fixes the speed: touched at the end
// of frame 151, the gap passes the player's box between frames 165 and 166.
const DM_FENCE_SPEED = 300, DM_FENCE_SLIDE = 95;

function dmFenceSlide(st, k) {
  const t0 = st.doorStartAt ? st.doorStartAt[k] : -1;
  if (t0 < 0 || st.frame < t0) return 0;
  const s = (st.frame - t0 + 1) * 0.016 * DM_FENCE_SPEED;
  return s >= DM_FENCE_SLIDE ? DM_FENCE_SLIDE : F(s);
}

function dmKeysFrame(st) {
  let reward = 0;
  if (st.pendingAt >= 0 && st.frame === st.pendingAt + 1) {
    reward = st.pendingReward;
    st.pendingReward = 0;
    st.pendingAt = -1;
  }
  const m = st.maze;
  let got = 0, touched = 0;
  for (let i = 0; i < st.items.length; i++) {
    if (!st.alive[i]) continue;
    const it = st.items[i], cat = m.cats[it[2]];
    if (!_dmTouches(st, it[0], it[1])) continue;
    st.alive[i] = 0;
    got += cat[3]; touched = 1;
    if (cat[4] !== null) st.carried = cat[4];
    else st.endAt = st.frame + DM_ROOMS_END_FRAMES;   // the goal
  }
  let changed = false;
  if (!st.doorStartAt) st.doorStartAt = new Int32Array(st.doors.length).fill(-1);
  for (let k = 0; k < st.doors.length; k++) {
    const d = st.doors[k];
    if (st.doorStartAt[k] >= 0) {
      // moving (or fully open): its slab follows the slide
      const sl = dmFenceSlide(st, k);
      if (sl !== d[2]) { d[2] = sl; changed = true; }
      continue;
    }
    if (st.carried === null || m.door_colours[k] !== st.carried) continue;
    const x0 = d[1] * DM_CELL, y0 = (m.h - 1 - d[0]) * DM_CELL;
    if (st.x + DM_PLAYER_HALF > x0 && st.x - DM_PLAYER_HALF < x0 + DM_CELL &&
        st.y + DM_PLAYER_HALF > y0 && st.y - DM_PLAYER_HALF < y0 + DM_CELL) {
      st.doorStartAt[k] = st.frame + 1;
      st.carried = null; got += 1; touched = 1;
    }
  }
  if (changed) dmDoorsChanged(st);
  if (touched) {
    st.pendingAt = st.frame;
    st.pendingReward = F(st.pendingReward + got);
  }
  return reward;
}

// rooms_watermaze (navigate_watermaze_factory.lua, read as spec; timing from
// reference/oracle/probe_watermaze.py, two approaches that agree frame for
// frame). The platform's button is an octagon 64 across its flats about the
// platform's origin; the player's box touching it (tested on a frame's end)
// fires it, and 6 frames later the player is put on the platform's centre,
// at rest, and held there while it rises (DMLab's lua mover). +1 comes 10
// frames after that, then every 1000 ms of engine time; one period after the
// 5th the map restarts at a spawn point. The oracle re-centres the player
// every 6 frames and lets it walk in between; the port holds it every frame.
const DM_WATER_ARM = 6, DM_WATER_FIRST = 10, DM_WATER_PERIOD = 1000, DM_WATER_REWARDS = 5;
// the player's height, frames after the hold began (the platform rising
// 35 units a server tick and pushing it; both probes identical)
const DM_WATER_RISE = [40.125, 40.125, 40.125, 40.125, 40.125, 40.125, 75.0459, 74.7715, 74.2309,
  108.4888, 107.6684, 106.4648, 130.9502, 129.5838, 127.7172, 125.6126, 123.7002, 121.1706, 118.403, 118.125];

function dmWaterReset(st) {
  st.wmArm = -1; st.wmHold = -1; st.wmGiven = 0; st.wmMs = 0;
}

function _dmOnButton(st) {
  const P = st.maze.platform, dx = Math.abs(st.x - P[0]), dy = Math.abs(st.y - P[1]);
  return dx < 64 + DM_PLAYER_HALF && dy < 64 + DM_PLAYER_HALF && dx + dy < 90 + 2 * DM_PLAYER_HALF;
}

function dmWaterFrame(st) {
  let reward = 0;
  if (st.restartAt === st.frame) {
    st.restartAt = -1;
    dmWaterRestart(st);
    return 0;
  }
  if (st.wmHold < 0) {
    if (st.wmArm < 0 && _dmOnButton(st)) st.wmArm = st.frame;
    if (st.wmArm >= 0 && st.frame >= st.wmArm + DM_WATER_ARM) st.wmHold = st.frame;
  }
  if (st.wmHold >= 0) {
    const k = st.frame - st.wmHold, P = st.maze.platform;
    st.x = F(P[0]); st.y = F(P[1]); st.vx = 0; st.vy = 0; st.vz = 0; st.air = false;
    st.z = F(DM_WATER_RISE[k < DM_WATER_RISE.length ? k : DM_WATER_RISE.length - 1]);
    st.groundZ = st.z;
    if (k === DM_WATER_FIRST) { reward = 1; st.wmGiven = 1; st.wmMs = 0; }
    else if (k > DM_WATER_FIRST) {
      st.wmMs += st.replayMsec !== null ? st.replayMsec[st.frame] : DM_MSEC_CYCLE[st.frame % 3];
      if (st.wmMs >= DM_WATER_PERIOD) {
        st.wmMs -= DM_WATER_PERIOD;
        if (st.wmGiven >= DM_WATER_REWARDS) st.restartAt = st.frame + 1;
        else { reward = 1; st.wmGiven++; }
      }
    }
  }
  return reward;
}

// finishMap: the map loads again; the player starts at one of the map's
// spawn points (DMLab's pick: here the episode's PCG), facing anywhere.
function dmWaterRestart(st) {
  const map = DM_LEVEL.maps[st.maze.map];
  let x, y, yaw;
  if (st.replayRespawns !== null && st.replayRespawns.length) {
    const ev = st.replayRespawns.find((r) => r.frame === st.frame);
    if (ev) { x = ev.pos[0]; y = ev.pos[1]; yaw = ev.rot; st.phase = ev.yaw_phase / 512 * DM_U; }
  }
  if (x === undefined) {
    const sp = map.spawns[crRi(st.pcg, map.spawns.length)];
    x = sp[0]; y = sp[1]; yaw = F(F(crRf(st.pcg) * 360) - 180); st.phase = 0;
  }
  st.acc = 0;
  dmPlace(st, x, y, yaw);
  st.groundZ = F(map.stand_z); st.z = st.groundZ; st.vz = 0; st.air = false;
  dmWaterReset(st);
  st.holdLeft = DM_RESPAWN_HOLD; st.catchMs = DM_RESPAWN_CATCH; st.queue.length = 0;
}

