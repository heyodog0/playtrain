/**
 * Throughput benchmark for v2 (Three.js + Dawn WebGPU) games.
 *
 * Spawns one child process per game (using three-fps-bench-single.mjs)
 * to keep global scope clean — game files use top-level `let THREE`/`let
 * score` which would clash if loaded into the same VM context.
 *
 * Usage:
 *   node docs/benchmarks/three-fps-bench.mjs                        # all games
 *   node docs/benchmarks/three-fps-bench.mjs --game crossy_road_3d  # one game
 *   node docs/benchmarks/three-fps-bench.mjs --frames 1000          # more samples
 */

import { readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const gamesDir = join(repoRoot, 'games', 'threejs');
const singleScript = join(__dirname, 'three-fps-bench-single.mjs');

const args = process.argv.slice(2);
let targetGame = null;
let FRAMES = 300;
let WARMUP = 30;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--game' && args[i + 1]) targetGame = args[++i];
  else if (args[i] === '--frames' && args[i + 1]) FRAMES = parseInt(args[++i], 10);
  else if (args[i] === '--warmup' && args[i + 1]) WARMUP = parseInt(args[++i], 10);
}

function listGames() {
  return readdirSync(gamesDir).filter(f => f.endsWith('.js')).map(f => f.replace('.js', '')).sort();
}

const games = targetGame ? [targetGame] : listGames();

process.stderr.write(`\nThree.js v2 throughput bench (Dawn / WebGPU)\n`);
process.stderr.write(`  ${games.length} games × ${FRAMES} frames each (${WARMUP} warmup)\n`);
process.stderr.write(`  System: ${os.platform()} ${os.arch()}, ${os.cpus()[0]?.model}, Node ${process.version}\n\n`);

const results = [];
for (const g of games) {
  process.stderr.write(`  ${g.padEnd(24)} ... `);
  try {
    const stdout = execFileSync('node', [singleScript, g, String(FRAMES), String(WARMUP)], {
      cwd: repoRoot,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const r = JSON.parse(stdout.toString().trim().split('\n').pop());
    results.push(r);
    if (r.error) {
      process.stderr.write(`FAILED: ${r.error.slice(0, 80)}\n`);
    } else {
      process.stderr.write(`tick=${String(r.tickFps).padStart(6)} render=${String(r.renderFps).padStart(5)} rl=${String(r.rlFps).padStart(5)} FPS\n`);
    }
  } catch (e) {
    const msg = e.stderr ? e.stderr.toString().trim().split('\n').pop() : e.message;
    process.stderr.write(`CRASH: ${msg.slice(0, 80)}\n`);
    results.push({ name: g, error: msg.slice(0, 200) });
  }
}

// Markdown summary table
process.stderr.write('\n');
console.log(`# Three.js v2 throughput (Dawn WebGPU)`);
console.log(`Render target: ${results.find(r => !r.error)?.width || '?'}×${results.find(r => !r.error)?.height || '?'}, ${FRAMES} frames per phase, ${os.cpus()[0]?.model}\n`);
console.log('| game                    |   tick |  render | rl_step |  tick ms | render ms |  rl ms |');
console.log('|-------------------------|-------:|--------:|--------:|---------:|----------:|-------:|');
for (const r of results) {
  if (r.error) {
    console.log(`| ${r.name.padEnd(23)} | ERROR  |         |         |          |           |        |`);
  } else {
    console.log(`| ${r.name.padEnd(23)} | ${String(r.tickFps).padStart(6)} | ${String(r.renderFps).padStart(7)} | ${String(r.rlFps).padStart(7)} | ${String(r.tickMs).padStart(8)} | ${String(r.renderMs).padStart(9)} | ${String(r.rlMs).padStart(6)} |`);
  }
}

const valid = results.filter(r => !r.error);
if (valid.length > 0) {
  const avg = (k) => Math.round(valid.reduce((s, r) => s + r[k], 0) / valid.length);
  const med = (k) => {
    const v = valid.map(r => r[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  console.log('');
  console.log(`**${valid.length}/${results.length} succeeded.**`);
  console.log(`- avg: tick=${avg('tickFps')}, render=${avg('renderFps')}, rl_step=${avg('rlFps')} FPS`);
  console.log(`- median: tick=${med('tickFps')}, render=${med('renderFps')}, rl_step=${med('rlFps')} FPS`);
}
