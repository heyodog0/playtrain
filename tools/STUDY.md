# Human baseline study harness

Collects the novice human baseline for the PlayTrain paper: 20 participants, 9 blocks
(8 games plus caveflyer at agent resolution), 100 seconds each. Produces a per-participant
JSON of frame-indexed actions, seeds and scores that can be replayed through the training
runtime to prove the human and the agent played the same environment.

Session shape: device check → consent → instructions → comprehension check → practice →
9 scored blocks → upload. About 15 minutes of play, ~22 minutes total.

```
just study-build                     # -> dist/study (static, self-contained)
just study-serve                     # play it yourself; saves to dist/study-sessions
just study-verify session.json       # acceptance test on collected data
just study-shots                     # layout at five display sizes
```

`study-serve` runs the capture endpoint on localhost as well as serving the site, so your own
playtest lands as a real session file and can be replay-verified exactly like a participant's.
It prints a per-block summary (rounds, mean, best, fps, canvas size, folded-frame rate) when a
session completes. Plain static hosting saves nothing — without an upload URL a session only
exists if the participant clicks download at the end.

## Why it is built this way

The participant plays through **PlayTrain's own runtime**, not a browser reimplementation
of it. `runtime/p5/p5-shim.mjs` and `runtime/p5/raster.mjs` are isomorphic by design, so
the study pages inline those exact files. There is no real p5.js, no CDN, no bundler and
no network access at play time — a built block is one self-contained HTML file of ~50 KB.

Everything `runtime/p5/game-env.mjs` does to make an agent episode reproducible, the block
page does too, in the same order:

| Step | `game-env.mjs` | block page |
|---|---|---|
| seed `Math.random` via mulberry32, *before* `resetGame` | `_setSeed` | ✅ |
| `resetFrameCount()` so frame phase is episode-relative | `reset` | ✅ |
| `resetGame(seed)` then one free `tick()` | `reset` | ✅ |
| `Discrete(8)` action table | `:42` | copied verbatim |
| `frameSkip` action-repeat, summed score delta | `step` | ✅ |
| `maxSteps` truncation, `WIN`/`EXIT`/`GAMEOVER` termination | `step` | ✅ |

Each block runs in its own iframe, giving every game a fresh global scope — the browser
equivalent of the one-game-per-process isolation the headless runtime gets from its
`gameLoaded` flag.

**If `game-env.mjs`'s `ACTIONS` table or reset order ever changes, `study-templates.mjs`
must change with it.** `just study-verify` is what catches that.

## Resolution and on-screen size

Humans play at the game's native canvas resolution. The 64×64 is not part of the game — it
is the observation pipeline (`getObsBuffer`), so a human at native resolution is playing the
game as authored, and the agent's small view is a stated design choice. The canvas is
CSS-upscaled for legibility; the rasterizer output is untouched.

Every study game rasterizes at **400×400**, which is too small to play comfortably, so it is
displayed at `canvasSize` (default **600 px**). That is a *fixed* size, not viewport-filling:
letting it grow would give a laptop participant a 700 px game and a QHD participant a 1200 px
one, so visual angle would differ between subjects for no reason. 600 px fits inside the
smallest display the pre-flight admits. The rendered size is logged per block as `canvasPx`,
so any shortfall is measurable rather than silent.

Native blocks scale fractionally with smoothing — these are rasterized vector shapes, not
pixel art, so bilinear beats the uneven pixel widths of a fractional nearest-neighbour
upscale. Obs blocks are the opposite: seeing the policy's exact pixels is the point, so they
get integer nearest-neighbour.

A window shorter than ~700 px prompts the participant to maximise, but **only when the screen
could actually give more** — otherwise an already-maximised 1366×768 laptop would be asked to
do something impossible. A "continue anyway" escape appears after six seconds so nobody can
get stuck, and the session records `smallWindow`.

## Video from recorded rounds

```
just study-video dist/study-sessions/<file>.json                  # every scored round, GIF
just study-video <file>.json --best                               # best round per game
just study-video <file>.json --game caveflyer --format mp4
```

Because the log is a seed plus a frame-indexed action list, and `verify-replay` proves those
reproduce the participant's score, the frames are not a reconstruction — they are the same
episode re-rendered. The renderer re-checks the score per episode and **refuses to write a
file if it drifts**, so a clip can never silently depict a different run than its filename
claims.

**GIF is the default and needs no dependencies.** The encoder is built in (GIF89a + LZW), and
because these games are flat-shaded it takes an exact palette: a real asteroids round is
**3–4 colours, lossless, 490 KB for 671 frames**. 20 fps (delay 5) is exact real time from
every third 60 fps frame, so a 33.3 s round plays back in 33.5 s.

**MP4 needs ffmpeg** (`brew install ffmpeg`) and is better for watching: h264, all 60 frames
per second, seekable. The same asteroids round is 2001 frames / 33.35 s at 1.3 MB. Add
`--scale 2` for an 800×800 render, which is easier on the eye and no larger. GIF is better
for the paper, slides and GitHub, where nothing has to be installed to view it.

Frames are captured at `--render-width` (240 for GIF, 400 for MP4) rather than the agent's
64×64. Render width is the real size knob, not a post-hoc downscale: the rasterizer draws the
same geometry at whatever resolution it is given, so a smaller width is a genuinely smaller
render with no resampling softness. Raster resolution does not affect the simulation —
`verify-replay` reproduces identical scores at 64 and at 400 — it only changes sampling
fineness.

Blocks rendered at agent resolution (`caveflyer@64`) are skipped: they rasterize different
geometry by design, so they are not replayable against the default config.

### Checking layout on displays you do not own

```
just study-shots              # caveflyer, all screens
just study-shots breakout
```

Renders every screen at five display sizes (1280×720 through 2560×1440) and writes a contact
sheet to `dist/study-shots/index.html`. Dev-only; needs playwright. For ad-hoc checks, Chrome
devtools' device toolbar (⌘⌥I, then the device icon) sets an arbitrary viewport.

`obsResBlocks` in the config adds a second block for a game rendered at 64×64, via the same
`setRasterRes` call `game-env.mjs` makes before `setup()` — so the geometry is rasterized
directly at 64 and the human sees pixel-for-pixel what the policy sees. It defaults to
`["caveflyer"]`, because caveflyer is the diagnostic case: its greedy checkpoint scores
*below* random (1.6 vs 1.0), and the two blocks together separate "the agent is bad" from
"64×64 destroys the information caveflyer needs". Set it to `[]` to drop the extra block
and 2.5 minutes per participant.

## The action space

The agent emits an integer 0–7. A keyboard produces 2⁵ = 32 states across the five keys the
games read. The harness quantizes: a **held-key recency stack** picks the most recently
pressed key still held, and SPACE merges only where legal (→ `LEFT_D` / `RIGHT_D`). This is
many-to-one — 24 of the 32 states fold onto one of the 8 — so the raw key bitmask is logged
per frame alongside the action, and every folded frame is counted as `foldedFrames`.

Quantizing rather than macro-expanding is deliberate. Expanding LEFT+UP into alternating
rotate/thrust frames would hand the human a capability the agent had to learn, and a strong
human caveflyer score would then say nothing about whether the agent's failure is the game
or the action space.

Five of the eight games never hit this. breakout, plunder and flappy_bird read only
LEFT/RIGHT/SPACE; coinrun (`:99`) and vvvvvv alias jump/flip onto SPACE so movement+action
is legal. The three that do are **seaquest, asteroids and caveflyer** — all three need a
combination `Discrete(8)` cannot express (swim-and-fire; rotate-and-thrust). Their per-game
`foldedFrames` rate is a direct measurement of how badly the action space fits them, and is
worth reporting.

`"actionMode": "unconstrained"` passes raw keys through instead. It is **not** the matched
condition and is excluded from replay verification; it exists only to quantify the
action-space cost on those three games if you decide to run that comparison.

## Frame rate

Blocks run at a fixed 60 steps per second, driven by a **draining accumulator** rather than
a "has 16.67 ms elapsed?" throttle. The naive throttle aliases against the display: on a
143 Hz screen rAF fires every 7 ms, the first tick past 16.67 ms lands at 21 ms, and the
block silently runs at 47.6 fps — a high-refresh participant would get ~20% fewer env steps
than a 60 Hz one. The accumulator yields 60 steps/s on any display rate. Catch-up is capped
at 3 frames per tick so a stall cannot spiral.

60 fps cannot be *forced* on a machine that will not deliver it, so the session shell
pre-flights instead: it measures achieved rAF rate for 1.5 s and refuses to run below 55,
and rejects touch-only devices and screens under 600 px (the desktop-with-a-keyboard
requirement). Per-block delivered frames and mean fps are still logged, so the pre-registered
exclusion can be applied on real data too.

Note that the shim's `millis()` is `frameCount * (1000/60)`, so game time is frame-derived.
A machine that cannot keep up runs the game in slow motion rather than desyncing — a clean
degradation, but still fewer steps in the same 150 s, which is why it is gated.

## Rounds, time-boxing, and the between-rounds summary

`maxSteps` is 2000 **frames**, matching the trainer default — neither trainer config overrides
it and `max_decisions` is `None` (`impala/train.py:70`). At `frameSkip: 1` that is 2000
decisions, i.e. **33.3 seconds** per episode. So a 100-second block is at least three rounds,
not one continuous game. Participants are told this explicitly, and the comprehension check
tests it: someone who believes one death ends the game will stop trying after their first
loss.

Blocks are bounded by **wall clock**, not frame count, because the paper plots the human as a
point on a wall-clock axis. The episode in progress when the timer fires is recorded with
`discarded: true` — cut off by the clock rather than played to a conclusion, so scoring it
would bias the block mean downward. Filter on that flag when analysing.

Between rounds the harness freezes on the final frame and shows what the round scored. This
is not decoration: a game can score and terminate on the *same frame* — `caveflyer.js:322`
gives `score += 10` and sets `gameState = 'WIN'` together — so without it the player never
sees the reward they earned, and "score as many points as you can" is an instruction with no
feedback behind it.

The freeze **pauses the block clock**, so summary time is not taken out of play time. The
block is a budget of actual gameplay; summaries are session overhead like the instructions.
Both numbers are reported (`playMs`, `pausedMs`, `wallMs`) so the choice is auditable and the
wall-clock point can be placed either way.

Freeze length is score-conditional and budgeted: 1.6 s after a scoring round, 0.6 s after a
zero, and 0.25 s once 20 s of summaries have accumulated. Without the budget a player who
dies instantly and repeatedly spends more of the session reading score cards than playing —
measured at 22 rounds in a 12-second block on flappy_bird, which the cap brings from 49 s of
wall time down to 26 s.

## Order and seeds

Scored blocks are shuffled per participant, seeded by a hash of the participant ID, so the
order is reproducible from the logged ID alone. Practice always runs first.

Episode *i* of every game uses **`seedBase + (i % seedCount)`** — a fixed pool of 100 seeds
(`90000..90099`) shared by every participant. Everyone meets the same levels in the same
order, and the agent can be evaluated on exactly that list for a matched comparison.

The modulo is load-bearing. A fast-dying player runs through far more episodes than the pool
holds — 22 rounds in a 12-second block was measured on flappy_bird, which extrapolates past
150 in a full block — and without the wrap they would wander into seeds nobody else ever saw.
Both `seed` and `seedIndex` are logged per episode.

## Practice

The warm-up must **not** be one of the scored games: practising one would hand it an
advantage the other seven never get. It is `pong` — in the 24-game suite but outside the
study set, universally familiar, and reading only UP/DOWN/SPACE so the quantizer is
effectively a no-op while the participant learns the harness. The builder refuses to start
if `practice.game` also appears in `games`.

## Delivery to participants

Built for Prolific, but nothing is Prolific-specific beyond the parameter names.

```
node tools/build-study.mjs \
  --upload     https://<host>/api/session \
  --completion https://app.prolific.com/submissions/complete?cc=<code>
```

The session shell reads `PROLIFIC_PID` from the query string (falling back to `pid` or
`participant`, then to manual entry) and hides the ID field when it is present — a typo
there is an unmatchable session and an unpayable participant. `STUDY_ID` and `SESSION_ID`
are recorded if passed.

The completion URL is followed **only after a successful upload**. Redirecting on a failed
upload would mark the participant complete on Prolific while their data is gone. On failure
the participant gets a download button and the completion code, so a bad network never
costs you a paid session.

### Checkpointing

The session is POSTed **after every block**, not only at the end, with `partial: true` until
the final upload. A participant who closes the tab at block 7 of 9 otherwise contributes
nothing at all — and you may still owe them payment. Checkpoints are fire-and-forget with
`keepalive`, so a failed one never interrupts play and a request in flight survives the page
closing.

The endpoint must therefore **key on `participantId` + `startedAt` and overwrite**, so the
checkpoints from one session collapse into a single progressively-more-complete record
instead of one file per block. `tools/study-serve.mjs` does exactly this and is the reference
for the production endpoint.

A block opened **directly** (e.g. `/block/asteroids/` while playtesting) has no session shell
to report to, so it posts itself as a one-block session with `standalone: true` and shows
whether the save succeeded. Without that, playtesting a single game silently discards it.

The upload endpoint is the only piece that is not a static file, and the only external
dependency in the whole harness. It needs to accept a cross-origin JSON POST of roughly
**0.5 MB** (measured: frame-indexed actions and key bitmasks for a full session) and write
it somewhere durable. Across 20 participants that is about 10 MB total.

**Collected sessions must not go in this repository** — the harness is code and belongs in
git, the participant data does not.

### What the payload actually needs

Per episode, `{game, seed, actions}` is the irreducible core: score, frame count and
termination are all reproducible from it (measured — 15/15 episodes rebuilt exactly). An
endpoint should validate those three fields are present and non-empty on receipt; anything
else can be recovered or lived without, and those cannot.

Everything else is uploaded anyway, for two reasons:

* **The reported `score`/`frames` are a checksum, not redundancy.** `verify-replay` compares
  them against the headless replay. Upload only seed+actions and you can still replay to get
  scores, but you can no longer *detect* that a participant's browser diverged from the
  runtime — their actions would silently replay to a different score than they saw.
* **Raw per-frame `keys`, `foldedFrames`, and the wall-clock fields are not derivable.** The
  quantizer is many-to-one, so held keys cannot be recovered from the action; and delivered
  fps and block wall time are properties of the participant's machine.

The full payload is ~0.46 MB/session against ~0.18 MB for the bare core — 9 MB versus 4 MB
across the whole study, which is not a reason to give up the integrity check.

## Which game sources

**The participant must play the same file the agent trained on.** There are two copies of
some games in this repo and they are not the same games:

| game | `examples/games/js` vs `games/js` |
|---|---|
| breakout | fixed ALE brick wall + 5 lives **vs** random rows + 3 lives — score 60 vs 90 on an identical seed/action replay |
| pong | 21-point ALE scoring **vs** `lives = 5` — score −12/600 frames vs −3/308 |
| seaquest | no death penalty **vs** `score -= 50` on death |
| the other six | identical |

`src/playtrain/runtime/env.py:22` sets `DEFAULT_GAMES_DIR` to the bundled
`_asset("examples/games/js")`, and the sbatch overrides point there too — so the trained
agents used **`examples/games/js`**, and that is what `build-study.mjs` and
`verify-replay.mjs` both default to. Override with `--games` or `PLAYTRAIN_GAMES_DIR` only
to match a run that did.

Note that replay verification cannot catch this on its own: if the browser and the headless
replay read the same wrong directory they agree with each other perfectly while both
measuring a game the agent never saw. Every build therefore writes
`dist/study/build-manifest.json` with the games directory and a SHA-256 prefix of each game
source, so what a participant actually played is auditable after the fact.

## Deploying (Vercel + Firebase)

`tools/build-site.mjs` is the Vercel build entry and emits both sites into one output:

```
dist/pages/          the game tester   -> /         (password-gated)
dist/pages/study/    the study         -> /study/   (public)
```

`middleware.js` exempts `/study` and `/api/session` from basic auth — participants arrive
from Prolific and cannot be given credentials. Everything else stays gated. The study is
built with `--upload /api/session`, same origin, so there is no CORS involved.

`api/session.js` is the ingest function. It splits storage deliberately:

* **Firebase Storage** `study-sessions/<pid>-<startedAt>.json` — the full payload
* **Firestore** `study_sessions/<pid>-<startedAt>` — a queryable summary (rounds, mean and
  max score, folded rate, fps, canvas size, quiz attempts, completion state)

The blob does *not* go in Firestore: a session is ~0.5 MB against a 1 MiB document ceiling,
and the ~81k frame-indexed action integers would blow the 20k index-entries-per-document
limit unless every array field were exempted from indexing. It overwrites by key, which is
what makes checkpointing work.

Required Vercel environment variables:

```
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY        service-account key (escaped \n are unescaped in the handler)
FIREBASE_STORAGE_BUCKET     e.g. <project>.firebasestorage.app
STUDY_INGEST_TOKEN          optional; if set, requests must send X-Study-Token
STUDY_COMPLETION_URL        optional; Prolific completion redirect
```

Unlike the lab's video-rating study, this writes server-side with a service account rather
than client-side with permissive rules. That keeps the Firebase SDK out of the participant
page — which is what preserves the self-contained, zero-external-request property the
correctness argument depends on — and means the storage bucket needs no public write rule.

## Before running it for real

- [ ] Verify the consent text against the approved protocol — see the header of
      `study-screens.mjs`. Compensation rate and duration come from `study-config.json`;
      the questionnaire and deception clauses from the source study were removed because
      they do not apply here.
- [ ] Confirm the games directory matches the runs behind `tab:eval` — check
      `build-manifest.json` against the run cards. This is the one error replay
      verification cannot detect.
- [ ] Set the Firebase env vars in Vercel and POST one test session end to end.
- [ ] Add Firestore/Storage rules denying public reads of `study_sessions` and
      `study-sessions/` — the summary contains Prolific IDs.
- [ ] Walk the whole session yourself end to end with `just study-serve`.
- [ ] Pre-register: the fps exclusion threshold, the keypress-count exclusion, and the
      `discarded`-episode rule.
- [ ] Confirm the IRB covers the final protocol.
