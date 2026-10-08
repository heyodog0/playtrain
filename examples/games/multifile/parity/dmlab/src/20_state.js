// 20_state.js - the whole mutable state of an episode, in one object.
function createState() {
  return {
    seedIdx: 0, maze: null,            // DM_LEVEL.seeds entry
    x: 0, y: 0, z: 0, vx: 0, vy: 0,    // DMLab world units, z up (2D walk; z is the spawn's)
    vz: 0, air: false, groundZ: 0,     // airborne after a teleport
    landT: 0,                          // ms left of the hard-landing hold
    wmArm: -1, wmHold: -1, wmGiven: 0, wmMs: 0,   // watermaze: button touched, held since, +1s given, ms to the next
    teleTouched: -1, teleRewardAt: -1, // teleport pad touched / its +1 due, or -1
    replayTeleports: null,
    picked: 0, endAt: -1,              // rooms: pickups taken, frame the episode ends
    doorOpen: false, doorAt: -1, bright: false,   // exploit: door state, floor
    carried: null,                     // keys_doors: colour of the key carried
    obsFeet: NaN,                      // skymaze: feet height the obstacles were built for
    spawnYaw: 0, acc: 0, phase: 0, n0: 0, yaw: 0,   // view accumulator (40_pmove.js)
    pacc: 0, pphase: 0, pn0: 0, pitch: 0,          // psychlab: the pitch accumulator (50_tasks/psychlab.js)
    gaze: [0, 0, 0],                               // psychlab: [on screen, x, y] on the screen
    screen: [],                                    // psychlab: what the screen shows (80_render.js)
    frame: 0,                          // engine frames this episode
    instr: '',                         // language levels: the instruction now (getInstruction)
    lcount: 0, lend: 0,                // language: the round counts goals / a pick ended it
    spawnFrame: 0,                     // the episode's first frame (spawn effect, render only)
    score: 0,
    items: [], alive: new Uint8Array(0),   // [x, y, category] and still-there flags
    doors: [],                         // [row, col, open]
    cellsVersion: 0,                   // bumps when doors change (renderer repacks)
    pendingAt: -1, pendingReward: 0,   // a touch's reward, reported a frame later
    restartAt: -1,                     // frame the map restarts, or -1
    placed: false,                     // this frame teleported the player
    holdLeft: -1, catchMs: 0, queue: [],   // post-restart hold (50_tasks/explore.js)
    pcg: pcgState(),
    // G3 replay inputs (null in play): oracle msec per frame, respawn poses.
    replayMsec: null, replayRespawns: null,
    obstacles: null,                   // per wall cell planes, built at load
  };
}
