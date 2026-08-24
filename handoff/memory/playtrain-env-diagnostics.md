---
name: playtrain-env-diagnostics
description: "How to tell a broken PlayTrain game from a hard one, plus the games-dir trap that silently invalidates local tests"
metadata: 
  node_type: memory
  type: project
  originSessionId: 03596098-ac30-4d2f-840b-43a60c060ac9
  modified: 2026-08-24T19:17:34.109Z
---

**`PLAYTRAIN_GAMES_DIR` does not work with `GameEnv`.** `GameEnv` resolves to
`QuickJSEnv`, and `qjs_env.py:27` hardcodes `_GAMES_DIR = _asset("examples/games/js")`
with no env-var override. Only `env.py`'s class reads the variable. A test that
sets the variable and passes a bare game name silently loads the stale
`examples/` copy and looks like the edit did nothing. Pass an **absolute `.js`
path** to `GameEnv(game=...)` instead, which `qjs_env.py:49` honours. This cost
several wrong conclusions on 2026-08-24.

Related: the wheel force-includes only `examples/games`, so `games/js/` edits
never reach an installed venv, and the cluster runs read
`playtrain/examples/games/js` because `_paths.repo_root()` resolves against the
checkout when `PYTHONPATH` points at `../playtrain/src`. Sync **both** paths.

**The diagnostic that separates broken from hard:** run a uniform random policy
for ~60k steps per game and report percent of episodes with return > 0. Games
where reward is reachable train or fail for training reasons; games at exactly
0% with every episode hitting truncation are broken by design. Run of
2026-08-24 over all 24: only `maze` was truly dead. `pong` reads 0% only because
its return is a score differential. `caveflyer`, `ninja`, `jumper`, `climber`
all have reachable reward, and their zero rows in `tab:eval` are one-seed
training failures, with caveflyer and ninja actually scoring *worse* than
random.

**Compare against the real thing.** `procgen-play` ships an x86_64 venv at
`~/.local/share/procgen-play/.venv`; drive `ProcgenEnv` under
`arch -x86_64` to get a random-policy baseline. ProcGen maze: 44.2% easy,
32.5% hard. That is the target regime, and it is why ProcGen maze trains.

**What was wrong with the two games** (both fixed 2026-08-24, see
[[playtrain-benchmark-results]]):

- `maze` fixed every level at 21x21, put the goal at the DFS-deepest cell, and
  moved 3px through 20px cells. Shortest path averaged 913 actions against a
  2000-step truncation. ProcGen's `maze.cpp` instead samples
  `maze_dim = randn((world_dim-1)/2)*2+3` per level, places the goal at a random
  free cell, and sets `grid_step = true`. Porting all three took random solve
  rate 0% -> 65.2%.
- `freeway` gave the agent 5 lives and reset it to the bottom on any hit, which
  makes standing still in the safe zone risk-free. Training collapsed to the
  do-nothing policy: entropy 2.08 -> 1.11 while episode length climbed to the
  2000-step truncation. Slowing the cars alone did not touch this. Removing
  lives, knocking back one lane instead of resetting, and dropping the score>=10
  win cap took mean random return 0.12 -> 3.92.

**How to apply:** before spending node-hours on a suite, run the random-policy
screen. A game that a random policy never solves will not train, and the fix is
usually a mechanic ported from the original rather than a difficulty constant.
