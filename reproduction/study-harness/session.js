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

export function summarize(session) {
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
      // HUD affordances the agent's observation does not carry; see study-templates.mjs.
      livesShown: !!b.livesShown,
      roundTimerShown: !!b.roundTimerShown,
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
    // Sessions produced by the harness's debug menu. They only reach here if someone
    // ticked "allow upload"; flagged so analysis can drop them without guessing from
    // the participant id.
    debug: !!session.debug,
    // {study, session, fromUrl, urlPidRejected}. fromUrl false means the participant typed
    // their id rather than arriving with PROLIFIC_PID -- worth watching, and urlPidRejected
    // non-null means a param arrived that failed the shape check, which is how an
    // unsubstituted {{%PROLIFIC_PID%}} in the Prolific study URL shows up.
    prolific: session.source ?? null,
    pidTyped: session.pidTyped ?? null,
    pidEnteredAt: session.pidEnteredAt ?? null,
    pidMismatch: session.pidMismatch ?? null,
    // End-of-study answers. Field names match the lab's video-rating study
    // (end_study_feedback.demographics) so the two are comparable.
    //
    // Only the CODED answers are summarised. The free text (technicalIssues, confusingParts,
    // suggestions) stays in the Storage blob and is deliberately not copied into Firestore:
    // it is the one place a participant can type something identifying, and there is no
    // reason for it to live in the queryable index. 20 participants' worth of prose is read
    // by opening the blobs, not by querying.
    demographics: session.demographics ? {
      age: session.demographics.age ?? null,
      gender: session.demographics.gender ?? null,
      gamingExperience: session.demographics.gamingExperience ?? null,
      gamingFrequency: session.demographics.gamingFrequency ?? null,
      skipped: !!session.demographics.skipped,
    } : null,
    technicalIssueLevel: session.feedback?.technicalIssueLevel ?? null,
    // Whether there is prose to go and read, without reproducing it here.
    feedbackText: session.feedback ? {
      technicalIssues: !!session.feedback.technicalIssues,
      confusingParts: !!session.feedback.confusingParts,
      suggestions: !!session.feedback.suggestions,
    } : null,
    feedbackSkipped: session.feedback ? !!session.feedback.skipped : null,
    consentAt: session.consent?.at ?? null,
    doNotRecontact: !!session.consent?.doNotRecontact,
    quizAttempts: session.quiz?.attempts ?? null,
    // Which questions people actually fail, per attempt. The pilot needed 5 and 21 attempts and
    // the only clue as to why came from a feedback box; this makes it queryable.
    //
    // JOINED INTO STRINGS, and that is not cosmetic: Firestore cannot store an array whose
    // elements are arrays. Writing the raw [[0,1],[3],[]] threw inside the transaction, the
    // catch reported it as "storage write failed", and every participant who passed the quiz --
    // which is all of them -- got the upload-failure screen even though their blob had already
    // been written to Storage. Any nested array added to this summary will do the same.
    quizWrongByAttempt: session.quiz?.log?.map(a => (a.wrong || []).join(',')) ?? null,
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

  const partial = session.partial !== false;

  try {
    const a = app();
    const doc = getFirestore(a).collection('study_sessions').doc(key);

    // A COMPLETED record is never downgraded by a later partial one. The harness fires
    // checkpoints without awaiting them, so the checkpoint from the last block can arrive
    // after finish()'s authoritative upload; last-write-wins then stores a finished session
    // as partial:true with completionCode null, which is what you would query to decide whom
    // to pay. Observed in production before this guard existed. Answer 200 either way -- the
    // client must not retry, nothing is wrong, the write is simply redundant.
    if (partial) {
      const cur = await doc.get();
      if (cur.exists && cur.get('complete') === true) {
        return res.status(200).json({ ok: true, key, partial: true, ignored: 'already-complete' });
      }
    }

    await getStorage(a).bucket().file(`study-sessions/${key}.json`).save(raw, {
      contentType: 'application/json',
      resumable: false,          // one shot; the payload is small
      metadata: { metadata: { participantId: pid, partial: String(partial) } },
    });

    // Re-check inside a transaction: the read above closes the window that actually bit us,
    // but two writes still race in principle, and `complete` is the one field that must never
    // go backwards. The blob may end up the stale-but-valid checkpoint copy in that case; the
    // summary stays correct, which is what queries read.
    let ignored = false;
    await getFirestore(a).runTransaction(async (tx) => {
      const cur = await tx.get(doc);
      if (partial && cur.exists && cur.get('complete') === true) { ignored = true; return; }
      tx.set(doc, {
        ...summarize(session),
        blobPath: `study-sessions/${key}.json`,
        bytes: raw.length,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    });

    return res.status(200).json({ ok: true, key, partial, ...(ignored ? { ignored: 'already-complete' } : {}) });
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
