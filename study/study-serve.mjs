#!/usr/bin/env node
// Serve the study locally AND capture sessions, so your own playtests are saved
// instead of vanishing. The deployed site is pure static + a remote endpoint; this is
// the same thing with the endpoint running on localhost.
//
//   node study/study-serve.mjs            # build, serve on :8080, save to dist/study-sessions
//   node study/study-serve.mjs --port 3000 --sessions ~/playtests
//
// Finish a session and it lands as <participantId>-<timestamp>.json, ready for
//   node study/verify-replay.mjs dist/study-sessions/<file>.json

import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join, extname, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const PORT = parseInt(arg('--port', '8080'), 10);
const SITE = resolve(arg('--site', join(REPO_ROOT, 'dist', 'study')));
const SESSIONS = resolve(arg('--sessions', join(REPO_ROOT, 'dist', 'study-sessions')));
const SKIP_BUILD = process.argv.includes('--no-build');

// Build with the upload URL pointed at ourselves, so the page actually POSTs.
if (!SKIP_BUILD) {
  const r = spawnSync(process.execPath, [
    join(__dirname, 'build-study.mjs'),
    '--out', SITE,
    '--upload', `http://localhost:${PORT}/api/session`,
  ], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

mkdirSync(SESSIONS, { recursive: true });

const MIME = { '.html': 'text/html', '.json': 'application/json', '.txt': 'text/plain',
               '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript' };

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/session') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      let session;
      try { session = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { res.writeHead(400); return res.end('bad json'); }

      // Same validation the real endpoint should do: the irreducible core is
      // {game, seed, actions} per episode -- everything else about an outcome is
      // recoverable from those, and nothing recovers them.
      const eps = (session.blocks || []).flatMap(b => b.episodes || []);
      const bad = eps.filter(e => !e.game || e.seed === undefined || !Array.isArray(e.actions));
      if (bad.length) { res.writeHead(422); return res.end('episodes missing game/seed/actions'); }

      // Key on participantId + startedAt, so the checkpoints a session sends after each
      // block overwrite one growing file rather than littering one file per block.
      const pid = String(session.participantId || 'anon').replace(/[^A-Za-z0-9_-]/g, '');
      const stamp = String(session.startedAt || new Date().toISOString()).replace(/[:.]/g, '-');
      const file = join(SESSIONS, `${pid}-${stamp}.json`);

      // Never let a late checkpoint overwrite a completed session. Checkpoints are
      // fire-and-forget, so the one from the last block can land after the final upload
      // and would otherwise replace a record carrying finishedAt and completionCode with
      // a slightly older partial copy. The real endpoint (api/session.js) does the same.
      if (session.partial && existsSync(file)) {
        try {
          if (JSON.parse(readFileSync(file, 'utf8')).partial === false) {
            console.log(`\n=== late checkpoint ignored (already complete): ${file}`);
            res.writeHead(200, { 'content-type': 'application/json',
                                 'access-control-allow-origin': '*' });
            return res.end('{"ok":true,"ignored":"already-complete"}');
          }
        } catch { /* unreadable/partial file on disk: fall through and overwrite it */ }
      }
      writeFileSync(file, JSON.stringify(session));

      const scored = (session.blocks || []).filter(b => !b.practice);
      const tag = session.partial ? 'checkpoint' : 'session complete';
      console.log(`\n=== ${tag}: ${file}`);
      console.log(`    ${scored.length} blocks, ${eps.length} episodes, ${(Buffer.concat(chunks).length / 1024).toFixed(0)}KB`);
      for (const b of scored) {
        const keep = (b.episodes || []).filter(e => !e.discarded);
        const scores = keep.map(e => e.score);
        const mean = scores.length ? (scores.reduce((a, x) => a + x, 0) / scores.length).toFixed(1) : '-';
        const folded = (b.episodes || []).reduce((s, e) => s + (e.foldedFrames || 0), 0);
        console.log(
          `    ${(b.game + (b.obsRes ? '@64' : '')).padEnd(15)}` +
          ` rounds=${String(keep.length).padStart(3)}  mean=${String(mean).padStart(7)}` +
          `  best=${String(b.bestScore ?? '-').padStart(5)}` +
          `  fps=${String(b.fps ?? '-').padStart(5)}  canvas=${b.canvasPx || '?'}px` +
          `  folded=${(100 * folded / Math.max(1, b.deliveredFrames)).toFixed(0)}%`);
      }
      console.log(`\n    verify:  node study/verify-replay.mjs ${file}\n`);

      res.writeHead(200, { 'content-type': 'application/json',
                           'access-control-allow-origin': '*' });
      res.end('{"ok":true}');
    });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*',
                         'access-control-allow-headers': 'content-type',
                         'access-control-allow-methods': 'POST, OPTIONS' });
    return res.end();
  }

  let p = join(SITE, decodeURIComponent(req.url.split('?')[0]));
  if (!extname(p)) p = join(p, 'index.html');
  if (!p.startsWith(SITE) || !existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream',
                       'cache-control': 'no-store' });
  res.end(readFileSync(p));
});

server.listen(PORT, () => {
  const n = readdirSync(SESSIONS).filter(f => f.endsWith('.json')).length;
  console.log(`\n  study    http://localhost:${PORT}/`);
  console.log(`  sessions ${SESSIONS}  (${n} saved)`);
  console.log(`  a single game, no session: http://localhost:${PORT}/block/caveflyer/`);
  console.log('  debug menu: ctrl+shift+alt+D  (jump to any screen, short blocks;');
  console.log('              suppresses upload unless you tick "allow upload")\n');
});
