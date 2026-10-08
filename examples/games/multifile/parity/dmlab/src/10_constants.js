// 10_constants.js - every number the dynamics use, with where it came from.
//
// Movement (fitted on explore_goal_locations_small, PROGRESS.md U04): Quake 3's
// documented walk defaults, which the oracle's trajectories select sharply.
const DM_SPEED = F(320);        // wish speed, units/s
const DM_ACCEL = F(10);         // ground acceleration
const DM_FRICTION = F(6);       // ground friction
const DM_STOP = F(100);         // friction control floor
const DM_HALF = F(16);          // player half-width: walls stop the centre 16.125 away
const DM_EPS = F(0.125);        // trace clip epsilon
const DM_OVERCLIP = F(1.001);   // velocity overclip against a plane
const DM_NOTCH = 1;              // square notch at every convex wall corner (30_level.js)

// View: a look action of p pixels adds p * 0.10560 deg (Q3 m_yaw 0.022 times
// sensitivity 4.8) to a float accumulator; the yaw is that accumulator
// quantised to Quake angle shorts (U = 360/65536 deg). Exact on every oracle
// frame (PROGRESS.md U04).
// The accumulator is a double: the fit is exact in double and a float32
// accumulator flips the quantisation on ~1 frame in 20 (tested in G3).
const DM_LOOK = 0.10560;
const DM_U = 360 / 65536;

// In the air (after a teleport): Quake's air acceleration 1 and gravity 800,
// the vertical move integrating the mean of the frame's start and end
// velocity; landing at the level's standing height (rooms_select_nonmatching,
// fitted on the oracle's z after a teleport, PROGRESS.md U06).
const DM_AIR_ACCEL = F(1);
const DM_GRAVITY = F(800);
const DM_TELEPORT_SPEED = 400;

// Engine timing: DMLab steps at 60 fps (episodeTimeSeconds advances 1/60 per
// frame) but player movement integrates over 17, 17, 14 ms - Quake's client
// clock drift around a 16 ms frame. The port uses that cycle from episode
// start; the G3 replays use the oracle's own per-frame values.
const DM_MSEC_CYCLE = [17, 17, 14];

// IMPALA's DMLab-30 action set, google-deepmind/scalable_agent environments.py
// DEFAULT_ACTION_SET: (look_lr, look_du, strafe_lr, move_bf, fire, jump, crouch).
const DM_ACTIONS = [
  [0, 0, 0, 1, 0, 0, 0],     // 0 forward
  [0, 0, 0, -1, 0, 0, 0],    // 1 backward
  [0, 0, -1, 0, 0, 0, 0],    // 2 strafe left
  [0, 0, 1, 0, 0, 0, 0],     // 3 strafe right
  [-20, 0, 0, 0, 0, 0, 0],   // 4 look left
  [20, 0, 0, 0, 0, 0, 0],    // 5 look right
  [-20, 0, 0, 1, 0, 0, 0],   // 6 forward + look left
  [20, 0, 0, 1, 0, 0, 0],    // 7 forward + look right
  [0, 0, 0, 0, 1, 0, 0],     // 8 fire
  // psychlab only (PROGRESS.md T1): IMPALA's set cannot reach the answer buttons
  [0, -20, 0, 0, 0, 0, 0],   // 9 look up
  [0, 20, 0, 0, 0, 0, 0],    // 10 look down
];
const DM_NOOP = [0, 0, 0, 0, 0, 0, 0];
const DM_REPEAT = 4;            // engine frames per agent step (IMPALA)
const DM_FPS = 60;

// Geometry: a maze cell is 100 units; feet z 25.125, eye 26 above (oracle).
const DM_CELL = 100;
const DM_FEET_Z = 25.125;
const DM_EYE_HEIGHT = 26;
const DM_FLOOR_Z = 1.125;       // feet z minus the player's 24 below origin

// Pickups: a player at (x, y) touches an item at (ix, iy) when
// x - ix in [-50, 44] and y - iy in [-36, 36], tested on a frame's end
// position; the reward arrives one frame later and a goal's restart
// teleports the player one frame after that (fitted, PROGRESS.md U04).
const DM_TOUCH_X0 = -50, DM_TOUCH_X1 = 44, DM_TOUCH_Y0 = -36, DM_TOUCH_Y1 = 36;
const DM_GOAL_REWARD = 10;
