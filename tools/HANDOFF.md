# Handoff — where the human data comes from, and how it is plotted

Full design rationale is in [STUDY.md](STUDY.md). This page is only: where the data is, how to
get it, how it is currently plotted, and what is missing.

## Where the data is

| | |
|---|---|
| study link | https://playtrain-study.vercel.app/study/ (public; tester at `/` is behind basic auth) |
| deploy | Vercel project `playtrain-study`, auto-deploys on push to `main`. **Never `vercel deploy` from a laptop** — git is the only production path |
| ingest | `api/session.js` → `POST /api/session/` (trailing slash matters, see STUDY.md) |
| full payloads | Firebase Storage `study-sessions/<pid>-<startedAt>.json` — every frame-indexed action. **This is the data** |
| queryable summary | Firestore `study_sessions/<pid>-<startedAt>` — scores, fps, canvas size, quiz attempts, demographics. No free text by design |
| Firebase project | `ai-gamestore-study-1901` (shared with the lab's video-rating study; PlayTrain only ever touches `study_sessions` and `study-sessions/`) |

A session is written **after every block** (`partial: true`) and once at the end
(`partial: false`), so a dropout still leaves everything up to their last completed block.

## Get it

```sh
export FIREBASE_SERVICE_ACCOUNT=~/path/to/serviceAccountKey.json   # Firebase console → Project settings → Service accounts
pnpm install                                    # firebase-admin

just study-pull                                 # blobs → dist/study-data/ (gitignored)
just study-stats                                # the numbers behind the figures
just study-verify dist/study-data/<file>.json   # does this session replay identically?
```

`study-stats` prints every session it **excluded** and why (debug runs, standalone playtests,
endpoint probes, incompletes). Three leftover probe blobs once pulled breakout's mean from 208 to
152 before anyone noticed, so an empty exclusion list is itself a claim worth reading.

**Collected sessions must not be committed.** `dist/` is gitignored; the harness belongs in git,
the participant data does not.

## Is the data trustworthy

Four checks, all runnable, all currently passing:

```sh
just study-audit examples/games/js   # did participants play the games the agents trained on?
just study-parity                    # browser rasterizer ≡ Rust rasterizer ≡ QuickJS training backend
just study-browsers                  # Chromium/Firefox/WebKit produce byte-identical play
just study-verify <session>.json     # this participant's actions replay to the same scores
```

`study-audit` is the one that matters most: it is the only error replay verification structurally
cannot catch — if the browser and the replay read the same *wrong* game they agree perfectly while
both measuring something the agent never saw.

## How it is plotted

Two statistics, computed by `tools/study-stats.mjs`:

- **per-game mean** — each participant's block mean (excluding `discarded` episodes, which the
  block timer cut off), then pooled mean + 95% CI across participants.
- **within-block change** — each participant's first third of rounds vs their last third.
  Descriptive only: rounds are not a fixed budget, so improving survives longer and changes your
  own round count.

**The constraint that decides every figure:** per-game scores span three orders of magnitude
(plunder ~5, asteroids ~470). No shared axis holds them, so each game gets its own axis or the
scores get normalised. A single bar chart of all eight raw means shows asteroids and vvvvvv only.

Four candidate figures, rendered from the real data:
**https://claude.ai/code/artifact/48d37c55-bf1c-4332-b4ee-8d2e96adc4e4**

| | figure | status |
|---|---|---|
| 1 | per-game baseline, one dot per participant, small multiples | ready, needs no agent data |
| 2 | within-block learning, diverging bars | ready — 7 of 8 games improve inside 100 s |
| 3 | agent score normalised to human mean, log axis | **needs agent scores** |
| 4 | human band over the agent's training curve | **needs agent training curves** |

## What is missing

- **Agent scores per game on seed pool 90000–90099** — figures 3 and 4 cannot be drawn without
  them. Two decisions come with them: normalise by human *mean* or *best*, and whether to subtract
  a random-play floor (matters for caveflyer, where the greedy checkpoint scores below random).
- **Pre-registered exclusion rules.** Decide before the remaining sessions land: canvas size,
  fps floor, quiz-attempt cap, replay mismatch, the `discarded`-episode rule.
- **flappy_bird changed on 2026-08-05** (bird now held until the first flap; hash
  `85c98a0106fb45fe` → `69371176e8603dbf`). The agent needs a flappy retrain, `study-audit` fails
  until it happens, and the first ten sessions' flappy blocks are on the old build — do not pool
  them. Their other seven games are unaffected.
- **Known non-uniformities in the first two sessions** — `canvasPx` 561 and 600 before the 520 px
  fix, and one participant needing 21 comprehension attempts (a harness fault, since fixed).
  Both are in the data; `study-stats` warns when canvas sizes differ.
- **Sample composition, not size.** No participant so far reports being a non-gamer. The claim
  that holds is *no prior exposure to these games* (true by construction), not *novice players*.
