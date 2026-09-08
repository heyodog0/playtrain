# Handoff — playtrain.org project page (2026-09-07)

Everything about the website lives in `playtrain/website/`. Nothing here is committed
yet (branch is `p5-webgl`; `git status` shows the whole directory untracked).

    just site         # build -> website/site/
    just site-serve   # build, then serve on http://127.0.0.1:8000  (plain http)

## 0. Read this first: three things that have burned time

1. **Cache, not Safari.** Twice the site "broke in Safari and worked in Chrome"; both
   times it was a stale cached asset. `website/serve.py` now sends `Cache-Control:
   no-store` and `build.sh` stamps `style.css?v=<hash>` / `player.js?v=<hash>` into the
   built page. Verified in real Safari 26.3.1 and headless WebKit 26.5 that page, player
   and clips are fine. `website/check.html` (unlinked, dev-only) boots the engine on a
   bare page and prints PASS/FAIL — point a misbehaving browser at `/check.html`.
2. **`frame_skip=4` runs.** Exactly 2 of 64 checkpoints (IMPALA `flappy_bird` and
   `flappy_bird.dunk2`) trained with action repeat. They caused three separate rendering
   bugs (§4). Audit `frame_skip` on any new run before trusting its clip.
3. **Greedy, not TensorBoard, ranks the trainers.** Both trainers log only
   `charts/ep_return_mean`, which is each one's own *sampled* policy. By that metric PPO
   wins 21/11; by mean argmax return over 6 study seeds it is **PPO 15, IMPALA 14, 3
   ties**. The clips are argmax, so greedy is the metric the page uses.

## 1. What the page is

Nerfies-style single page (`nerfies.github.io`, credited in the footer), light mode only
and pinned with `color-scheme: light` — do not add a `prefers-color-scheme` block back.
Sections, in order:

| section | content |
|---|---|
| hero | paper title, authors, pill links (Paper / Code / Trainers / Docs / Play) |
| header strip | 8 chosen games, IMPALA + PPO clip each, greedy scores, **learning curve inside each card** |
| abstract | verbatim from the paper |
| demo | the in-page playable player + game index |
| compare | human vs IMPALA vs PPO for the 8 study games |
| gallery | all 34 games, both trainers, greedy scores, winner outlined |
| bibtex, footer | citation, contacts, Nerfies credit |

Ryan cut the page back to abstract + demo on 2026-09-04 ("we shouldn't just copy-paste
the figures from the paper"), then the clips and one figure were added back. The seven
paper figures still sit in `website/figures/` but are **not shipped** — `build.sh` has
the copy line commented out.

## 2. Files

| file | role |
|---|---|
| `index.html` | hand-written, except three generated marker blocks: `TEASER`, `COMPARE`, `GALLERY` |
| `style.css` | all styling; light-only |
| `galleries.py` | regenerates the three marker blocks from `rollouts/` + `scores.json`; imports `curves` |
| `curves.py` | library: `panel_for(game, data)` -> inline SVG, `legend()`; no longer writes its own section |
| `data/header_curves.json` | binned learning curves for the header games |
| `player.mjs` | in-page player controller + off-screen clip pausing |
| `serve.py` | no-store dev server |
| `check.html`, `player-check.mjs` | dev-only browser diagnostic |
| `rollouts/agent/<game>__{impala,ppo}.mp4` | 68 agent clips |
| `rollouts/human/<game>.mp4` | 8 human clips |
| `rollouts/scores.json` | per game/trainer: run id, greedy mean, best score; plus `human_score` |
| `rollouts/README.md` | the clip pipeline and its traps (stripped from the build) |
| `gif2mp4.sh` | **deprecated stub** — never convert GIFs (§4.4) |
| `docs/` | small separate docs sub-site, palette hand-synced with the main page |

`build.sh` runs `galleries.py`, copies only the mp4s, builds the in-page player
(`tools/build-embed.mjs`) and the standalone tester (`tools/build-pages.mjs`), stamps
cache-busting hashes, writes the CNAME. `.github/workflows/site.yml` publishes
`website/site` to GitHub Pages.

## 3. The clip pipeline

Checkpoints stay on FASRC; only action lists come back.

    # cluster: /n/holylabs/LABS/gershman_lab/Users/rtruong/analogen-jaxbench
    .venv/bin/python _select_runs.py        # rank all 732 runs per game by TB tail
    .venv/bin/python _compare_trainers.py   # best run per TRAINER per game
    sbatch _both.sbatch                     # greedy-eval + roll out both sides (~1h)
    #   -> outputs/_agent_impala.json, _agent_ppo.json, _greedy_both.json

    # local (playtrain checkout)
    node tools/replay-video.mjs <session>.json --best --format mp4 \
        --render-width 180 --max-frames 2000 --crf 28 --out /tmp/mp4_<pid>
    # copy /tmp/mp4_<pid>/<pid>-<game>-r*.mp4 -> website/rollouts/agent/<game>__<pid>.mp4
    python3 website/galleries.py

Key facts:

- A session stores **seed + action list only**; the renderer re-runs the game headless and
  captures frames itself, re-checking the score as it replays. A mismatch is refused, not
  rendered — that check has caught real problems twice.
- Trainer kind comes from the checkpoint's keys (`model_state_dict` = IMPALA, `model` =
  PPO), **never the run name** (`pv_p768_flappy_bird_s2` is IMPALA).
- `--max-frames 2000` matches the 2000-step episode cap, so clips run the whole episode.
  They were 600 frames (~52% of the run) until today.
- `--crf 28` for the web; the default 18 is near-lossless and right for the paper but
  costs 2.9M vs 0.4M for a busy game at full length.
- ImpalaNet needs a dict of `[T, B, ...]` tensors plus a threaded core state — mirror
  `playtrain_trainers/impala/eval.py:greedy_eval`, not a bare obs tensor.
- Record `info["score"]`, not the RL return: the renderer compares the **game score**, and
  they differ on `coinrun`.

## 4. Traps, each already paid for

1. **Per-episode `frameSkip` was overwritten** by a session-wide value in
   `replay-video.mjs`, so the two action-repeat clips replayed at 1 frame per action:
   4x too short and desynchronised. Fixed; the rollout scripts now stamp `frameSkip`.
2. **Capture stride ignored `frameSkip`**, decimating those clips a second time. Fixed.
3. **mp4 was encoded at a flat 60fps** although a captured frame is worth
   `stride * frameSkip` game frames, so those two played at 4x speed. The rate now comes
   from the capture cadence: they are 15fps, 2.47s and 0.93s, which is their true length.
4. **Never convert a GIF to mp4.** GIF delays are whole centiseconds, so a "14fps" clip is
   really 100/7 = 14.286fps; re-encoding to 15fps duplicates ~every 14th frame and
   visibly judders. Render mp4 from the replay instead.
5. **`jump_king`'s score is a float height** that cannot round-trip the rollout's float32
   wire field, so drop `score` from its episodes and let the replay be authoritative.
6. **`flappy_bird` file drift.** `examples/games/js/flappy_bird.js` (69371176) gained a
   "hold still until the first flap" gate the study version
   (`games/js/flappy_bird.js`, 85c98a01) lacks. **Human** clips need
   `--games games/js` or they score 0 instead of 28. Agent clips are fine either way,
   because both policies flap immediately.
7. **Headless WebKit never advances animated images.** Screenshot-diffing GIFs there
   proves nothing; a reference GIF from another encoder froze identically. Video playback
   *is* observable (`video.currentTime`), which is a reason to prefer it.

## 5. Runs and numbers

- Checkpoints: `analogen-jaxbench/outputs/<run>/final.pt` + `config.json`, ~83k `.pt`
  files, 732 run dirs across 36 game names. `~/node-gym-smoke/playtrain-trainers` has only
  6 parity checkpoints — not the real ones.
- Greedy head-to-head over 32 games: **PPO 15, IMPALA 14, 3 ties** (frostbite, qbert,
  space_invaders). IMPALA's big wins: qbert.v2 1427/380, seaquest 1402/787, asteroids
  1238/780, coinrun 186/22. PPO's: jump_king 425/221, breakout.multi 817/673, both
  flappy variants (IMPALA ~0).
- Header set (`galleries.py:TEASER_ORDER`): coinrun, qbert.v2, breakout.multi,
  frostbite.jungle, **downwell_fresh.refined**, miner, starpilot, bossfight. Both trainers
  are shown per card pending Ryan's per-game choice — set `TEASER_PICK = {"coinrun":
  "impala", ...}` to collapse a card to one clip.
- **New forks** (`outputs/_fig3bnew/`, 12 runs, 3 seeds x {vvvvvv.v2, refined
  downwell_fresh}, 100M steps): refined downwell_fresh IMPALA 308-324 / PPO 342-370
  (random 28); **vvvvvv.v2 IMPALA 0/8.3/8.3, PPO 0/0/16.7 against random 16.7 — nobody
  learns it even trained on it**, though its TB sampled return looks like 67-78. That fork
  changed gravity 0.6 -> 1.5 plus bigger spikes/treadmills/WIN, so it is a dynamics change,
  not the visual-only variant its prompt describes.
- Checkpoint asymmetry in `_fig3bnew`: IMPALA saved `final.pt` only
  (`save_every_steps: 0`), PPO saved 163 intermediates (`save_every_updates: 25` =
  614,400 steps), 2.4G total. tb is complete for all 12, so curves are unaffected; only
  mid-training IMPALA rollouts and resume are impossible. A re-run with
  `save_every_steps` is ~30 min at `%2` and ~2.5G.
- **Zero-shot transfer** (`outputs/_transfer.json`, clips in `/tmp/mp4_tr`, not on the
  page): every old checkpoint collapses on the new files. vvvvvv 108/92 -> v1 38/0 -> v2
  0/0; downwell 395/303 -> refined 8/80. Below random in two cases.

## 6. Verification recipes

    # every clip covers its whole episode?  compare session action counts to nb_read_frames
    ffprobe -v error -select_streams v -count_frames \
        -show_entries stream=nb_read_frames,r_frame_rate -of csv=p=0 <clip>.mp4

    # does the page work in WebKit / does video actually play?
    uvx --from playwright playwright install webkit     # once
    # then drive it with playwright: check video.currentTime advances, not screenshots

    # dataviz palette (before touching curve colours)
    node <skill>/scripts/validate_palette.js "#2a78d6,#eb6834" --mode light

## 7. Open items

- `paper.pdf` 404s. `build.sh` warns. The only compiled PDF found is
  `ICLR PlayTrain_ Fast LLM VGEs (Version 2777)/iclr2026_conference.pdf`, which is the
  2026 template while the live source is `ICLR-PlayTrain-Fast-LLM-VGEs/main.tex` (2027) —
  confirm before shipping it.
- Ryan to pick one trainer per header game -> `TEASER_PICK`.
- Nothing is committed. `.github/`, `website/` and `tools/build-embed.mjs` are untracked;
  `tools/replay-video.mjs`, `justfile`, `.gitignore` are modified.
- Curves are sampled-policy returns and visibly disagree with the greedy caption numbers
  on `coinrun` and `qbert.v2`. The caption says so; the alternative is greedy-checkpoint
  curves, which only PPO has the checkpoints for.
- The player no longer shows the 64x64 observation (removed today), so the page has no
  visual statement of what the agent sees. A toggle in the player bar is the cheap fix if
  that is wanted back.
- Efficiency has no figure by choice. Advice given: keep one figure (the curves); if one
  more number is wanted, generation cost (26 model calls, 34.4 min, under $1 for six
  artifacts) beats any throughput number, and comparative speed ratios are the ones that
  move.
- `examples/games/js` grew to 34 games (`seaquest.v3` appeared from another session); the
  player and gallery pick that up from the directory automatically.
