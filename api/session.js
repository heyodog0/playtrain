// Vercel serverless function: receive a study session and persist it.
//
// Storage shape, and why it is split:
//   * Firebase Storage  study-sessions/<pid>-<startedAt>.json  -- the full payload
//   * Firestore         study_sessions/<pid>-<startedAt>        -- a queryable summary
//
// The full payload does NOT go in Firestore. A session is ~0.5 MB against Firestore's
// 1 MiB per-document ceiling, and the frame-indexed action arrays are ~81k integers,
// which blows the 20k index-entries-per-document limit unless every array field is
// exempted from indexing. Storage holds the blob; Firestore holds what you actually
// want to query (who finished, mean scores, fps, folded rate).
//
// Checkpointing: the harness POSTs after every block with partial:true, so this handler
// must be idempotent and overwrite by key. A participant who drops out at block 7 of 9
// still leaves everything up to block 7.
//
// Env vars (Vercel → Project → Settings → Environment Variables):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY        service-account key; literal \n are unescaped below
//   FIREBASE_STORAGE_BUCKET     e.g. my-project.firebasestorage.app
//   STUDY_INGEST_TOKEN          optional; if set, requests must send X-Study-Token

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

function app() {
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel stores newlines escaped.
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const MAX_BYTES = 8 * 1024 * 1024;   // a real session is ~0.5 MB; this is a sanity bound

function summarize(session) {
  const scored = (session.blocks || []).filter(b => !b.practice);
  const perBlock = scored.map(b => {
    const kept = (b.episodes || []).filter(e => !e.discarded);
    const scores = kept.map(e => e.score);
    const folded = (b.episodes || []).reduce((s, e) => s + (e.foldedFrames || 0), 0);
    return {
      game: b.game,
      obsRes: !!b.obsRes,
      rounds: kept.length,
      meanScore: scores.length ? scores.reduce((a, x) => a + x, 0) / scores.length : null,
      maxScore: scores.length ? Math.max(...scores) : null,
      // Fraction of frames whose held keys could not be expressed in Discrete(8).
      // Measures how badly the action space fits this game; read alongside score.
      foldedRate: b.deliveredFrames ? folded / b.deliveredFrames : null,
      fps: b.fps ?? null,
      canvasPx: b.canvasPx ?? null,
      playMs: b.playMs ?? null,
    };
  });
  return {
    participantId: session.participantId ?? null,
    startedAt: session.startedAt ?? null,
    finishedAt: session.finishedAt ?? null,
    partial: session.partial !== false,
    complete: session.partial === false,
    standalone: !!session.standalone,
    completionCode: session.completionCode ?? null,
    prolific: session.source ?? null,
    consentAt: session.consent?.at ?? null,
    doNotRecontact: !!session.consent?.doNotRecontact,
    quizAttempts: session.quiz?.attempts ?? null,
    preflightFps: session.preflight?.fps ?? null,
    smallWindow: !!session.preflight?.smallWindow,
    userAgent: session.userAgent ?? null,
    order: session.order ?? null,
    blockCount: scored.length,
    episodeCount: scored.reduce((n, b) => n + (b.episodes?.length || 0), 0),
    blocks: perBlock,
  };
}

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, x-study-token');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token = process.env.STUDY_INGEST_TOKEN;
  if (token && req.headers['x-study-token'] !== token) {
    return res.status(401).json({ error: 'bad token' });
  }

  const session = req.body;
  if (!session || typeof session !== 'object') {
    return res.status(400).json({ error: 'expected a JSON body' });
  }
  const raw = JSON.stringify(session);
  if (raw.length > MAX_BYTES) return res.status(413).json({ error: 'payload too large' });

  // Validate the irreducible core. score/frames/termination are all reproducible from
  // {game, seed, actions} by tools/verify-replay.mjs; nothing reproduces those three.
  const eps = (session.blocks || []).flatMap(b => b.episodes || []);
  const bad = eps.filter(e => !e.game || e.seed === undefined || !Array.isArray(e.actions));
  if (bad.length) {
    return res.status(422).json({ error: `${bad.length} episodes missing game/seed/actions` });
  }

  const pid = String(session.participantId || 'anon').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const stamp = String(session.startedAt || new Date().toISOString()).replace(/[:.]/g, '-');
  const key = `${pid}-${stamp}`;

  try {
    const a = app();
    await getStorage(a).bucket().file(`study-sessions/${key}.json`).save(raw, {
      contentType: 'application/json',
      resumable: false,          // one shot; the payload is small
      metadata: { metadata: { participantId: pid, partial: String(session.partial !== false) } },
    });
    await getFirestore(a).collection('study_sessions').doc(key).set({
      ...summarize(session),
      blobPath: `study-sessions/${key}.json`,
      bytes: raw.length,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return res.status(200).json({ ok: true, key, partial: session.partial !== false });
  } catch (err) {
    // The harness falls back to a client-side download on any non-2xx, so a failure here
    // costs the participant nothing -- but log enough to diagnose it.
    console.error('session ingest failed', { key, bytes: raw.length, err: String(err) });
    return res.status(500).json({ error: 'storage write failed' });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
};
