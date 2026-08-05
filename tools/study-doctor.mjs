#!/usr/bin/env node
// study-doctor.mjs — is this machine set up to run and analyse the study?
//
//   node tools/study-doctor.mjs
//
// Prints one line per requirement with the exact command to fix it. Nothing here is secret:
// the only credential involved is a Firebase service-account key, which stays outside the repo
// and is referenced by FIREBASE_SERVICE_ACCOUNT. Everything the deployed site needs lives in
// Vercel's own environment store, so a second machine needs no secrets at all to deploy.

import { existsSync, readFileSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECT_PROJECT = 'ai-gamestore-study-1901';
let fail = 0, warn = 0;

const ok = (label, detail = '') => console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
const bad = (label, fix) => { fail++; console.log(`  MISS  ${label}\n          fix: ${fix}`); };
const soft = (label, fix) => { warn++; console.log(`  warn  ${label}\n          fix: ${fix}`); };
const sh = (cmd) => { try { return execSync(cmd, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };

console.log('\n— repo and build —');
const node = process.versions.node.split('.')[0];
node >= 18 ? ok(`node ${process.versions.node}`) : bad(`node ${process.versions.node} is too old`, 'install node >= 18');
existsSync(join(REPO, 'node_modules', 'firebase-admin'))
  ? ok('firebase-admin installed')
  : bad('firebase-admin missing (needed by study-pull)', 'pnpm install');
sh('node tools/build-study.mjs --out /tmp/study-doctor-build') !== null
  ? ok('the study site builds')
  : bad('build-study.mjs fails', 'run: node tools/build-study.mjs and read the error');

console.log('\n— credentials for pulling data (local analysis only) —');
const keyPath = (process.env.FIREBASE_SERVICE_ACCOUNT || '').replace(/^~/, process.env.HOME || '');
if (!keyPath) {
  bad('FIREBASE_SERVICE_ACCOUNT is not set',
    'Firebase console -> Project settings -> Service accounts -> Generate new private key,\n'
    + '               save it OUTSIDE the repo (e.g. ~/.config/playtrain/serviceAccount.json, chmod 600),\n'
    + '               then: export FIREBASE_SERVICE_ACCOUNT=~/.config/playtrain/serviceAccount.json');
} else if (!existsSync(keyPath)) {
  bad(`FIREBASE_SERVICE_ACCOUNT points at a missing file (${keyPath})`, 'fix the path or generate a new key');
} else {
  const mode = (statSync(keyPath).mode & 0o777).toString(8);
  ok('service-account key found', keyPath);
  mode === '600' ? ok('key permissions', mode) : soft(`key is mode ${mode} (readable by others)`, `chmod 600 ${keyPath}`);
  if (keyPath.includes('/Downloads/')) soft('key lives in ~/Downloads', 'move it somewhere durable, e.g. ~/.config/playtrain/');
  try {
    const k = JSON.parse(readFileSync(keyPath, 'utf8'));
    k.project_id === EXPECT_PROJECT ? ok('key is for the right project', k.project_id)
      : soft(`key is for ${k.project_id}, expected ${EXPECT_PROJECT}`, 'generate a key from the right project');
    // The check that matters: can it actually read?
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getStorage } = await import('firebase-admin/storage');
    const app = initializeApp({
      credential: cert({ projectId: k.project_id, clientEmail: k.client_email, privateKey: k.private_key }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${k.project_id}.firebasestorage.app`,
    }, 'doctor');
    const [files] = await getStorage(app).bucket().getFiles({ prefix: 'study-sessions/', maxResults: 5 });
    ok('key authenticates and can read Storage', `${files.length === 5 ? '5+' : files.length} session object(s) visible`);
  } catch (e) {
    bad(`key present but cannot read Storage: ${String(e).split('\n')[0].slice(0, 90)}`,
      'check the key is not revoked, and that Storage is provisioned (needs the Blaze plan)');
  }
}

console.log('\n— optional: verification tools —');
existsSync(join(REPO, 'node_modules', 'playwright'))
  ? ok('playwright installed', (() => {
      const cache = join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright');
      const alt = join(process.env.HOME || '', '.cache', 'ms-playwright');
      const dir = existsSync(cache) ? cache : existsSync(alt) ? alt : null;
      if (!dir) return '(no browsers downloaded)';
      const have = sh(`ls ${dir}`) || '';
      return ['chromium', 'firefox', 'webkit'].filter(b => have.includes(b)).join(', ') || '(none)';
    })())
  : soft('playwright missing (study-browsers, study-phases, study-shots)',
      'pnpm add -D playwright && npx playwright install chromium firefox webkit');
existsSync(join(REPO, 'native', 'build', 'qjs_host'))
  ? ok('native QuickJS host built (study-parity link 2)')
  : soft('native/build/qjs_host not built', 'just build-native');

console.log('\n— optional: Vercel (only needed for env vars and logs; git push is the deploy path) —');
if (sh('vercel --version')) {
  ok('vercel CLI', sh('vercel --version'));
  existsSync(join(REPO, '.vercel', 'project.json'))
    ? ok('repo linked to a Vercel project', JSON.parse(readFileSync(join(REPO, '.vercel', 'project.json'), 'utf8')).projectName)
    : soft('repo not linked', 'vercel login && vercel link --project playtrain-study --yes');
} else {
  soft('vercel CLI not installed', 'brew install vercel  (optional — deploys happen on git push)');
}

console.log('\n— deploy path —');
const branch = sh('git rev-parse --abbrev-ref HEAD');
const dirty = (sh('git status --porcelain') || '').split('\n').filter(Boolean).length;
ok('git remote', sh('git remote get-url origin') || '(none)');
ok(`branch ${branch}`, dirty ? `${dirty} uncommitted file(s) — these are NOT deployed until pushed` : 'clean');

console.log(`\n${fail ? `${fail} blocking item(s)` : 'ready'}${warn ? `, ${warn} optional item(s) missing` : ''}\n`);
process.exit(fail ? 1 : 0);
