# Rollout clips

The page uses `<game>.mp4`, rendered straight from the replay at the game's own
60fps. The `<game>.gif` beside it is the older 14fps encode, kept in the repo for
slides and the paper but no longer shipped.

Safari would not animate the GIFs, though they are spec-clean (global colour
table, LZW min code size >= 2, loop block ahead of the first frame) and Chrome
played them. Video works there, and unlike an animated image its playback is
observable from script, so a browser check can prove motion instead of inferring
it from screenshots.

Clips run the WHOLE episode: `--max-frames 2000` matches the 2000-step episode
cap, so nothing is cut mid-run. They were 600 frames (10s of a 33s episode, about
half the run on average) until 2026-09-07. Website clips use `--crf 28`; the
default 18 is near-lossless and right for the paper, but at full length it costs
~2.9M for a busy game like qbert.v2 against ~0.4M at 28. Note 28 of 64 episodes
reach the 2000-step cap, so those clips end at truncation, not at a death —
showing longer needs a fresh rollout with a higher cap.

Render video with `--format mp4`, never by converting a GIF: GIF delays are whole
centiseconds, so a 14fps clip is really 100/7 = 14.286fps, and re-encoding that
to 15fps duplicates about every fourteenth frame, which reads as judder. Straight
from the replay there is no resampling at all, and 60fps is what the games run
at. Measured 0 dropped frames in WebKit and even currentTime advance in both
engines. Clip weight: 6.6M for all 72 at 60fps, against 15M for the 14fps gifs.

Two clips are 15fps rather than 60, and correctly so: the IMPALA `flappy_bird`
and `flappy_bird.dunk2` checkpoints trained with `frame_skip=4`, so the renderer
only captures on step boundaries and a captured frame is worth four game frames.
`replay-video.mjs` now derives the mp4 rate from the capture cadence
(`fps / (stride * frameSkip)`); encoding those at a flat 60fps played them at 4x
speed. Their durations, 2.47s and 0.93s, are the real length of those episodes:
both policies die almost immediately.

`website/player.mjs` pauses off-screen clips, since WebKit otherwise runs every
decoder on the page at once.

Two sets, both rendered by `playtrain/tools/replay-video.mjs`:

* `agent/` — 32 games, one clip each, the best of four argmax episodes from the
  strongest checkpoint we have for that game.
* `human/` — 8 games, the best recorded round from the 20-participant study.

Both run on the study's seed pool (90000+) under its 2000-step cap, so a pair is
directly comparable. `scores.json` carries the per-game trainer, run id, seed and
score, and is what `website/galleries.py` reads to caption the page.

## How to regenerate

Checkpoints stay on FASRC; nothing but a JSON of actions comes back.

    # 1. rank runs per game by their TensorBoard return  (cluster, login node)
    cd /n/holylabs/LABS/gershman_lab/Users/rtruong/analogen-jaxbench
    .venv/bin/python _select_runs.py            # writes outputs/_best_runs.json

    # 2. roll out the winners                    (cluster, one GPU, ~20 min)
    sbatch _rollout.sbatch                       # writes outputs/_agent_session.json

    # 3. render locally                          (playtrain checkout)
    node tools/replay-video.mjs agent-session.json --best --format gif \
        --render-width 180 --fps 14 --max-frames 300 --out /tmp/agent32gifs

    # 4. install + recaption
    #    copy /tmp/agent32gifs/agent-<game>-*.gif -> rollouts/agent/<game>.gif
    python3 website/galleries.py

Step 2 stores only a seed and an action list per episode. Step 3 re-runs the game
headless and captures the frames itself, re-checking the score as it replays, so
a clip whose game file has drifted is refused rather than rendered.

The cluster keeps the two scripts as `_select_runs.py` and `_cluster_rollout.py`
beside the outputs tree; `playtrain-trainers/tools/rollout_session.py` is the
local equivalent for checkpoints copied down.

## Known wrinkles

* **Action repeat must be replayed, not flattened.** Two runs (the IMPALA
  `flappy_bird` and `flappy_bird.dunk2` checkpoints) trained with `frame_skip=4`.
  `replay-video.mjs` supports a per-episode `frameSkip`, but its parent used to
  overwrite it with one session-wide value, so those episodes replayed at one
  frame per action: four times too short, desynchronised, and ending before the
  bird visibly died. Fixed in the tool (per-episode value wins, and the capture
  stride is divided by the skip so the clip is not decimated twice); the rollout
  scripts now stamp `frameSkip` on every episode. Every other run uses
  `frame_skip=1`, so no other clip was affected.

* `jump_king` scores a float height. The rollout records it through a float32
  wire field, so it disagreed with the replay in the last decimals and the check
  refused the clip until the session score was set to the replayed value.
* `freeway` and `maze` score 0: their best checkpoints have not learned the game.
  The clips are kept, since hiding them would misrepresent the suite.
* `flappy_bird` human clips must be rendered with `--games games/js`. The bundled
  copy gained a "hold still until the first flap" gate after the study, so a
  recorded human episode replayed against it scores 0 instead of 28. The agent
  clips are unaffected: both policies press the flap key immediately, which opens
  the gate, so they reproduce identically on either file.
