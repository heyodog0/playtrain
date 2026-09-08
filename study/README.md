# Human study harness

The browser harness that collected the paper's human baseline: 20 participants, 8 games,
100 seconds each. It builds to a static site with no server, no bundler and no network
access at play time, because participants play through PlayTrain's own JavaScript runtime
rather than a browser reimplementation of it.

Every session records, per episode, a seed and a frame-indexed list of `Discrete(8)`
actions. Feeding that seed and those actions back through the headless environment has to
reproduce the score exactly. That is what makes human and agent numbers comparable, and
`verify-replay.mjs` is the check.

## Running it

Requires Node 18 or newer. No install step.

```console
$ node study/study-serve.mjs
```

Builds the site and serves it on `http://localhost:8080`. Play through it and the session
is saved to `dist/study-sessions/`. Then replay it:

```console
$ node study/verify-replay.mjs dist/study-sessions/<file>.json
```

The full session is about 22 minutes. Press `ctrl`+`shift`+`alt`+`D` for a debug menu that
jumps to any screen and can run the whole thing with 10-second blocks.

To build the static site without serving it:

```console
$ node study/build-study.mjs --out dist/study
```

The output is 11 self-contained HTML files, about 1.8 MB, and works on any static host.
Each `block/<game>/index.html` also runs standalone, which is the shortest way to show
someone one game without the consent and instruction screens.

## Re-rendering a recorded episode

```console
$ gunzip -c reproduction/data/study/p11.json.gz > p11.json
$ node study/replay-video.mjs p11.json --game breakout --best
```

Writes a GIF of that participant's best breakout round, replayed through the headless
environment from their logged actions. Because the actions reproduce the score exactly,
this is the same episode re-rendered rather than a reconstruction. `--format mp4` needs
ffmpeg on the path.

## Before collecting data from anyone

**The consent text in `study-screens.mjs` is a template, not an approved protocol.** It is
the wording this study ran, with every institution-specific field removed. Replace it with
text your own ethics board has approved.

The blank fields are in the `study` block of `study-config.json`: compensation rate,
contact name and email, principal investigator name and email, and the review board's
name, phone and email. They render as visible `[placeholders]` while unset, and
`build-study.mjs` refuses to build with `--upload` until all of them are filled in, so a
study cannot be deployed for collection with placeholder ethics text.

`--upload <url>` is what makes sessions POST to a server. Without it a participant's
session only exists if they click download at the end.

## Configuration

`study-config.json` holds the protocol: which games, block length, frame skip, seeds, and
the action mode. `actionMode: "quantized"` restricts the human to the agent's exact
`Discrete(8)` through a held-key recency stack, which is the matched condition.
`"unconstrained"` passes raw keys through and exists only to measure what the action space
costs. Every field carries a `_comment` explaining why it holds the value it does.

## Checking the environment is the same one the agent saw

Four claims, each with its own check.

| check | claim |
|---|---|
| `node study/verify-replay.mjs <session>` | The browser and the headless runtime compute the same scores from the same actions. |
| `node study/study-audit.mjs examples/games/js` | The participants played the same game files the agents trained on. |
| `bash study/study-parity.sh` | The pure-JS rasterizer, the Rust rasterizer and the native QuickJS backend agree bit for bit. |
| `node study/study-browser-check.mjs` | Chromium, Firefox and WebKit produce identical traces, so the participant's browser does not change the environment. |

`study-parity.sh` needs the native host built (`bash native/build_qjs.sh`) for its second
link and reports that link as skipped otherwise. `study-browser-check.mjs` needs
Playwright browsers installed.

The audit is the one error replay verification cannot catch. If the browser and the
headless runtime both read a game the agent never saw, they agree with each other
perfectly while measuring the wrong thing.

## Which catalog

`build-study.mjs` and `verify-replay.mjs` both default to `examples/games/js`, which is
what `GameEnv` loads and what the training runs used. Override with `--games` only to match
a run that set `PLAYTRAIN_GAMES_DIR`.

Which revision of a game a session is replayed against decides whether it reproduces, so
`study-manifest.json` records the nine source hashes the paper's sessions were played on.
All 1382 episodes across the 20 sessions reproduce against exactly those hashes. That file
is what `study-audit.mjs` compares to when there is no local build.

This has already caught one drift. `vvvvvv` gained a terminal bonus of 500 points on
2026-09-07, after the sessions were collected, which made 45 of the 1382 episodes stop
reproducing while changing nothing else that was visible. The bonus is a deliberate
improvement and the shipped catalog keeps it, so the study-time source is pinned in
`study/games-at-study-time/` instead. `verify-replay.mjs` uses a pinned source in place of
the shipped one and says so on every run, and the audit reports the game as `pinned`
rather than as a mismatch. Pass `--no-pins` to replay against the shipped catalog, which
is the right thing when you are asking how the current game scores rather than checking
the recorded data.

The consequence is worth stating plainly: `vvvvvv` in this repo no longer scores the way
it did for the participants, so a `vvvvvv` agent retrained from the shipped catalog will
not reproduce the published return. Every other game is unchanged.

Nothing but the audit detects an error of this shape. Replay verification passes on either
revision as long as both sides use the same one.

## Data

The 20 collected sessions are in `reproduction/data/study/`, anonymized and gzipped.
`reproduction/reproduce.sh` draws the wall-clock figure from them.
