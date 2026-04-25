/**
 * Benchmark all games headlessly, one child process per game.
 *
 * Usage:
 *   node benchmarks/all-games-bench.mjs [--frames 500] [--game breakout]
 *
 * Outputs JSON to stdout with per-game results including sample frames.
 */

import { readdirSync, writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const gamesDir = join(repoRoot, 'games', 'js');
const outputsDir = join(repoRoot, 'outputs');
const benchScript = join(__dirname, 'bench-single-game.mjs');

// Parse CLI args
const args = process.argv.slice(2);
let BENCH_FRAMES = 500;
let targetGame = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--frames' && args[i + 1]) BENCH_FRAMES = parseInt(args[++i], 10);
  if (args[i] === '--game' && args[i + 1]) targetGame = args[++i];
}

function listGames() {
  return readdirSync(gamesDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace('.js', ''))
    .sort();
}

const games = targetGame ? [targetGame] : listGames();
const results = [];

process.stderr.write(`Benchmarking ${games.length} games (${BENCH_FRAMES} frames each)...\n`);

for (const game of games) {
  process.stderr.write(`  ${game}... `);
  try {
    const stdout = execFileSync('node', [benchScript, game, String(BENCH_FRAMES)], {
      cwd: repoRoot,
      timeout: 60000,
      maxBuffer: 50 * 1024 * 1024, // 50MB for sample frame data
    });
    const result = JSON.parse(stdout.toString().trim());
    results.push(result);
    process.stderr.write(`render=${result.renderOnly.fps} FPS, rl_step=${result.rlStep.fps} FPS\n`);
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString().trim().split('\n')[0] : err.message;
    process.stderr.write(`ERROR: ${msg.slice(0, 80)}\n`);
    results.push({ game, error: msg.slice(0, 200) });
  }
}

const output = {
  generated_at: new Date().toISOString(),
  system: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpu_model: os.cpus()[0]?.model || null,
    cpu_count: os.cpus().length,
  },
  config: {
    bench_frames: BENCH_FRAMES,
    warmup_frames: 50,
    obs_width: 64,
    obs_height: 64,
    obs_format: 'rgb',
  },
  results,
};

// Write to file and stdout
mkdirSync(outputsDir, { recursive: true });
const outPath = join(outputsDir, 'all-games-benchmark-latest.json');
writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
process.stderr.write(`\nSaved to ${outPath}\n`);
