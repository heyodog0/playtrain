// 90_playtrain.js - the PlayTrain contract: setup, draw, resetGame,
// getGameState, and the keys that make up an action.
//
// One draw() is one agent step: DM_REPEAT engine frames with the same action
// (IMPALA's action repeat 4), then one frame rendered. Reward is the score
// delta; the episode is truncated at DMLab's episode length.
// The canvas a human sees. Agents still get 64x64: the runtime rasterizes
// at the observation size and the maze primitives take their rect in canvas
// units, so the same draw() renders either.
const CANVAS_SIZE = 256;
const DM_KEY = { W: 87, S: 83, A: 65, D: 68, LEFT: 37, RIGHT: 39, UP: 38, DOWN: 40, SPACE: 32 };

let gameState = null;
let gameOver = false;

function setup() {
  createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  if (gameState === null) resetGame(0);
}

// The sidecar's actions hold these keys; this maps them back to the index.
function currentAction() {
  if (typeof keyIsDown !== 'function') return -1;
  const k = (c) => keyIsDown(c);
  if (k(DM_KEY.SPACE)) return 8;
  const fwd = k(DM_KEY.W), left = k(DM_KEY.LEFT), right = k(DM_KEY.RIGHT);
  if (fwd && left) return 6;
  if (fwd && right) return 7;
  if (left) return 4;
  if (right) return 5;
  if (DM_LEVEL.kind === 'psychlab' && k(DM_KEY.UP)) return 9;
  if (DM_LEVEL.kind === 'psychlab' && k(DM_KEY.DOWN)) return 10;
  if (fwd) return 0;
  if (k(DM_KEY.S)) return 1;
  if (k(DM_KEY.A)) return 2;
  if (k(DM_KEY.D)) return 3;
  return -1;   // no key: a human standing still (not in the agent's action set)
}

// One engine frame with action vector `act`. Returns the frame's reward.
function dmFrame(st, act) {
  const msec = st.replayMsec !== null ? st.replayMsec[st.frame]
    : DM_MSEC_CYCLE[st.frame % 3];
  if (DM_LEVEL.kind === 'psychlab') {
    const r = dmPsychFrame(st, act);
    st.prevAct = act;
    st.score = F(st.score + r);
    st.frame++;
    return r;
  }
  if (st.holdLeft >= 0) {
    // After a restart: the view turns, the walk waits, then catches up.
    dmYawUpdate(st, act[0]);
    st.queue.push([act, st.yaw, msec]);   // a queued command keeps the view and msec it was made with
    if (st.holdLeft > 0) {
      st.holdLeft--;
    } else {
      const yawNow = st.yaw;
      for (let i = 0; i < st.queue.length; i++) {
        st.yaw = st.queue[i][1];
        dmWalkChopped(st, st.queue[i][0], i === 0 ? st.catchMs : st.queue[i][2]);
      }
      st.yaw = yawNow;
      st.queue.length = 0;
      st.holdLeft = -1;
    }
  } else if (!(st.maze.flat && dmTeleportFrame(st, act))) {
    dmPmove(st, act, msec);
  }
  const r = dmTaskFrame(st);
  st.prevAct = act;
  st.score = F(st.score + r);
  st.frame++;
  return r;
}

function dmMaxFrames() { return DM_LEVEL.episode_seconds * DM_FPS; }

// Human play only. The play page calls humanStart() once and humanLook(dx, dy)
// on mouse moves; an env never does, so what an agent sees and does is
// unchanged. A person gets mouse look, a crosshair in psychlab, no approximate
// HUD, and every engine frame drawn: one frame a page tick at 60 fps, where an
// agent's step is DM_REPEAT frames with only the last one rendered (the page
// would show 15 fps). The game's speed is the same either way.
let dmHuman = false, dmLookDx = 0, dmLookDy = 0;
// mouse pixels to DMLab look pixels (0.1056 degrees each): 3 gives 0.32
// degrees a mouse pixel, a common first-person sensitivity
const DM_MOUSE = 3;
// The view's pitch for a person outside psychlab (degrees, positive looks
// down; PLAN.md section 12). Drawing only: Quake walks along the yaw alone, so
// pitch never moves the player (PROGRESS.md P0), and only humanLook changes it.
let dmLookPitch = 0;
var humanStart = function () { dmHuman = true; };
var humanLook = function (dx, dy) {
  dmLookDx += dx * DM_MOUSE;
  if (DM_LEVEL.kind === 'psychlab') { dmLookDy += dy * DM_MOUSE; return; }
  dmLookPitch = Math.max(-85, Math.min(85, dmLookPitch + dy * DM_MOUSE * DM_LOOK));
};

function draw() {
  if (gameState === null) resetGame(0);
  if (!gameOver) {
    const a = currentAction();
    let act = a < 0 ? DM_NOOP : DM_ACTIONS[a];
    if (dmLookDx !== 0 || dmLookDy !== 0) {
      // the whole move on this step's first frame; psychlab's pitch kept within 85 degrees
      act = act.slice();
      act[0] += dmLookDx;
      if (DM_LEVEL.kind === 'psychlab') {
        const p = gameState.pitch + dmLookDy * DM_LOOK;
        act[1] += p > 85 ? (85 - gameState.pitch) / DM_LOOK : p < -85 ? (-85 - gameState.pitch) / DM_LOOK : dmLookDy;
      }
      dmLookDx = 0; dmLookDy = 0;
    }
    // a person's arrow up / down outside psychlab: the look actions' rate
    // (20 px a frame), drawing only like the mouse's
    const frames = dmHuman ? 1 : DM_REPEAT;
    if (dmHuman && DM_LEVEL.kind !== 'psychlab' && typeof keyIsDown === 'function') {
      const step = frames * 20 * DM_LOOK;
      if (keyIsDown(DM_KEY.UP)) dmLookPitch = Math.max(-85, dmLookPitch - step);
      if (keyIsDown(DM_KEY.DOWN)) dmLookPitch = Math.min(85, dmLookPitch + step);
    }
    for (let i = 0; i < frames && !gameOver; i++) {
      dmFrame(gameState, i === 0 ? act : (a < 0 ? DM_NOOP : DM_ACTIONS[a]));
      if (gameState.frame >= dmMaxFrames()) gameOver = true;
      if (gameState.endAt >= 0 && gameState.frame >= gameState.endAt) gameOver = true;
    }
  }
  dmRender(gameState);
}

function resetGame(seed) {
  dmLookPitch = 0;
  if (gameState === null) gameState = createState();
  dmLoad(gameState, seed >>> 0);
  gameOver = false;
}

// The instruction (a text observation, info['instruction']): language levels only.
var getInstruction = DM_LEVEL.kind === 'language' ? function () { return gameState ? gameState.instr : ''; } : undefined;

function getGameState() {
  return {
    score: gameState === null ? 0 : gameState.score,
    lives: 1,
    gameState: gameOver ? 'GAMEOVER' : 'PLAYING',
  };
}
