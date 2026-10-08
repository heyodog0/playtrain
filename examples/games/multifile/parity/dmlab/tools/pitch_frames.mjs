// pitch_frames.mjs - the port at the oracle's pitched poses (PLAN.md section 12, P5).
//
//   node tools/pitch_frames.mjs <level> <out.json>
//
// reference/pitch/<level>.json (reference/oracle/probe_pitch.py) holds DMLab's
// frames at seeds 0-1, dumped frames f, pitched to -60..60 degrees. For each:
// load the bundle, replay the script trajectory to f with the G3 replay inputs,
// put the player at the frame's pose (position, yaw) and the human look pitch
// (dmLookPitch) at its pitch, render 64x64. Writes [{seed, f, target, rgb}].
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { GameEnv } from '../../../../../../runtime/p5/game-env.mjs';
import { getObsBuffer } from '../../../../../../runtime/p5/p5-shim.mjs';
import { bgraBufferToRGB } from '../../../../../../runtime/p5/obs.mjs';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const level = process.argv[2];
const pitch = JSON.parse(readFileSync(join(HERE, 'reference', 'pitch', `${level}.json`), 'utf8'));
const replay = JSON.parse(readFileSync(join(HERE, 'games', `${level}.replay.json`), 'utf8'));
const env = new GameEnv({ gamePath: join(HERE, 'dist', `dmlab_${level}.js`), obsWidth: 64, obsHeight: 64, maxSteps: 100000, frameSkip: 1 });
const out = [];
for (const fr of pitch.frames) {
  const d = JSON.parse(readFileSync(join(HERE, 'reference', 'dumps', level, `${fr.seed}.json`), 'utf8'));
  env.reset({ seed: fr.seed });
  globalThis.__pt = { seed: fr.seed, rp: replay[String(fr.seed)].script, acts: d.trajectories.script.map((r) => r.a),
    upto: fr.f, pose: [fr.pos[0], fr.pos[1], fr.pos[2], fr.rot[1], fr.rot[0]] };
  vm.runInThisContext(`(() => {
    const P = globalThis.__pt, st = gameState;
    dmLoad(st, P.seed);
    st.replayMsec = P.rp.msec; st.replayRespawns = P.rp.respawns; st.replayTeleports = P.rp.teleports || null;
    st.phase = P.rp.yaw_phase / 512 * DM_U; st.n0 = dmYawCount(st);
    for (let i = 0; i < P.upto; i++) dmFrame(st, DM_ACTIONS[P.acts[i]]);
    const sh = st.maze.shift || [0, 0];
    st.x = Math.fround(P.pose[0] + sh[0]); st.y = Math.fround(P.pose[1] + sh[1]); st.z = Math.fround(P.pose[2]);
    st.yaw = Math.fround(P.pose[3]);
    dmLookPitch = P.pose[4];
    dmRender(st);
    dmLookPitch = 0;
  })()`);
  out.push({ seed: fr.seed, f: fr.f, target: fr.target, rgb: Buffer.from(bgraBufferToRGB(getObsBuffer(64, 64), 64, 64)).toString('base64') });
}
env.close();
writeFileSync(process.argv[3], JSON.stringify(out));
console.log(level, out.length, 'frames');
