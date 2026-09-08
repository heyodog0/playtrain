"""IMPALA trainer bake-off ladder: A1-A4 on one node, back to back.

Arms (PLAN-trainer-bakeoff.md in the paper repo's handoff/):
  a1  shared_cpu   one qjs env per actor, batch-1 CPU forward, shared CPU model
  a2  central_gpu  one qjs env per actor, obs batched across actors, one GPU fwd
  a3  vec          single-buffered vectorized workers (published cfg, db off)
  a4  vec+db       the paper config (tab:dbuf-ablation's double-buffered arm)

Statistic: median of the monitor's 60s `sps=` windows with the first
discarded — identical to tools/bench_train_suite.py. a3/a4 run through
`python -m analogen.train_impala --config`; a1/a2 through
tools/bench_ladder_a12.py, which injects the canonical qjs GameEnv env_fn
(the config-file path would use the superseded Node fallback).

a1/a2 get a short actor-count probe (2 windows on the probe game) before
their timed games — their one-env-per-actor topology shares nothing with
vec's workers x envs, so their best num_actors is found, not assumed.

Writes/updates --out after every row so a wall-clock death keeps the rows
already measured.

    .venv/bin/python tools/bench_ladder.py \
        --template configs/pt_throughput/pt_bigfish_nature_fullnode.json \
        --out outputs/ladder_${SLURM_JOB_ID}.json
"""
from __future__ import annotations

import argparse
import json
import math
import os
import queue
import re
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

GAMES4 = "breakout,bigfish,miner,plunder"  # tab:dbuf-ablation's games
SPS_RE = re.compile(r"\bsps=([0-9][0-9.]*)")

ARMS = ("a4", "a3", "a2", "a1")  # cross-check arms first

# vec arm -> (vec_workers, vec_double_buffer). a4/a3 are the ladder arms
# (15w, the post-Aug-7 optimum); a4w12/a3w12 replicate Table 1(b)'s A/B
# topology (12w, 12x2x256=6,144 envs — the paper's hyperparameter table) to
# decompose its gap into worker-count vs buffering components.
VEC_ARMS = {"a4": (15, True), "a3": (15, False),
            "a4w12": (12, True), "a3w12": (12, False)}


def a12_cfg(mode: str, game: str, num_actors: int) -> dict:
    return {
        "game": game,
        "env_backend": "playtrain",
        "inference_mode": mode,
        "total_steps": 10 ** 12,  # driver stops the run
        "num_actors": num_actors,
        "batch_size": 8,
        "unroll_length": 80,
        "num_learner_threads": 2,
        "net": "nature",
        "features_dim": 256,
        "use_lstm": False,
        "frame_skip": 1,
        "frame_stack": 1,
        "obs_shape": [3, 64, 64],
        "num_actions": 8,
        "seed": 0,
        "device": "cuda",
        "learner_precision": "fp32",
        "compile_learner": False,
        "eval_every_steps": 0,
        "save_every_steps": 0,
        "resume": "off",
        "stats_log_every": 10,
        "log_dir": f"outputs/ladder/{mode}/{game}",
    }


def vec_cfg(template: dict, game: str, double_buffer: bool, port: int,
            workers: int = 15) -> dict:
    cfg = dict(template)
    cfg["game"] = game
    cfg["total_steps"] = 10 ** 12
    cfg["vec_workers"] = workers
    cfg["vec_env_threads"] = 5
    cfg["batch_size"] = 256
    cfg["vec_double_buffer"] = double_buffer
    cfg["ddp_rdzv_port"] = port
    cfg["log_dir"] = (f"outputs/ladder/vec_w{workers}_"
                      f"db{'on' if double_buffer else 'off'}/{game}")
    return cfg


def build(arm: str, game: str, template: dict, actors: int, port: int):
    """-> (cfg_dict, argv, extra_env, min_sps)."""
    if arm in ("a1", "a2"):
        mode = "shared_cpu" if arm == "a1" else "central_gpu"
        cfg = a12_cfg(mode, game, actors)
        argv = [sys.executable, "tools/bench_ladder_a12.py"]
        # one intra-op torch thread per forked actor; N actors each
        # defaulting to an n-core threadpool would thrash the node
        env = {"OMP_NUM_THREADS": "1"}
        min_sps = 10.0
    else:
        workers, dbuf = VEC_ARMS[arm]
        cfg = vec_cfg(template, game, double_buffer=dbuf, port=port,
                      workers=workers)
        argv = [sys.executable, "-m", "analogen.train_impala"]
        env = {}  # published config: no thread override
        min_sps = 5000.0  # skip compile/idle windows, as bench_train_suite
    return cfg, argv, env, min_sps


def bench_one(arm: str, game: str, template: dict, actors: int, port: int,
              windows_needed: int, max_minutes: float,
              keep_logs: Path) -> dict:
    cfg, argv, extra_env, min_sps = build(arm, game, template, actors, port)
    with tempfile.NamedTemporaryFile("w", suffix=f"_{arm}_{game}.json",
                                     delete=False) as f:
        json.dump(cfg, f)
        cfg_path = f.name
    proc = subprocess.Popen(
        argv + ["--config", cfg_path],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        env={**os.environ, **extra_env}, start_new_session=True)

    # Read stdout on a daemon thread. Forked actors inherit the pipe, so a
    # blocking `for line in proc.stdout` can outlive the trainer by hours —
    # job 42060782 hung 3h45m in exactly that readline after the a2/91 probe.
    q: queue.Queue = queue.Queue()

    def _reader():
        for ln in proc.stdout:
            q.put(ln)
        q.put(None)

    threading.Thread(target=_reader, daemon=True).start()

    def _kill_group(sig):
        try:
            os.killpg(proc.pid, sig)
        except (ProcessLookupError, PermissionError):
            pass

    windows: list[float] = []
    t0 = time.time()
    log_lines: list[str] = []
    interrupted = False
    int_at = 0.0
    # hard cap even if the run produces no parseable output at all
    hard_deadline = t0 + max_minutes * 60 + 300
    eof = False
    while True:
        now = time.time()
        if not interrupted and now > hard_deadline:
            print(f"  [{arm}/{game}] hard deadline hit, interrupting",
                  flush=True)
            proc.send_signal(signal.SIGINT)
            interrupted, int_at = True, now
        if interrupted and now > int_at + 120:
            print(f"  [{arm}/{game}] no clean exit 120s after SIGINT, "
                  f"killing process group", flush=True)
            break
        if eof and proc.poll() is not None:
            break
        try:
            line = q.get(timeout=5)
        except queue.Empty:
            continue
        if line is None:
            eof = True
            continue
        log_lines.append(line)
        m = SPS_RE.search(line)
        if m:
            w = float(m.group(1))
            if w > min_sps:
                windows.append(w)
                print(f"  [{arm}/{game}] window {len(windows)}: "
                      f"{w:,.0f} sps", flush=True)
        timed_out = time.time() - t0 > max_minutes * 60
        if (len(windows) >= windows_needed or timed_out) \
                and not interrupted:
            proc.send_signal(signal.SIGINT)
            interrupted, int_at = True, time.time()
    try:
        proc.wait(timeout=60)
    except subprocess.TimeoutExpired:
        pass
    _kill_group(signal.SIGKILL)  # reap forked stragglers unconditionally
    try:
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        pass
    keep_logs.mkdir(parents=True, exist_ok=True)
    keep = (log_lines if len(log_lines) <= 800 else
            log_lines[:400] + ["\n... [trimmed] ...\n"] + log_lines[-400:])
    (keep_logs / f"{arm}_{game}_n{actors}.log").write_text("".join(keep))

    steady = windows[1:] if len(windows) > 1 else windows
    sps = sorted(steady)[len(steady) // 2] if steady else 0.0
    row = {"arm": arm, "game": game, "sps": round(sps, 1),
           "windows": [round(w, 1) for w in windows],
           "minutes": round((time.time() - t0) / 60, 1)}
    if arm in ("a1", "a2"):
        row["num_actors"] = actors
    if not steady:
        row["failed"] = True
        row["error"] = (f"no sps windows parsed - see "
                        f"suite_logs/{arm}_{game}_n{actors}.log")
        print(f"  [{arm}/{game}] *** FAILED: no sps windows parsed ***",
              flush=True)
    return row


def geomean(vals):
    ok = [v for v in vals if v > 0]
    return round(math.exp(sum(math.log(v) for v in ok) / len(ok))) if ok else 0


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--template", type=Path, required=True)
    p.add_argument("--games", default=GAMES4)
    p.add_argument("--arms", default=",".join(ARMS))
    p.add_argument("--windows", type=int, default=4)
    p.add_argument("--max-minutes", type=float, default=6.0)
    p.add_argument("--a12-max-minutes", type=float, default=9.0)
    p.add_argument("--probe-game", default="breakout")
    p.add_argument("--a1-actors", default="23,46,91",
                   help="comma list to probe; single value = no probe")
    p.add_argument("--a2-actors", default="46,91,182")
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--settle-seconds", type=float, default=20.0)
    p.add_argument("--retries", type=int, default=1)
    args = p.parse_args()

    template = json.loads(args.template.read_text())
    keep_logs = args.out.parent / "suite_logs"
    result = {"node": socket.gethostname(),
              "job_id": os.environ.get("SLURM_JOB_ID"),
              "games": args.games, "template": str(args.template),
              "statistic": "median of 60s sps windows, first discarded",
              "arms": {}}

    def flush():
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2))

    port_seq = iter(range(29400, 29400 + 10_000, 7))
    first_run = True
    for arm in args.arms.split(","):
        arm_rec: dict = {"rows": [], "probe": []}
        result["arms"][arm] = arm_rec
        # --- probe (a1/a2 only): pick num_actors on the probe game ---
        actors = 0
        if arm in ("a1", "a2"):
            counts = [int(c) for c in
                      (args.a1_actors if arm == "a1"
                       else args.a2_actors).split(",")]
            if len(counts) == 1:
                actors = counts[0]
            else:
                best = (None, -1.0)
                for c in counts:
                    if not first_run:
                        time.sleep(args.settle_seconds)
                    first_run = False
                    print(f"=== probe {arm} num_actors={c} ===", flush=True)
                    r = bench_one(arm, args.probe_game, template, c,
                                  next(port_seq), windows_needed=2,
                                  max_minutes=6.0, keep_logs=keep_logs)
                    arm_rec["probe"].append(r)
                    flush()
                    if r["sps"] > best[1]:
                        best = (c, r["sps"])
                actors = best[0]
            arm_rec["num_actors"] = actors
            print(f"=== {arm}: using num_actors={actors} ===", flush=True)
        # --- timed games ---
        maxmin = (args.a12_max_minutes if arm in ("a1", "a2")
                  else args.max_minutes)
        for game in args.games.split(","):
            print(f"=== {arm} / {game} ===", flush=True)
            r = None
            for attempt in range(args.retries + 1):
                if not first_run:
                    time.sleep(args.settle_seconds)
                first_run = False
                try:
                    r = bench_one(arm, game, template, actors,
                                  next(port_seq), args.windows, maxmin,
                                  keep_logs)
                except Exception as e:  # noqa: BLE001
                    r = {"arm": arm, "game": game, "sps": 0,
                         "error": repr(e)[:200]}
                if r.get("sps", 0) > 0:
                    break
                if attempt < args.retries:
                    print(f"  [{arm}/{game}] retrying "
                          f"(attempt {attempt + 2})", flush=True)
            arm_rec["rows"].append(r)
            print(r, flush=True)
            flush()
        arm_rec["geomean_sps"] = geomean(
            [r.get("sps", 0) for r in arm_rec["rows"]])
        flush()

    # A3/A4 cross-check against the published 1.35x
    a3 = result["arms"].get("a3", {}).get("geomean_sps", 0)
    a4 = result["arms"].get("a4", {}).get("geomean_sps", 0)
    if a3 and a4:
        result["a4_over_a3_geomean"] = round(a4 / a3, 3)
        per_game = {}
        rows3 = {r["game"]: r.get("sps", 0)
                 for r in result["arms"]["a3"]["rows"]}
        for r in result["arms"]["a4"]["rows"]:
            g = r["game"]
            if rows3.get(g, 0) > 0 and r.get("sps", 0) > 0:
                per_game[g] = round(r["sps"] / rows3[g], 3)
        result["a4_over_a3_per_game"] = per_game
        print(f"\nA4/A3 geomean ratio: {result['a4_over_a3_geomean']} "
              f"(published tab:dbuf-ablation: 1.35)", flush=True)
    flush()
    for arm, rec in result["arms"].items():
        print(f"{arm}: geomean {rec.get('geomean_sps', 0):,} "
              f"({[r.get('sps') for r in rec['rows']]})")
    failed = [(a, r["game"]) for a, rec in result["arms"].items()
              for r in rec["rows"] if r.get("sps", 0) <= 0]
    if failed:
        print("*" * 68)
        print(f"*** FAILED runs excluded from geomeans: {failed}")
        print("*" * 68)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
