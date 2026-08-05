#!/usr/bin/env node
// study-pull.mjs — download collected sessions from Firebase to a local directory.
//
// The full payloads live in Firebase Storage; Firestore holds only a queryable summary
// (api/session.js explains the split). This pulls the blobs, which is what every analysis
// and `verify-replay` needs.
//
//   export FIREBASE_SERVICE_ACCOUNT=~/path/to/serviceAccountKey.json
//   node tools/study-pull.mjs                       # -> dist/study-data/
//   node tools/study-pull.mjs --out ~/playtrain-data --summary
//
// The key is a service-account JSON from Firebase console -> Project settings -> Service
// accounts -> Generate new private key. It is NOT in this repo and must never be committed.
// dist/ is gitignored: collected sessions are participant data and do not belong in git.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const KEY = resolve((arg('--key', process.env.FIREBASE_SERVICE_ACCOUNT || '') || '')
  .replace(/^~/, process.env.HOME));
const OUT = resolve(arg('--out', join(REPO_ROOT, 'dist', 'study-data')));
const BUCKET = arg('--bucket', process.env.FIREBASE_STORAGE_BUCKET
  || 'ai-gamestore-study-1901.firebasestorage.app');
const WANT_SUMMARY = process.argv.includes('--summary');

if (!KEY || !existsSync(KEY)) {
  console.error('need a service-account key: --key <path> or FIREBASE_SERVICE_ACCOUNT=<path>');
  console.error('get one from Firebase console -> Project settings -> Service accounts');
  process.exit(2);
}

let admin;
try {
  admin = {
    app: await import('firebase-admin/app'),
    fs: await import('firebase-admin/firestore'),
    st: await import('firebase-admin/storage'),
  };
} catch {
  console.error('firebase-admin not installed. run: pnpm install');
  process.exit(2);
}

const k = JSON.parse(readFileSync(KEY, 'utf8'));
const app = admin.app.initializeApp({
  credential: admin.app.cert({ projectId: k.project_id, clientEmail: k.client_email, privateKey: k.private_key }),
  storageBucket: BUCKET,
});
const db = admin.fs.getFirestore(app);
const bucket = admin.st.getStorage(app).bucket();

mkdirSync(OUT, { recursive: true });
const [files] = await bucket.getFiles({ prefix: 'study-sessions/' });
let n = 0;
for (const f of files) {
  const [buf] = await f.download();
  const s = JSON.parse(buf.toString());
  // One file per participant+start, same key the endpoint writes under.
  writeFileSync(join(OUT, `${s.participantId}-${String(s.startedAt).replace(/[:.]/g, '-')}.json`), buf);
  n++;
}
console.log(`pulled ${n} session(s) -> ${OUT}`);

if (WANT_SUMMARY) {
  const snap = await db.collection('study_sessions').get();
  console.log(`\nFirestore summaries: ${snap.size}`);
  console.log('participant       complete blocks eps canvas attempts fromUrl age  experience');
  for (const d of snap.docs) {
    const s = d.data(), dm = s.demographics || {};
    console.log(`${String(s.participantId).slice(0, 16).padEnd(17)} ` +
      `${String(s.complete).padEnd(8)} ${String(s.blockCount).padStart(6)} ${String(s.episodeCount).padStart(3)} ` +
      `${[...new Set((s.blocks || []).map(b => b.canvasPx))].join(',').padStart(6)} ` +
      `${String(s.quizAttempts).padStart(8)} ${String(s.prolific?.fromUrl).padEnd(7)} ` +
      `${String(dm.age ?? '-').padEnd(4)} ${dm.gamingExperience ?? '-'}`);
  }
}
process.exit(0);
