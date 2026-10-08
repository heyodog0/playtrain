// perceptual_frames.mjs - the port's frames at the oracle's dumped poses (G6).
//
//   node tools/perceptual_frames.mjs <level> <out.json>
//
// For every dump of <level>: load the bundle (dist/dmlab_<level>.js) in the
// real p5 runtime, replay the script trajectory to each dumped frame with the
// G3 replay inputs (games/<level>.replay.json), put the player exactly at the
// oracle's pose there (position and yaw), render, and keep the 64x64 RGB.
// Writes {seed: [{frame, rgb: base64}]}.
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { GameEnv } from '../../../../../../runtime/p5/game-env.mjs';
import { getObsBuffer } from '../../../../../../runtime/p5/p5-shim.mjs';
import { bgraBufferToRGB } from '../../../../../../runtime/p5/obs.mjs';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const level = process.argv[2];
const out = process.argv[3];
// --labels: also render each pose with every atlas tile repainted as its
// surface class (alpha kept, so sprite cut-outs stay exact): a per-pixel
// class map for tools/perceptual_regions.py.
const LABELS = process.argv.includes('--labels');
// --ids: also render each pose with every atlas tile repainted as its index
// (R = index & 255, G = index >> 8) and the texel's class in B: 251 + (alpha
// < 128 ? 2 : 0) + (max(r, g, b) < 40 ? 1 : 0). Which texture, and which part
// of its mask, each pixel shows (tools/fit_light.py, tools/fit_objects.py).
// A texel of alpha 0 stays transparent; others become opaque.
const IDS = process.argv.includes('--ids');
const dumps = join(HERE, 'reference', 'dumps', level);
const replay = JSON.parse(readFileSync(join(HERE, 'games', `${level}.replay.json`), 'utf8'));
const env = new GameEnv({ gamePath: join(HERE, 'dist', `dmlab_${level}.js`), obsWidth: 64, obsHeight: 64, maxSteps: 100000, frameSkip: 1 });
// --no-spawn: leave out the frame-0 spawn bands (tools/fit_spawn.py fits them).
if (process.argv.includes('--no-spawn')) vm.runInThisContext('DM_SPAWN0.length = 0');
const res = {};
const files = readdirSync(dumps).filter((f) => /^\d+\.json$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
for (const f of files) {
  const d = JSON.parse(readFileSync(join(dumps, f), 'utf8'));
  // psychlab (T7): one gaze-controller trajectory; the pose is the view (pitch, yaw)
  const psych = !!d.trajectories.gaze;
  const traj = psych ? d.trajectories.gaze.filter((r) => 'rot' in r) : d.trajectories.script;
  globalThis.__pt = { seed: d.seed, rp: psych ? replay[String(d.seed)] : replay[String(d.seed)].script,
    acts: traj.map((r) => r.a), psych };
  const shots = [];
  for (const fr of d.frames) {
    env.reset({ seed: d.seed });
    globalThis.__pt.upto = fr.frame;
    globalThis.__pt.pose = [fr.pos[0], fr.pos[1], fr.pos[2], fr.rot[1], fr.rot[0]];
    vm.runInThisContext(`(() => {
      const P = globalThis.__pt, st = gameState;
      if (P.psych) {
        dmLoad(st, P.seed);
        st.phase = P.rp.yaw_phase / 512 * DM_U; st.n0 = dmYawCount(st);
        st.pphase = P.rp.pitch_phase / 512 * DM_U; st.pn0 = dmPitchCount(st);
        st.replayTrials = P.rp.trials || null;
        for (let i = 0; i < P.upto; i++) dmFrame(st, DM_ACTIONS[P.acts[i]]);
        st.yaw = Math.fround(P.pose[3]); st.pitch = Math.fround(P.pose[4]);
        dmRender(st);
        return;
      }
      dmLoad(st, P.seed);
      st.replayMsec = P.rp.msec; st.replayRespawns = P.rp.respawns; st.replayTeleports = P.rp.teleports || null;
      st.phase = P.rp.yaw_phase / 512 * DM_U; st.n0 = dmYawCount(st);
      for (let i = 0; i < P.upto; i++) dmFrame(st, DM_ACTIONS[P.acts[i]]);
      const sh = st.maze.shift || [0, 0];   // a language map is laid out shifted (compile_level lang_pad)
      st.x = Math.fround(P.pose[0] + sh[0]); st.y = Math.fround(P.pose[1] + sh[1]); st.z = Math.fround(P.pose[2]);
      st.yaw = Math.fround(P.pose[3]);
      dmRender(st);
    })()`);
    const rgb = bgraBufferToRGB(getObsBuffer(64, 64), 64, 64);
    const shot = { frame: fr.frame, rgb: Buffer.from(rgb).toString('base64') };
    if (LABELS) {
      vm.runInThisContext(`(() => {
        const st = gameState;
        if (!globalThis.__ptLabelAtlas) {
          // class codes in R (G = B = 0): 1 wall, 2 floor, 3 ceiling, 4 object, 5 other
          const cls = (n) => n.startsWith('sprite/') ? 4
            : /ceiling|fake_sky/.test(n) ? 3
            : /floor|water_d|script_highlight|black_d|utility_panel/.test(n) ? 2
            : /wall|door|decal/.test(n) ? 1 : 5;
          const a = Uint8Array.from(_dmAtlas), stride = DM_ATLAS_STRIDE;
          for (const [name, i] of Object.entries(DM_ATLAS)) {
            const c = cls(name);
            for (let o = i * stride; o < (i + 1) * stride; o += 4) { a[o] = c * 40; a[o + 1] = 0; a[o + 2] = 0; }
          }
          globalThis.__ptLabelAtlas = a;
        }
        const keep = _dmAtlas, word = _dmTileWord;
        _dmAtlas = globalThis.__ptLabelAtlas;
        _dmTileWord = DM_ATLAS_TILE;   // level 0 only: the repainted tiles have no mips
        dmRender(st);
        _dmAtlas = keep; _dmTileWord = word;
      })()`);
      shot.labels = Buffer.from(bgraBufferToRGB(getObsBuffer(64, 64), 64, 64)).toString('base64');
    }
    if (IDS) {
      vm.runInThisContext(`(() => {
        const st = gameState;
        if (!globalThis.__ptIdAtlas) {
          const a = Uint8Array.from(_dmAtlas), stride = DM_ATLAS_STRIDE;
          for (const i of Object.values(DM_ATLAS)) {
            for (let o = i * stride; o < (i + 1) * stride; o += 4) {
              const dark = Math.max(a[o], a[o + 1], a[o + 2]) < 40 ? 1 : 0, lowA = a[o + 3] < 128 ? 2 : 0;
              a[o] = i & 255; a[o + 1] = i >> 8; a[o + 2] = 251 + lowA + dark;
              if (a[o + 3] !== 0) a[o + 3] = 255;
            }
          }
          globalThis.__ptIdAtlas = a;
        }
        const keep = _dmAtlas, word = _dmTileWord;
        _dmAtlas = globalThis.__ptIdAtlas;
        _dmTileWord = DM_ATLAS_TILE;   // level 0 only: the repainted tiles have no mips
        dmRender(st);
        _dmAtlas = keep; _dmTileWord = word;
      })()`);
      shot.ids = Buffer.from(bgraBufferToRGB(getObsBuffer(64, 64), 64, 64)).toString('base64');
    }
    shots.push(shot);
  }
  res[d.seed] = shots;
}
env.close();
writeFileSync(out, JSON.stringify(res));
console.log(level, Object.keys(res).length, 'seeds');
