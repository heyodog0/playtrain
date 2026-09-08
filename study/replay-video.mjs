#!/usr/bin/env node
// Render a recorded human episode to video by replaying it through the headless env.
//
// The session log stores a seed and a frame-indexed action list, and study/verify-replay.mjs
// proves those reproduce the participant's score exactly. So the frames captured here are
// not a reconstruction or an approximation -- they are the same episode, re-rendered.
//
//   node study/replay-video.mjs session.json                      # every scored episode
//   node study/replay-video.mjs session.json --game asteroids     # one game
//   node study/replay-video.mjs session.json --best               # best round per game
//   node study/replay-video.mjs session.json --format mp4 --scale 2
//
// Formats:
//   gif  (default)  built in, no dependencies. Palette is taken from the frames, so for
//                   these flat-coloured games it is usually LOSSLESS (<=256 distinct
//                   colours). Good for the paper, slides, GitHub.
//   mp4             needs ffmpeg on PATH. 60fps, far smaller, seekable. Better for
//                   watching a full 33-second round.
//
// Frames are captured at the game's LOGICAL resolution (400x400), not the agent's 64x64.
// Raster resolution does not affect simulation -- verify-replay reproduces scores across
// both -- it only changes how finely the same geometry is sampled.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SELF = fileURLToPath(import.meta.url);

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = f => process.argv.includes(f);

// Same default as build-study.mjs / verify-replay.mjs. Getting this wrong renders a
// different game than the participant played.
const GAMES_DIR = resolve(arg('--games',
  process.env.PLAYTRAIN_GAMES_DIR || join(REPO_ROOT, 'examples', 'games', 'js')));

// ---------------------------------------------------------------------------
// Child: replay ONE game's episodes and emit raw RGBA frames.
// GameEnv loads one game per process (game-env.mjs `gameLoaded`), hence the split.
// ---------------------------------------------------------------------------
if (has('--child')) {
  const game = arg('--child');
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const job = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  // Render at logical resolution rather than the agent's 64x64: game-env calls
  // setRasterRes(obsWidth) before loading the game, and PLAYTRAIN_RASTER_RES (set by the
  // parent) takes precedence, making that call a no-op -- p5-shim.mjs `_RASTER_RES_FROM_ENV`.
  const shim = await import('../runtime/p5/p5-shim.mjs');
  const { GameEnv } = await import('../runtime/p5/game-env.mjs');

  const report = [];
  for (const ep of job.episodes) {
    const env = new GameEnv({
      gamePath: join(GAMES_DIR, `${game}.js`),
      frameSkip: ep.frameSkip ?? 1,
      maxSteps: ep.maxSteps ?? 2000,
    });
    env.reset({ seed: ep.seed });

    // Encode from frames held in memory. A 33s round at 20fps is ~670 frames; at the
    // default 200px render width that is ~107MB of RGBA, which is why the render width
    // (not a post-hoc downscale) is the memory knob -- the rasterizer draws the same
    // geometry at whatever resolution is asked for, so there is no resampling loss.
    const frames = [];
    const grab = () => {
      const p = shim.getPixelData();
      frames.push({ w: p.width, h: p.height, data: Buffer.from(p.data) });
    };
    grab();
    // `stride` is how many 60fps game frames to skip between captures. One env.step
    // already advances frameSkip of them, so an action-repeat episode is captured at
    // 60/frameSkip fps and must not be decimated a second time -- without this a
    // frameSkip=4 clip comes out four times too short and plays four times too fast.
    const stride = Math.max(1, Math.round(job.stride / (ep.frameSkip ?? 1)));
    let i = 0;
    for (const a of ep.actions) {
      const r = env.step(a);
      i++;
      if (i % stride === 0 && frames.length < job.maxFrames) grab();
      if (r.terminated || r.truncated) break;
    }

    // The point of rendering from a replay is that it IS the episode. If the score drifts,
    // these frames belong to some other run and the file would misrepresent it.
    if (ep.score !== undefined && env.lastScore !== ep.score) {
      report.push({ seed: ep.seed, episode: ep.episode, skipped: true,
                    score: env.lastScore, expectedScore: ep.score });
      continue;
    }

    const stem = `${job.pid}-${game}-r${ep.episode + 1}-seed${ep.seed}-score${env.lastScore}`;
    const out = join(job.outDir, `${stem}.${job.format}`);
    let colours = null, lossless = null;
    if (job.format === 'mp4') {
      // Frames were captured every `stride` env.steps, and one step advances
      // frameSkip game frames, so a frame is worth stride*frameSkip frames of
      // game time. Encoding at a fixed 60fps therefore played the action-repeat
      // clips at 4x speed; derive the rate from the capture cadence instead.
      const fps = Math.max(1, Math.round(job.fps / (stride * (ep.frameSkip ?? 1))));
      encodeMp4(frames, out, { fps, scale: job.scale, crf: job.crf });
    } else {
      const q = quantize(frames);
      colours = q.size; lossless = q.lossless;
      writeFileSync(out, encodeGif(frames, { delay: job.delay, scale: job.scale, q }));
    }
    report.push({ seed: ep.seed, episode: ep.episode, score: env.lastScore,
                  file: out, frames: frames.length, colours, lossless,
                  bytes: readFileSync(out).length,
                  truncatedClip: frames.length >= job.maxFrames });
  }
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// GIF encoder (GIF89a + LZW). No dependencies.
// ---------------------------------------------------------------------------
function quantize(frames) {
  // Exact palette when the clip has <=256 distinct colours, which flat-shaded p5 games
  // almost always do. Falls back to a 3-3-2 bit crush, which is coarse but never fails.
  const seen = new Map();
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (!seen.has(k)) {
        seen.set(k, seen.size);
        if (seen.size > 256) break;
      }
    }
    if (seen.size > 256) break;
  }
  if (seen.size <= 256) {
    const pal = new Uint8Array(768);
    for (const [k, idx] of seen) {
      pal[idx * 3] = (k >> 16) & 255; pal[idx * 3 + 1] = (k >> 8) & 255; pal[idx * 3 + 2] = k & 255;
    }
    return { pal, size: seen.size, lossless: true,
             index: (r, g, b) => seen.get((r << 16) | (g << 8) | b) ?? 0 };
  }
  const pal = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    pal[i * 3]     = ((i >> 5) & 7) * 255 / 7;
    pal[i * 3 + 1] = ((i >> 2) & 7) * 255 / 7;
    pal[i * 3 + 2] = (i & 3) * 255 / 3;
  }
  return { pal, size: 256, lossless: false,
           index: (r, g, b) => ((r >> 5) << 5) | ((g >> 5) << 2) | (b >> 6) };
}

function lzw(indices, minCodeSize) {
  const CLEAR = 1 << minCodeSize, EOI = CLEAR + 1;
  const out = [];
  let cur = 0, curBits = 0;
  const push = (code, bits) => {
    cur |= code << curBits; curBits += bits;
    while (curBits >= 8) { out.push(cur & 255); cur >>= 8; curBits -= 8; }
  };
  let dict = new Map(), next = EOI + 1, codeSize = minCodeSize + 1;
  const reset = () => { dict = new Map(); next = EOI + 1; codeSize = minCodeSize + 1; };

  push(CLEAR, codeSize);
  reset();
  let prefix = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = prefix + ',' + indices[i];
    if (dict.has(k)) { prefix = k; continue; }
    push(prefix.includes(',') ? dict.get(prefix) : Number(prefix), codeSize);
    dict.set(k, next++);
    if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    else if (next > 4095) { push(CLEAR, codeSize); reset(); }
    prefix = String(indices[i]);
  }
  push(prefix.includes(',') ? dict.get(prefix) : Number(prefix), codeSize);
  push(EOI, codeSize);
  if (curBits > 0) out.push(cur & 255);
  return out;
}

function encodeGif(frames, { delay = 5, scale = 1, q = null } = {}) {
  q = q || quantize(frames);
  const W = frames[0].w * scale, H = frames[0].h * scale;
  const bytes = [];
  const str = s => { for (const c of s) bytes.push(c.charCodeAt(0)); };
  const u16 = n => { bytes.push(n & 255, (n >> 8) & 255); };

  str('GIF89a');
  u16(W); u16(H);
  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, q.size))));
  bytes.push(0x80 | (bits - 1), 0, 0);
  const tableSize = 3 * (1 << bits);
  for (let i = 0; i < tableSize; i++) bytes.push(q.pal[i] || 0);

  // Netscape loop-forever extension
  bytes.push(0x21, 0xFF, 11); str('NETSCAPE2.0');
  bytes.push(3, 1, 0, 0, 0);

  const minCodeSize = Math.max(2, bits);
  for (const f of frames) {
    bytes.push(0x21, 0xF9, 4, 0x04, delay & 255, (delay >> 8) & 255, 0, 0);
    bytes.push(0x2C); u16(0); u16(0); u16(W); u16(H); bytes.push(0);

    const idx = new Uint8Array(W * H);
    const d = f.data;
    for (let y = 0; y < H; y++) {
      const sy = (y / scale) | 0;
      for (let x = 0; x < W; x++) {
        const p = (sy * f.w + ((x / scale) | 0)) * 4;
        idx[y * W + x] = q.index(d[p], d[p + 1], d[p + 2]);
      }
    }
    bytes.push(minCodeSize);
    const data = lzw(idx, minCodeSize);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0);
  }
  bytes.push(0x3B);
  return Buffer.from(bytes);
}

function encodeMp4(frames, file, { fps = 60, scale = 1, crf = 18 }) {
  const W = frames[0].w, H = frames[0].h;
  const args = [
    '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-',
    '-vf', `scale=${W * scale}:${H * scale}:flags=neighbor`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file,
  ];
  const p = spawnSync('ffmpeg', args, { input: Buffer.concat(frames.map(f => f.data)) });
  if (p.status !== 0) throw new Error(`ffmpeg failed: ${(p.stderr || '').toString().slice(-400)}`);
}

// ---------------------------------------------------------------------------
// Parent
// ---------------------------------------------------------------------------
const files = process.argv.slice(2).filter(a => a.endsWith('.json'));
if (!files.length) {
  console.error('usage: node study/replay-video.mjs <session.json> [--game X] [--best]');
  console.error('       [--format gif|mp4] [--scale N] [--fps N] [--out DIR] [--render-width N]');
  process.exit(1);
}

const FORMAT = arg('--format', 'gif');
const SCALE = parseInt(arg('--scale', '1'), 10);
// Render width is the real memory/size knob. The rasterizer draws the same geometry at
// whatever resolution it is given, so a smaller width is a genuinely smaller render, not a
// downscale -- no resampling softness. GIF defaults lower because an uncompressed indexed
// frame per 1/20s adds up fast; mp4 has a real codec behind it.
const RENDER_W = parseInt(arg('--render-width', FORMAT === 'gif' ? '240' : '400'), 10);
const MAX_FRAMES = parseInt(arg('--max-frames', FORMAT === 'gif' ? '720' : '4000'), 10);
const OUT_DIR = resolve(arg('--out', join(REPO_ROOT, 'dist', 'study-video')));
const ONLY_GAME = arg('--game', null);
const BEST_ONLY = has('--best');
// GIF delays are hundredths of a second, so only 100/n frame rates are exact. 20fps
// (delay 5) plays back in real time from every third 60fps frame; 50fps (delay 2) is
// smoother but bigger. mp4 keeps all 60.
const GIF_FPS = parseInt(arg('--fps', '20'), 10);
// mp4 quality. 18 is near-lossless, right for the paper and slides; the website
// ships full-length clips where the bytes matter, so it asks for a higher number.
const CRF = parseInt(arg('--crf', '18'), 10);

if (FORMAT === 'mp4') {
  const ok = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  if (!ok) {
    console.error('--format mp4 needs ffmpeg on PATH.  brew install ffmpeg');
    console.error('(or use the default --format gif, which needs nothing)');
    process.exit(1);
  }
}

const stride = FORMAT === 'mp4' ? 1 : Math.max(1, Math.round(60 / GIF_FPS));
const delay = Math.round(100 / GIF_FPS);

function runChild(game, episodes, pid) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [SELF, '--child', game, '--games', GAMES_DIR], {
      stdio: ['pipe', 'pipe', 'inherit'],
      // Overrides game-env's setRasterRes(64) so frames come out at render width.
      env: { ...process.env, PLAYTRAIN_RASTER_RES: String(RENDER_W) },
    });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.on('close', c => c === 0 ? res(JSON.parse(out)) : rej(new Error(`${game}: exit ${c}`)));
    p.stdin.end(JSON.stringify({
      episodes, stride, maxFrames: MAX_FRAMES, format: FORMAT,
      scale: SCALE, delay, fps: 60, outDir: OUT_DIR, pid, crf: CRF,
    }));
  });
}

mkdirSync(OUT_DIR, { recursive: true });
let made = 0;

for (const file of files) {
  const session = JSON.parse(readFileSync(file, 'utf8'));
  const byGame = new Map();

  for (const block of session.blocks || []) {
    if (block.practice) continue;
    if (block.obsRes) continue;                   // rasterizes different geometry by design
    let eps = (block.episodes || []).filter(e => e.actions?.length && !e.discarded);
    if (ONLY_GAME && block.game !== ONLY_GAME) continue;
    if (BEST_ONLY && eps.length) eps = [eps.reduce((a, b) => (b.score > a.score ? b : a))];
    if (!eps.length) continue;
    const list = byGame.get(block.game) || [];
    // Frame skip belongs to the run that produced the episode, and one session can
    // mix runs (agent rollouts do: some checkpoints trained with action repeat and
    // some without). Take the most specific value available; a session-wide default
    // silently replayed an action-repeat episode at 1 frame per action, which made
    // the clip four times too short and desynchronised the trajectory.
    list.push(...eps.map(e => ({
      ...e,
      frameSkip: e.frameSkip ?? block.frame_skip ?? session.frameSkip ?? 1,
      maxSteps: e.maxSteps ?? block.max_steps ?? session.maxSteps ?? 2000,
      renderWidth: RENDER_W,
    })));
    byGame.set(block.game, list);
  }

  if (!byGame.size) { console.log(`${basename(file)}: nothing to render`); continue; }
  console.log(`\n${basename(file)}  (participant ${session.participantId})`);

  for (const [game, eps] of byGame) {
    const results = await runChild(game, eps, session.participantId);
    for (const r of results) {
      if (r.skipped) {
        console.log(`  ! ${game} seed ${r.seed}: replay scored ${r.score}, log says ` +
                    `${r.expectedScore} — skipped (wrong games dir?)`);
        continue;
      }
      console.log(`  ${basename(r.file)}  ${r.frames} frames  ${(r.bytes / 1024).toFixed(0)}KB` +
                  (r.colours ? `  ${r.colours} colours${r.lossless ? ' lossless' : ' quantized'}` : '') +
                  (r.truncatedClip ? `  (clipped at --max-frames)` : ''));
      made++;
    }
  }
}

console.log(`\n${made} file${made === 1 ? '' : 's'} → ${OUT_DIR}`);
if (FORMAT === 'gif') console.log('for 60fps mp4 instead: brew install ffmpeg, then --format mp4');
