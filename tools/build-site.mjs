#!/usr/bin/env node
// Vercel build entry: emit BOTH sites into one output directory.
//
//   dist/pages/          the game tester      (password-gated by middleware.js)
//   dist/pages/study/    the human study      (public; participants arrive from Prolific)
//
// One project, one deploy, one domain. middleware.js exempts /study and /api/session
// from basic auth; everything else stays behind it.
//
// The study is built with its upload URL pointed at /api/session on the same origin, so
// the participant page makes no cross-origin request and needs no CORS.

import { spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT = join(REPO_ROOT, 'dist', 'pages');

function run(script, args) {
  const r = spawnSync(process.execPath, [join(__dirname, script), ...args], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`${script} failed`);
    process.exit(r.status ?? 1);
  }
}

// Tester first: it clears and recreates dist/pages, so the study must land after.
run('build-pages.mjs', ['--games', join(REPO_ROOT, 'games', 'js'), '--out', OUT]);

// Relative hrefs so the study works under the /study/ prefix.
run('build-study.mjs', [
  '--out', join(OUT, 'study'),
  '--upload', '/api/session',
  ...(process.env.STUDY_COMPLETION_URL ? ['--completion', process.env.STUDY_COMPLETION_URL] : []),
]);

console.log('\nsite: /  (tester, gated)   /study/  (participant study, public)');
