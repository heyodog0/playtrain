---
name: action-space-appendix-facts
description: "The four facts the paper's action-space appendix needs, from the implemented configurable-action-space work (branch action-spaces, commit c4e9d12)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 083632c2-5793-4aa9-9833-93af5034eef0
  modified: 2026-08-23T00:28:49.738Z
---

Implemented 2026-08-22 on `playtrain` branch `action-spaces` (c4e9d12). The paper appendix (`app:pt_act_obs`, see [[paper-open-issues]]) needs these four things, all now true:

1. **Spec format**: `runtime/action_spaces.json` — named spaces, each action `{name, held: [keycodes], press: keycode|null}`. Press = held-for-the-frame AND `keyPressed()` fired once. Selected per env via `action_space=` (name / .json path / inline list) on every env class.
2. **Default table**: `default8` = 0 NOOP, 1 LEFT(37), 2 RIGHT(39), 3 UP(38), 4 DOWN(40), 5 D(press 32), 6 LEFT+D, 7 RIGHT+D — indices frozen, byte-identical to the old hardcoded tables.
3. **Generated games do NOT declare their own space** — operator-level setting only; games stay authored against default8 (keeps one policy head trainable across the catalog). This was the flagged design decision.
4. **Non-default space demonstrated end to end**: `thrust10` (default8 + UP_D, DOWN_D) ran through QuickJSEnv, PlayTrainEnv (Node), NativeVecEnv, NativeVectorEnv → Discrete(10); bit-exact V8-vs-QuickJS differential gate passed on it; IMPALA trainer accepted it with ZERO trainer edits.

Also: gate + throughput unchanged (C++ hot loop 426.9k vs 424.8k steps/s A/B); qbert gate divergence is pre-existing on main; gen-validator OBS check fails for bigfish on clean main too (pre-existing).
