"""Training-SPS suite bench for PPO, the companion to bench_train_suite.py.

Why a separate tool: bench_train_suite parses IMPALA's 60s `sps=` WINDOWS.
train_ppo_clean prints a CUMULATIVE rate (`upd 12/325 step 294912 74194 sps`),
which starts low and drifts up as start-up cost amortises. Feeding those to the
IMPALA parser would silently report a number biased by however long the run
happened to last.

Both `step` and the cumulative rate are printed, so elapsed = step / sps is
recoverable exactly, and differencing consecutive log lines gives true windows:

    window_sps = (step_j - step_i) / (step_j/sps_j - step_i/sps_i)

Reported per-game SPS = median of the windows after the warm-up cut, matching
bench_train_suite's "median of clean windows excluding the first".

usage:
  python bench_ppo_suite.py --template CFG.json --games a,b,c --out OUT.json
        [--windows 4] [--window-steps 2000000] [--warmup-steps 2000000]
"""
from __future__ import annotations

import argparse, json, math, os, re, signal, statistics, subprocess, sys, tempfile, time
from pathlib import Path

# upd  325/325  step   7987200  74194 sps  ret= ...
UPD_RE = re.compile(r"^upd\s+\d+/\d+\s+step\s+(\d+)\s+(\d+)\s+sps")


def bench_game(game, template, n_windows, window_steps, warmup_steps,
               max_minutes, nproc, keep_logs):
    cfg = dict(template)
    cfg["game"] = game
    cfg["total_timesteps"] = 10 ** 12          # the driver stops it, not the budget
    cfg["log_dir"] = f"outputs/bench_ppo_suite/{game}"
    cfg["save_every_updates"] = 10 ** 9
    cfg["use_wandb"] = False
    with tempfile.NamedTemporaryFile("w", suffix=f"_{game}.json", delete=False) as f:
        json.dump(cfg, f)
        cfg_path = f.name

    py = sys.executable
    cmd = ([py, "-m", "torch.distributed.run", "--standalone",
            f"--nproc_per_node={nproc}", "-m",
            "playtrain_trainers.train_ppo_clean", "--config", cfg_path]
           if nproc > 1 else
           [py, "-m", "playtrain_trainers.train_ppo_clean", "--config", cfg_path])

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True)
    pts, windows, log = [], [], []
    t0, interrupted = time.time(), False
    last_mark = None
    try:
        for line in proc.stdout:
            log.append(line)
            m = UPD_RE.match(line)
            if m:
                step, sps = int(m.group(1)), int(m.group(2))
                if sps > 0:
                    elapsed = step / sps          # exact: sps is cumulative
                    pts.append((step, elapsed))
                    if step >= warmup_steps:
                        if last_mark is None:
                            last_mark = (step, elapsed)
                        elif step - last_mark[0] >= window_steps:
                            w = (step - last_mark[0]) / (elapsed - last_mark[1])
                            windows.append(w)
                            print(f"  [{game}] window {len(windows)}: {w:,.0f} sps",
                                  flush=True)
                            last_mark = (step, elapsed)
            if (len(windows) >= n_windows
                    or time.time() - t0 > max_minutes * 60) and not interrupted:
                proc.send_signal(signal.SIGINT)
                interrupted = True
        proc.wait(timeout=180)
    except subprocess.TimeoutExpired:
        proc.kill(); proc.wait()
    finally:
        os.unlink(cfg_path)
    if keep_logs:
        keep_logs.mkdir(parents=True, exist_ok=True)
        (keep_logs / f"{game}.log").write_text("".join(log[-400:]))

    row = {"game": game, "sps": round(statistics.median(windows)) if windows else 0,
           "windows": [round(w) for w in windows],
           "minutes": round((time.time() - t0) / 60, 1)}
    if not windows:
        row["failed"] = True
        row["error"] = f"no windows parsed - see {keep_logs}/{game}.log"
        print(f"  [{game}] *** FAILED: no windows ***", flush=True)
    return row


p = argparse.ArgumentParser()
p.add_argument("--template", type=Path, required=True)
p.add_argument("--games", required=True)
p.add_argument("--out", type=Path, required=True)
p.add_argument("--windows", type=int, default=4)
p.add_argument("--window-steps", type=int, default=2_000_000)
p.add_argument("--warmup-steps", type=int, default=2_000_000)
p.add_argument("--max-minutes", type=float, default=7.0)
p.add_argument("--nproc", type=int, default=4)
a = p.parse_args()

template = json.loads(a.template.read_text())
rows = []
for game in a.games.split(","):
    print(f"=== {game} ===", flush=True)
    try:
        r = bench_game(game, template, a.windows, a.window_steps, a.warmup_steps,
                       a.max_minutes, a.nproc, a.out.parent / "ppo_suite_logs")
    except Exception as e:  # noqa: BLE001
        r = {"game": game, "sps": 0, "failed": True, "error": repr(e)[:200]}
    rows.append(r); print(r, flush=True)

failed = [r["game"] for r in rows if r.get("sps", 0) <= 0]
ok = [r["sps"] for r in rows if r.get("sps", 0) > 0]
summary = {"rows": rows,
           "geomean_sps": round(math.exp(sum(map(math.log, ok)) / len(ok))) if ok else 0,
           "games_ok": len(ok), "games_total": len(rows), "games_failed": failed,
           "template": str(a.template), "nproc": a.nproc}
a.out.parent.mkdir(parents=True, exist_ok=True)
a.out.write_text(json.dumps(summary, indent=2))
print(f"\nGEOMEAN {summary['geomean_sps']:,}  ({summary['games_ok']}/{summary['games_total']} games)")
if failed:
    print("*" * 68)
    print(f"*** {len(failed)} FAILED, excluded: {', '.join(failed)}")
    print("*" * 68)
print(f"wrote {a.out}")
