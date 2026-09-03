---
name: continuous-input-status
description: "Continuous input (mouse/gamepad) shipped on branch continuous-input — what's live, verified, and still open"
metadata: 
  node_type: memory
  type: project
  originSessionId: 083632c2-5793-4aa9-9833-93af5034eef0
  modified: 2026-08-23T02:39:11.818Z
---

Executed 2026-08-22 per `playtrain/CONTINUOUS_INPUT_PLAN.md` (status header there is authoritative). Branches: `playtrain` `continuous-input` (on top of `action-spaces`), `playtrain-trainers` `continuous-input`.

**Live:** quantized input frames (uint16 wire, `q = floor(clamp(v01)*65535+0.5)`, dequant `q/65535` identical in all engines) in both QuickJS hosts + Node shim + browser tester; `mouseX/mouseY/mouseIsPressed/mousePressed()/gamepadAxes` p5 globals everywhere; discrete analog presets (`aimgrid18`: pointer latched, buttons/axes absolute per step) and box spaces (`mouse2d`, `gamepad2s` → `gym.spaces.Box`) in `action_spaces.json`; ABI `vec_step_q`/`vec_set_input_map`/`vec_set_action_analog`; box support in QuickJSEnv (serve cmd 3), PlayTrainEnv (`stepq`), NativeVecEnv; `ActorCritic(continuous=True)` Normal head + `train_ppo_box.py`; reference pointer game `examples/games/js/aim_trainer.js`.

**Verified:** box AND aimgrid18 paths bit-exact V8-vs-QuickJS (`traceq` mode + `PLAYTRAIN_INPUT_MAP`), vec-vs-single bit-exact, default gate byte-identical, 87 tests green, hot loop unchanged (434k vs 430k, noise). PPO trains at ~4k sps on M4 Pro MPS.

**Learning result (the paper-grade number):** continuous mouse2d PPO on aim_trainer (shaped, RADIUS=3): mean return 2.7 → **13.2** over 2.5M steps, crossing the random baseline (4.44) at ~450k; policy std annealed 0.37→0.17; episodes 4x shorter (winning, not timing out). It took THREE iterations to get here: (1) radius-7 target — random click-spam wins 9.95/10; (2) radius-3 sparse-only — PPO collapses to 0.54 (exploration cliff); (3) dense proximity shaping (+0.01/frame within 12px, monotonic score) + log_std init −1.0 (std 1.0 saturates a clamped [0,1] channel, starving the mean's gradient) → learns. Those two hyperparameter/game-design lessons are the writeup material.

**Gotchas learned:** [[fasrc-benchmark-hazards]]-grade machine noise (279k–434k run-to-run) — always interleave A/B benches; the vec host's first episode frame has different default stroke state than the single host (games must set stroke state in draw; aim_trainer does); a same-hash XOR gate formula correlates channels (pointer pinned to a 1-D curve) — mix step and channel index before hashing; aim_trainer needed RADIUS=3 or random click-spam wins (~9.95/10 at radius 7, ~3.45 at radius 3).

**Still open:** box on async/PingPong hosts + PlayTrainVecEnv; full train_ppo_clean box integration; browser Gamepad API capture; study-harness pointer logging; generated pointer-game catalog. Relates to [[action-space-appendix-facts]], [[threejs-history-map]] (the 3D vec prototype wanted exactly this action substrate).
