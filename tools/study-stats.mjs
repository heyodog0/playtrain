#!/usr/bin/env node
// study-stats.mjs — the numbers behind the figures, from pulled session files.
//
//   node tools/study-pull.mjs            # first, to get the data
//   node tools/study-stats.mjs           # table to stdout
//   node tools/study-stats.mjs --json dist/study-stats.json
//
// Two statistics, and the reasoning for each is in tools/HANDOFF.md:
//
//   * per-game block mean per participant, then pooled mean + 95% CI across participants.
//     Discarded episodes are excluded -- those were cut off by the block timer rather than
//     played to a conclusion, so scoring them biases the mean downward.
//   * within-block change: each participant's first third of rounds vs their last third.
//     Descriptive only. Rounds are not a fixed budget, so a participant who improves survives
//     longer and changes their own round count; this is not a learning-rate estimate.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const DIR = resolve(arg('--in', join(REPO_ROOT, 'dist', 'study-data')));
const JSON_OUT = arg('--json', null);
const MIN_COMPLETE = !process.argv.includes('--include-partial');

if (!existsSync(DIR)) {
  console.error(`no data at ${DIR} -- run: node tools/study-pull.mjs`);
  process.exit(2);
}

// t(0.975, df) for the small n this study runs at; falls back to the normal quantile.
const TCRIT = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306,
                9: 2.262, 10: 2.228, 12: 2.179, 15: 2.131, 19: 2.093, 24: 2.064, 29: 2.045 };
const tcrit = (df) => TCRIT[df] ?? (df > 29 ? 1.96 : 2.045);

// Non-participants must never enter the numbers silently. Debug-menu runs, standalone
// playtests of a single block, and endpoint probes all land in the same bucket as real
// sessions -- three leftover probe-* blobs once pulled breakout's mean from 208 to 152 before
// anyone noticed. Everything dropped is printed, so an empty exclusion list is a claim too.
const NON_PARTICIPANT = /^(probe|playtest|debug|incident|deploycheck|readycheck|smoke|test|anon|final)/i;
const all = readdirSync(DIR).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')));
const excluded = [];
const sessions = all.filter(s => {
  const why = s.debug ? 'debug-menu session'
    : s.standalone ? 'standalone single-block playtest'
    : NON_PARTICIPANT.test(String(s.participantId)) ? 'non-participant id'
    : (MIN_COMPLETE && s.partial !== false) ? 'incomplete'
    : null;
  if (why) { excluded.push(`${s.participantId} (${why})`); return false; }
  return true;
});

const byGame = {};
for (const s of sessions) {
  for (const b of s.blocks || []) {
    if (b.practice) continue;
    const kept = (b.episodes || []).filter(e => !e.discarded);
    if (!kept.length) continue;
    const scores = kept.map(e => e.score);
    (byGame[b.game] ??= []).push({
      pid: s.participantId, rounds: kept.length, scores,
      mean: scores.reduce((a, x) => a + x, 0) / scores.length,
      max: Math.max(...scores), canvasPx: b.canvasPx, fps: b.fps,
    });
  }
}

const out = [];
for (const [game, rows] of Object.entries(byGame)) {
  const means = rows.map(r => r.mean);
  const n = means.length;
  const mean = means.reduce((a, x) => a + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(means.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const ci = n > 1 ? tcrit(n - 1) * sd / Math.sqrt(n) : 0;
  const f = [], l = [];
  for (const r of rows) {
    if (r.scores.length < 3) continue;
    const k = Math.max(1, Math.floor(r.scores.length / 3));
    f.push(r.scores.slice(0, k).reduce((a, x) => a + x, 0) / k);
    l.push(r.scores.slice(-k).reduce((a, x) => a + x, 0) / k);
  }
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const first = avg(f), last = avg(l);
  out.push({ game, n, mean, sd, ci, lo: Math.min(...means), hi: Math.max(...means),
             medianRounds: rows.map(r => r.rounds).sort((a, b) => a - b)[Math.floor(n / 2)],
             first, last, pctChange: first ? 100 * (last - first) / first : null,
             nWithThreeRounds: f.length,
             canvasPx: [...new Set(rows.map(r => r.canvasPx))],
             perParticipant: rows.map(r => ({ pid: r.pid, mean: r.mean, max: r.max, rounds: r.rounds })) });
}

console.log(`${sessions.length} participant session(s) from ${DIR}`);
console.log(excluded.length ? `excluded ${excluded.length}: ${excluded.join(', ')}\n` : 'excluded none\n');
console.log('game          n   mean      95% CI    range              med rounds   first->last    change');
for (const g of out) {
  const f = (v) => v === null ? '  -  ' : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  console.log(`${g.game.padEnd(12)} ${String(g.n).padStart(2)}  ${f(g.mean).padStart(7)}  ±${f(g.ci).padStart(7)}  ` +
    `${f(g.lo).padStart(6)} - ${f(g.hi).padStart(7)}   ${String(g.medianRounds).padStart(6)}      ` +
    `${f(g.first).padStart(6)} -> ${f(g.last).padStart(6)}  ${g.pctChange === null ? '  -' :
      (g.pctChange >= 0 ? '+' : '') + g.pctChange.toFixed(0) + '%'}`);
}
const canvases = [...new Set(out.flatMap(g => g.canvasPx))].sort((a, b) => a - b);
if (canvases.length > 1) {
  console.log(`\n!! participants played at different canvas sizes: ${canvases.join(', ')}px.` +
    ' Sessions before 2026-08-05 predate the 520px fix; see tools/HANDOFF.md.');
}
if (JSON_OUT) { writeFileSync(resolve(JSON_OUT), JSON.stringify(out, null, 1)); console.log(`\nwrote ${JSON_OUT}`); }
