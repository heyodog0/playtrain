#!/usr/bin/env python3
"""Generate the cavequest_hard_explore no-holdout N-sweep at 100M steps on the
vec recipe (base template: impala_cqhe_1gpu_lstm_v4).

Batch/LR = the SCIENCE default from vec_validation_sweep, NOT the SPS-demo recipe:
the template ships batch 128 @ lr 1e-4 (tuned for the 99.8k-SPS record), but the
6-arm sweep on cavequest_easy N001 found batch 64 @ lr 2e-4 is the sample-efficiency
sweet spot (full win @ 4.3M steps vs batch-128@1e-4's 15.6M; batch-128@4e-4 degrades
to 0.50 — don't linearly scale LR). We override to that pairing here.

Grid: N in {1,2,4,8,16,32,64,128,256,360} x split_seed in {0,1,2,3} = 40 configs.
Top-level `seed` stays 0 across the sweep (matches the original 40M set — the
"4 seeds" are 4 binding-splits, not 4 RNG seeds).
"""
import copy
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = HERE / "configs/vec_pilot_cqhe/impala_cqhe_1gpu_lstm_v4.json"
OUT_DIR = HERE / "configs/cavequest_hard_explore_nohd_100M"

NS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 360]
SEEDS = [0, 1, 2, 3]
TOTAL_STEPS = 100_000_000
BATCH_SIZE = 64        # science-default sweet spot (sweep), not the template's 128
LEARNING_RATE = 2e-4   # pairs with batch 64; do NOT linearly scale to 4e-4
GROUP = "cavequest_hard_explore_nohd_100M"

base = json.loads(TEMPLATE.read_text())
OUT_DIR.mkdir(parents=True, exist_ok=True)

n_written = 0
for N in NS:
    for s in SEEDS:
        cfg = copy.deepcopy(base)
        name = f"impala_cqhe_nohd_100M_N{N:03d}_s{s}"
        cfg["total_steps"] = TOTAL_STEPS
        cfg["batch_size"] = BATCH_SIZE
        cfg["learning_rate"] = LEARNING_RATE
        cfg["seed"] = 0
        cfg["train_pool"]["n_train_bindings"] = N
        cfg["train_pool"]["split_seed"] = s
        cfg["log_dir"] = f"outputs/{name}"
        cfg["wandb_group"] = GROUP
        cfg["wandb_name"] = name
        (OUT_DIR / f"{name}.json").write_text(json.dumps(cfg, indent=2) + "\n")
        n_written += 1

print(f"wrote {n_written} configs to {OUT_DIR.relative_to(HERE)}")
