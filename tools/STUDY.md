# Human baseline study harness

Collects the novice human baseline for the PlayTrain paper: 20 participants, 9 blocks
(8 games plus caveflyer at agent resolution), 100 seconds each. Produces a per-participant
JSON of frame-indexed actions, seeds and scores that can be replayed through the training
runtime to prove the human and the agent played the same environment.

Session shape: device check → consent → instructions → comprehension check → (Prolific ID, only
if the link did not carry one) → practice → 9 scored blocks → upload. About 15 minutes of play,
~22 minutes total.

Walking that by hand takes 22 minutes, so the shell has a debug menu on
`ctrl`+`shift`+`alt`+`D` that jumps to any screen or block and can run the whole session with
10-second blocks — see [Debug menu](#debug-menu).

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

The participant plays through **PlayTrain's own JS runtime**, not a browser reimplementation
of it. `runtime/p5/p5-shim.mjs` and `runtime/p5/raster.mjs` are isomorphic by design, so
the study pages inline those exact files. There is no real p5.js, no CDN, no bundler and
no network access at play time — a built block is one self-contained HTML file of ~50 KB.

### …but the agent does not run that runtime, so read this before claiming identity

The canonical training backend is **QuickJS + the Rust rasterizer**, not node + the JS shim:
`src/playtrain/runtime/__init__.py:14` binds `GameEnv = QuickJSEnv`, and the rollout path is
`NativeVecEnv` (`native/build/libqjs_vec`, in-process C++ threadpool), which
`benchmarks/README.md:22` labels the production training path at ~176k steps/s against ~15k for
the legacy node backend. The human therefore does **not** execute the same code as the agent.
Three distinct implementations are involved:

| | game code | p5 layer | rasterizer | JS engine |
|---|---|---|---|---|
| participant (browser) | the game file, unchanged | `p5-shim.mjs` | `raster.mjs` (pure JS) | the participant's browser |
| headless JS (replay, `verify-replay`) | same file | `p5-shim.mjs` | `rasterizer.wasm` (Rust) | node / V8 |
| agent (training) | same file | `native/runtime/p5.cpp` | same Rust crate, native | QuickJS |

So the honest claim is **not** "identity by construction" but "the same game source on three
runtimes whose equivalence is measured". Measured, on the nine study games at the study's own
seed base, both links bit-exact:

```
just study-parity      # both checks below
```

* **pure-JS rasterizer (what the browser uses) vs the Rust rasterizer**: identical per-step
  64×64 observation hashes, 9/9 games × 400 steps at seed 90000. Run by re-tracing
  `native/reference_trace.mjs` under `PLAYTRAIN_RASTERIZER=js` and `=wasm` and diffing.
* **node+V8+wasm vs native QuickJS+Rust**: `native/gate_qjs.sh`, 9/9 games × seeds
  90000/90001 × 1200 steps, bit-exact reward/term/score/lives/state plus obs hash.

**The remaining variable is the JS engine, and it checks out.** The gate above proves V8 ≡
QuickJS and says nothing about JavaScriptCore (Safari) or SpiderMonkey (Firefox), where a
last-bit difference in `Math.sin`/`pow` moves a sprite, which moves a collision, which moves a
score. Not hypothetical here: `native/build_qjs.sh:11-18` records `analogen_asteroids` diverging
on `Math.sin` until fdlibm was vendored, and `asteroids` is in the study set — and the games do
call `Math.sin`/`cos`/`atan2` directly (pong, breakout, caveflyer, asteroids), with the shim
forwarding straight to the engine's implementations (`p5-shim.mjs:403-405`).

```
just study-browsers            # chromium + firefox + webkit, 2000 steps
just study-browsers-selftest   # prove the check can fail
```

`tools/study-browser-check.mjs` runs **one trace program, as a single source string**, unchanged
in node and in all three engines — driven by a fixed action formula rather than keystrokes, so
nothing depends on timing — and compares score/lives/state plus a hash of the whole rasterized
frame at every step. Result: **9/9 games × 2000 steps byte-identical in Chromium 151, Firefox 153
and WebKit 26.5.** 2000 steps is a full `maxSteps` episode, which is the unit that has to hold:
episodes reset state, so a difference cannot accumulate across them.

Two caveats worth carrying, both discovered by getting them wrong first:

* **The node reference must run one game per child process.** `p5-shim` keeps game state in a
  single global scope — the reason the real runtime is one-game-per-process and the study gives
  every block its own iframe. An earlier version of this tool traced all nine games in one node
  process; globals leaked between games and it reported three games diverging in *every* browser.
  The browsers were right and the harness was wrong.
* **Know the test's sensitivity before trusting a green run.** Perturbing `Math.sin` by ε in the
  browser is caught at ε≥1e-6 on asteroids and ε≥1e-3 across the board within 600 steps, but
  **not** at 1e-9 or 1e-12 — a sub-pixel difference rounds to the same pixel until it amplifies.
  Real engine differences are ~1 ULP (≈1e-16 relative), so "identical at 2000 steps" means no
  difference *surfaces within an episode*, not that the engines are provably bitwise equal for
  all inputs. Note also that `x*(1+2^-52)` is useless as a perturbation: it rounds back to `x`
  over much of the mantissa range and silently tests nothing.

`verify-replay` remains the per-session backstop: it recomputes every session's scores from the
logged actions on V8, so any participant whose browser did diverge shows up as a replay mismatch
rather than as clean data.

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

The card is a **dark scrim over the frozen frame with the score on its own panel**. It began as
an opaque white card, which was a mistake: every game in the study
draws a near-black background (`background(0)`…`background(30)`), so each round boundary was a
black → white → black flash of the whole canvas — measured as a **+225 to +244 step in mean
canvas luminance** out of 255. With cards shrinking to 250 ms under the freeze budget and 22
rounds in 12 s measured on flappy_bird, that is a strobe, and it destroys dark adaptation
immediately before the next round starts — plausibly costing performance on exactly the fast
games where it fires most often. The scrim version measures **−11 to +3** instead. Text contrast
was the original argument for opacity; putting the text on a fixed-colour panel settles that,
since a scrim can only darken what is behind it. Leaving the final frame faintly visible is a
bonus: the player can see the state they died in.

**Only the dimming animates — the score panel never fades.** Cross-fading the whole overlay put
a half-strength number over an undimmed frame at the midpoint of every transition, which reads
as a ghost rather than a transition, and two details made it worse: a fixed 140 ms fade was most
of the life of a budget-shrunk 250 ms card (so those cards never reached full strength at all),
and fading out on unfreeze ran the fade over the resumed, undimmed next round. Now the scrim
ramps over `min(90 ms, cardMs / 6)` and finishes *inside* the freeze window, while the panel is
at full opacity from the first frame. Measured over 20 consecutive flappy_bird cards: every card
reaches full strength, and each is fully opaque for 75% of its life.

The freeze **pauses the block clock**, so summary time is not taken out of play time. The
block is a budget of actual gameplay; summaries are session overhead like the instructions.
Both numbers are reported (`playMs`, `pausedMs`, `wallMs`) so the choice is auditable and the
wall-clock point can be placed either way.

Freeze length is score-conditional and budgeted: 1.6 s after a scoring round, 0.6 s after a
zero, and 0.25 s once 20 s of summaries have accumulated. Without the budget a player who
dies instantly and repeatedly spends more of the session reading score cards than playing —
measured at 22 rounds in a 12-second block on flappy_bird, which the cap brings from 49 s of
wall time down to 26 s.

### What the HUD shows, and what it deliberately does not

The HUD carries round number, current score, best score so far, and the block timer. Two
additions were considered; one is in and one is off by default, and the difference is whether
it hands the human something the agent's observation cannot contain.

**Lives are shown for `seaquest` and `caveflyer` only** (`hudLives` in study-config.json).
Every game exposes `lives` in `getGameState()`, but those two are the only ones that never
*draw* it: breakout, asteroids, coinrun and vvvvvv all render a lives row on the canvas,
plunder and flappy_bird are single-life, and pong's `lives` field is the ALE points-to-21
counter rather than lives at all — a readout there would be actively wrong. So this is not a
new affordance, it is closing a two-game gap where a participant could otherwise lose three
times without ever learning the game had lives, on games where every other game in the set
shows them. Rendered as pips (`●●○`) rather than a number, because it is read peripherally
while the eyes stay on the game, and read from the same `getGameState()` the environment steps
on, so it cannot drift from the state the agent is scored against.

It is still an asymmetry — for those two games the human sees a quantity absent from the 64×64
observation — so every block records `livesShown`, and it surfaces in the Firestore summary.

**A per-round countdown is off** (`showRoundTimer`). `maxSteps` truncation is a harness
artifact rather than a rule of the game, and nothing in the agent's observation encodes
remaining steps. A visible countdown would let the human spend the last second of every round
on risk the policy cannot know to take — inflating precisely the score being compared, and
worst on the games where rounds most often truncate rather than end. The instructions already
state that rounds end after about 33 seconds, which prevents confusion without making the
artifact exploitable. Set it to `'practice'` to show it in the unscored warm-up only, where
teaching the round structure is the point, or `true` to accept the trade-off knowingly;
`roundTimerShown` is recorded per block either way.

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

### The participant ID, both ways

Paste this as the study URL in Prolific:

```
https://playtrain-study.vercel.app/study/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
```

Prolific substitutes the real values, the harness takes `PROLIFIC_PID` and **skips the ID
screen entirely**. The ID is the one field in a session that can be wrong in a way nothing
downstream detects or repairs — a typo is an unmatchable session and a participant you owe
payment anyway — so not asking beats asking.

When the param is missing the participant **pastes their ID** instead. Params do get lost: a
link copied into another browser, or a direct link sent to a pilot participant. Without that
fallback it is a dead end mid-study. Whitespace is stripped (a copy off the Prolific page
routinely carries a trailing newline), and validation is deliberately loose — 5–64 alphanumeric
characters, with a second click required if the length is not the usual 24. Hard-rejecting an
unexpected shape would strand someone you still have to pay; the exact string is stored either
way, so anything odd can be reconciled by hand.

The param is **shape-checked before it is trusted**, which is not paranoia. Save the Prolific
study URL with the placeholder unsubstituted and every participant arrives with a literal
`{{%PROLIFIC_PID%}}` — without the check, every session in the study files under that one id.
A param that fails the check is recorded as `prolific.urlPidRejected` and the participant is
asked to paste, so the misconfiguration is visible in the first session's summary and
recoverable, rather than silent and total.

Recorded per session: `prolific.{study, session, fromUrl, urlPidRejected}`, plus `pidTyped`
and `pidEnteredAt` when it was typed, and `pidMismatch` if a typed id ever coexists with a
different one from the URL. **Query `fromUrl: false` after launch** — a run of typed ids means
the Prolific link lost its parameters.

The completion URL is followed **only after a successful upload**. Redirecting on a failed
upload would mark the participant complete on Prolific while their data is gone. On failure
the participant gets a download button and the completion code, so a bad network never
costs you a paid session.

### End-of-study questions

Field names match the lab's video-rating study — Firestore `end_study_feedback` there holds
`demographics{age,gender,gamingExperience,gamingFrequency}` and
`feedback{technicalIssues,confusingParts,suggestions}` — so the two studies are comparable and
the questions are ones the protocol has already been through the IRB with. That study's
`funCriteria` item is dropped; it was about what makes a video fun to watch.

`gamingExperience` and `gamingFrequency` are not filler. The whole claim is a **novice** human
baseline, so "how much do you play games" is the covariate a reviewer asks about first, and the
one that shows the baseline is not dominated by practised players. It is also the pair Prolific's
own demographics do **not** reliably give you.

**Ordering is load-bearing.** The complete session is uploaded *before* the questions are shown:

```
blocks done -> upload complete session -> questions -> upload again with answers -> outro -> Prolific
```

A participant who closes the tab on the questions has already contributed a complete, payable
session; the only thing lost is the feedback. The reverse order would put an entire session
behind a screen nobody is obliged to fill in. Verified on all four paths — answered, declined,
abandoned, and submitted empty.

**The demographics require a response; "Prefer not to say" is one of the responses.** Fully
optional was too weak: at n=20 a few silent skips is double-digit missingness on the only
covariates the analysis has, and most of it would be accidental — people click Skip because a
Skip button is there. Compulsory was not an option either: the consent form promises that
refusal carries "no loss of benefits", and a question that gates payment would contradict it (as
would Prolific's own rules). So there is no Skip button over the demographics and no disabled
Submit — one click on the decline option satisfies the check. The free-text feedback stays fully
optional, because prose cannot be usefully compelled.

Age doubles as the eligibility cross-check against the 18-or-over attestation in the consent
form. **Decide before launch what happens if someone reports being under 18** — presumably
exclude the data and pay them anyway. An out-of-range entry is stored as
`out-of-range: <raw>` rather than dropped, so a typo stays visible instead of looking like a
refusal.

Only the *coded* answers reach the Firestore summary. The three free-text fields stay in the
Storage blob and are deliberately not copied into the queryable index: free text is the one place
a participant can type something identifying, and 20 participants' worth of prose is read by
opening blobs, not by querying. The summary carries `demographics`, `technicalIssueLevel`, and
`feedbackText.{technicalIssues,confusingParts,suggestions}` as booleans saying whether there is
prose to go and read.

PlayTrain does **not** write into the video-rating study's `end_study_feedback` collection. The
answers live on the session record, so there is one row per participant and no chance of one
study's analysis picking up the other's rows.

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

Overwriting alone is not enough, and this bit in production. Checkpoints are not awaited, so
the one fired after the **last** block can land *after* `finish()`'s authoritative upload — a
completed session was stored as `partial: true` with `completionCode: null`, which is exactly
the field you would query to decide whom to pay. Two defences, both needed:

* the harness **skips the checkpoint after the final block** (`finish()` is about to POST the
  same blocks anyway, so it bought nothing);
* the endpoint **never downgrades a completed record** — a `partial` write against a doc
  already marked `complete` is answered `200 {ignored: "already-complete"}` and dropped, so a
  retry or a stray keepalive cannot walk the record backwards. It answers 200 rather than an
  error because nothing is wrong and the client must not retry.

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

## Debug menu

Walking the participant flow by hand costs 22 minutes, so the session shell carries a debug
menu. It is **in every build** — gating it behind a build flag would mean the thing you test
is not the thing you deploy — and opens on a key combo rather than a URL parameter, so there
is no guessable `?debug=1` that lets a participant skip the comprehension check.

| combo | where | what |
|---|---|---|
| `ctrl`+`shift`+`alt`+`D` | anywhere, including mid-block | open/close the menu (`esc` also closes) |
| `ctrl`+`shift`+`alt`+`S` | inside a block | end that block now |

Keyboard focus sits inside the block iframe while a game runs, so the block page handles both
combos itself and forwards `D` up to the shell over `postMessage`.

The menu jumps straight to any screen (device check, rejection, consent, any instruction page,
quiz, Prolific ID, outro), launches any single block, or runs the whole session — with **short
blocks** (default 10 s, editable) and optional **auto-start**, which turns a 22-minute
walkthrough into about two minutes. It also dumps or downloads the session JSON as collected,
with the frame-indexed integer arrays abbreviated to their lengths so the record is readable.

Short and skippable blocks are driven by a `#dbg=<seconds>` hash the shell appends to the
iframe URL, and the block page **only** honours it when that hash is present. A participant
never gets it, so neither shortening nor skipping is reachable from the participant's path.

**Opening the menu at all** stamps `debug: true` on the session and **suppresses every
upload** from then on, including the per-block checkpoints and the Prolific completion
redirect, so a walkthrough cannot land in the collected data or mark a submission complete.
Deciding that per-button would be a trap — peek at the menu, then walk the real flow, and you
would silently be writing a fake participant into the data. Tick *allow upload* to exercise
the endpoint on purpose; the record still carries `debug: true`, and
`api/session.js` surfaces that flag in the Firestore summary so those rows can be dropped
without inferring anything from the participant ID.

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

```
just study-audit examples/games/js                       # a checkout on this machine
just study-audit --ref 8e38a6e                           # a commit in this repo
just study-audit --remote-cmd /path/on/cluster/games/js   # emits a one-liner; feed its output to --hashes
just study-audit --hashes cluster-hashes.txt             # audit a machine you cannot reach from here
```

Non-zero exit on any mismatch, so it can gate a launch. It also warns when the working tree has
moved on from the shipped build — i.e. the deployed study is serving games you have since edited.

**Verified for this study (2026-08-05).** The runs read
`/n/holylabs/LABS/gershman_lab/Users/rtruong/playtrain/examples/games/js` — that is what
`native_games_dir: "../playtrain/examples/games/js"` resolves to in the analogen-jaxbench run
configs — at commit `8e38a6e`, and all nine games hash identically to the shipped build.

**How close this was.** `vvvvvv`'s scoring was redesigned — progress-based plus a 1000-point win
bonus, replaced by +50 per collectible and −50 on death — at **15:08:18** on 2026-07-25. The three
vvvvvv runs started at **15:43** the same day, 35 minutes later, so they read the current file
(the logged returns of ~122–133 at `len=2000` match the new scale, not the old one). Half an hour
the other way and the agent and human numbers would have been on different reward scales, with
nothing in either pipeline able to say so. Two copies of the old file still exist on the cluster
(`node-gym-git`, hash `81cb6c93`), and `analogen-jaxbench/games/js` holds a third copy of the set
that the configs do *not* read — so an audit that guesses at the directory can easily be right by
accident. Always audit the directory the run config names.

## Deploying (Vercel + Firebase)

`tools/build-site.mjs` is the Vercel build entry and emits both sites into one output:

```
dist/pages/          the game tester   -> /         (password-gated)
dist/pages/study/    the study         -> /study/   (public)
```

`middleware.js` exempts `/study` and `/api/session` from basic auth — participants arrive
from Prolific and cannot be given credentials. Everything else stays gated. The study is
built with `--upload /api/session/`, same origin, so there is no CORS involved.

The **trailing slash on that upload URL is load-bearing**: `vercel.json` sets
`trailingSlash: true`, so a POST to `/api/session` answers 308 to `/api/session/`. Browsers do
re-POST on a 308, so it works either way, but every checkpoint would pay a redirect — and the
final one is a `keepalive` fetch racing the tab closing, which is not a place to spend a round
trip.

`vercel.json` installs with **`pnpm install --frozen-lockfile`**. Keep `pnpm-lock.yaml` in step
with `package.json` (`pnpm install --lockfile-only` after any dependency change) or the
serverless build fails with `ERR_PNPM_OUTDATED_LOCKFILE` — the static site builds fine and only
the ingest function goes missing, which is a confusing way to find out. Do not switch the
install back to npm: the two package managers fight over the cached `node_modules` and the
second deploy dies on `npm error Cannot read properties of null (reading 'name')`.

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

### The live deployment

| | |
|---|---|
| participant link | **https://playtrain-study.vercel.app/study/** |
| game tester | https://playtrain-study.vercel.app/ — basic auth, user `playtest` |
| Vercel project | `playtrain-study`, linked to `github.com/heyodog0/playtrain` (pushes to `main` auto-deploy) |
| Firebase project | `ai-gamestore-study-1901` (shared with the video-rating study; PlayTrain uses its own collection and bucket prefix) |
| bucket | `ai-gamestore-study-1901.firebasestorage.app`, US-EAST1 |

**Firebase Storage requires the Blaze plan.** That project sat on Spark, where bucket creation
fails with `The billing account for the owning project is disabled in state absent` while
*Firestore still works* — so the handler's Storage-then-Firestore order meant every upload
500'd and nothing persisted at all. The Firebase SDK config reports a `storageBucket` name even
when no bucket exists, so trust `bucket().exists()`, not the config. At 20 sessions × ~0.5 MB
the storage bill is nil; Blaze is needed for the capability, not the volume.

Verified end to end on the live deployment: a full session (consent → instructions → quiz →
pasted Prolific ID → all 10 blocks) uploaded 9 checkpoints plus the final record, landed in
both stores as `complete: true` with its completion code, and the downloaded blob passed
`verify-replay` at **18/18 episodes reproducing headlessly**.

## Before running it for real

- [ ] Verify the consent text against the approved protocol — see the header of
      `study-screens.mjs`. Compensation rate and duration come from `study-config.json`;
      the questionnaire and deception clauses from the source study were removed because
      they do not apply here.
- [ ] Confirm the games directory matches the runs behind `tab:eval` — check
      `build-manifest.json` against the run cards. This is the one error replay
      verification cannot detect.
- [x] Set the Firebase env vars in Vercel and POST one test session end to end.
- [ ] Add Firestore/Storage rules denying public reads of `study_sessions` and
      `study-sessions/` — the summary contains Prolific IDs. The ingest path does not need
      them (it writes with a service account, which bypasses rules), so this is purely about
      who can *read*; check what the project's existing rules already allow, since the
      video-rating study shares it.
- [ ] Point `STUDY_COMPLETION_URL` at the real Prolific completion link once the study exists.
      Without it participants see a completion code instead of being redirected.
- [ ] Walk the whole session yourself end to end with `just study-serve`.
- [ ] Confirm the protocol covers the end-of-study questions. The items match the video-rating
      study's, so it is likely already covered, but that study's consent text is what is shown
      here and the instructions now state plainly that age, gender and gaming habits are asked.
- [ ] Decide the under-18 rule before launch: age is asked, so a response below 18 contradicts
      the consent attestation. Exclude the data, pay them anyway, is the assumption.
- [ ] Check what Prolific's export actually returns for your account (its field is historically
      *Sex*, not gender identity) and decide whether the in-study age/gender items are the
      record or the cross-check.
- [ ] Pre-register: the fps exclusion threshold, the keypress-count exclusion, and the
      `discarded`-episode rule.
- [ ] Confirm the IRB covers the final protocol.
