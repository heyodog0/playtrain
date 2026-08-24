# Handoff, 2026-08-24

Written before a machine move. Everything below was laptop-only state that would
not have survived. All four repos (`playtrain`, `playtrain-trainers`,
`playtrain-paper`, `ICLR-PlayTrain-Fast-LLM-VGEs`) are private, so cluster paths
are fine here. Do **not** copy any of this into the paper: ICLR is double-blind
and the paper body is currently clean of cluster and institution names.

## 1. Restore Claude's memory on the new machine

`handoff/memory/` holds 18 memory files copied from

    ~/.claude/projects/-Users-heyodogo-code-lab-playtrain/memory/

**The directory name is derived from the absolute checkout path.** If the new
machine puts this repo anywhere other than `/Users/heyodogo/code/lab/playtrain`,
that folder name changes and none of the memories load. Recreate it as

    ~/.claude/projects/<abs-path-with-slashes-replaced-by-dashes>/memory/

e.g. `/Users/alice/code/playtrain` becomes `-Users-alice-code-playtrain`.
`MEMORY.md` is the index loaded each session; keep it alongside the rest.

## 2. Game fixes committed with this handoff

Two of the 24 replicas were unlearnable by design. Both are fixed, verified
locally, and already synced to the cluster. Fixes live in **both** `games/js/`
and `examples/games/js/`, because the runtime loads the latter
(`runtime/env.py:22`) while `games/js/` is the editable catalog.

| game | random solve rate before | after | reference |
|---|---|---|---|
| `maze` | 0.0% | 65.2% | real ProcGen: 44.2% easy, 32.5% hard |
| `freeway` | 0.12 mean return | 3.92 | n/a |

`maze` was missing three ProcGen behaviours (`games/procgen_src/maze.cpp`):
per-level size sampling `maze_dim = randn((world_dim-1)/2)*2+3`, a randomly
placed goal instead of the DFS-deepest cell, and `grid_step = true`. Fixed level
size at 21x21 plus an adversarial goal plus 3px-per-step movement made the
shortest path average 913 actions against a 2000-step truncation.

`freeway` gave the agent 5 lives and reset it to the bottom on any hit, which
makes standing still in the safe zone risk-free. Training collapsed to the
do-nothing policy (entropy 2.08 -> 1.11, episode length climbing to the 2000-step
truncation). Slowing the cars did not touch this. Now: no lives, knockback of one
lane, no `score >= 10` win cap, matching ALE.

Pre-fix backups are in `games/backups/`, which is **gitignored**, so they did not
travel. The prior versions are recoverable from this repo's history and from
`*.bak-20260824` files on the cluster.

## 3. Trap that cost several wrong conclusions

`PLAYTRAIN_GAMES_DIR` does **not** work with `GameEnv`. `GameEnv` resolves to
`QuickJSEnv`, and `qjs_env.py:27` hardcodes `_GAMES_DIR = _asset("examples/games/js")`
with no env-var override; only `env.py`'s class reads the variable. A test that
sets the variable and passes a bare game name silently loads the stale
`examples/` copy and looks like the edit did nothing. Pass an **absolute `.js`
path** to `GameEnv(game=...)`, which `qjs_env.py:49` honours.

## 4. Diagnostic worth reusing

Random-policy screen: ~60k steps per game, report percent of episodes with
return > 0. Games where reward is reachable train, or fail for training reasons.
Games at exactly 0% with every episode hitting truncation are broken by design.

Run over all 24 on 2026-08-24: only `maze` was truly dead. `pong` reads 0% only
because its return is a score differential. `caveflyer`, `ninja`, `jumper` and
`climber` all have reachable reward, so their zero rows in the paper's eval table
are one-seed training failures rather than broken games. `caveflyer` and `ninja`
trained *worse* than random (3.04 -> 1.0 and 0.90 -> 0.2).

The ProcGen baseline comes from `~/.local/share/procgen-play/.venv` driven under
`arch -x86_64`. That venv is laptop-local and needs rebuilding.

## 5. Cluster jobs in flight at handoff time

Submitted from `/n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench`
(scaling repeats from `../playtrain-trainers`). Check with `squeue --me`.

| job | what | notes |
|---|---|---|
| `41650699` | 144-run suite: 24 games x {Nature-CNN, IMPALA-CNN} x 3 seeds, IMPALA, 100M | array `1-144%8`, configs in `outputs/_suite3/`, manifest `outputs/_suite3/manifest.txt` |
| `41654169/77/82` | ProcGen thread-scaling repeats | pinned `--nodelist=holygpu8a17402` |
| `41654185/87/98` | ALE thread-scaling repeats | `--export=ALL,SUITE=ale`, same node |
| `41647604_1/2` | PPO freeway 2x2 | superseded, ran against the pre-fix freeway |

All six scaling repeats were pending on `QOSMaxGRESPerUser`, queued behind the
suite, not stuck.

The suite launched **after** both game fixes were synced, so its `maze` and
`freeway` curves use the fixed versions.

Earlier freeway 2x2 (`41647601`, `41648275`) returned all zeros. That run used
the slower-cars freeway and is what exposed the do-nothing collapse. Superseded.

## 6. What to do when those jobs land

- Table 7 in the paper: re-derive the two thread-scaling speedups (`15.1x`,
  `4.03x`) from three runs instead of one.
- Table 8: add a spread column.
- Figure 4A: add +/-1 SE. It is currently the only panel without error bars, and
  it carries the headline 15x / 4x claim. Panels B and C use
  `yerr = std/sqrt(7)` (`throughput_panels.py:95-97`).
- Appendix `app:suite`: regenerate the full-suite grid. Its caption still says
  150M and one seed; the new runs are 100M and three seeds.

## 7. Paper state

Repo `ICLR-PlayTrain-Fast-LLM-VGEs`, last commit `43df954`. Appendix
`app:bench` now has both tables; its prose is unwritten. Notes on what the prose
still needs are in the session transcript, summarised as: the thread-axis
definition, that env counts are matched at 128 per worker, how the ALE
observation was forced to 64x64 RGB stack 1 frameskip 1 (EnvPool's Atari
defaults are 84x84 grayscale stack 4 frameskip 4, which would make ALE look ~4x
faster), why 16 and 8 games rather than 24, and the per-measurement statistics.

`app:variants` is still an empty section with a live `\ref` pointing into it from
line 649. That is a submission blocker.

`\iclrfinalcopy` at line 148 must be removed for a double-blind submission. That
also hides the GitHub URL, which sits inside `\author{}`.

Overleaf and GitHub are two-way synced. Fetch before editing, and tell Ryan to
pull in Overleaf after every push. A push was rejected mid-session because
Overleaf had moved ahead; the fix was rebase, not merge.

## 8. Environment to re-establish

- `fasrc` zsh function, `~/.config/fasrc-passwordless/`, and the Keychain entries
  holding the password and TOTP seed. Without these there is no cluster access.
- `procgen-play` at `~/.local/share/procgen-play` (x86_64 under Rosetta,
  Python 3.10) for ProcGen baselines.
- `tectonic` for local paper builds. `fontawesome5` aborts it with SIGABRT and no
  log, so build a stubbed copy. See `handoff/memory/paper-local-latex-build.md`.
- Python is always `uv`, never bare `pip`/`venv`/`conda`.

## 9. Loose end

The cluster clone of `analogen-jaxbench` has an unpushed local commit `b85420d`
adding `--no-throughput` to `tools/plot_main_composite.py`. The push was rejected
because that clone is behind its own remote. Do not force it.
