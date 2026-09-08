"""Training-SPS suite bench: the record config across all 16 procgen
replicas, for the training-throughput companion to the env-SPS figure.

For each game: launch the full trainer (subprocess, huge total_steps) with
the record topology (NatureCNN ff V-trace, full node: 1 learner GPU + 3
inference GPUs + 15 vec workers), stream its log, collect the monitor's
60s `sps=` windows, and SIGINT after `--windows` clean ones (train() has a
clean KeyboardInterrupt path). Reported per-game SPS = median of the clean
windows excluding the first (compile/ramp). Prints mean + geomean at the
end and writes a bar-chart-ready JSON.

Runs INSIDE a full-node allocation (see scripts/bench_train_suite.sh).
Game #1 pays the inductor autotune (~2-4 min); the rest hit the cache.

    python tools/bench_train_suite.py \
        --template configs/pt_throughput/pt_bigfish_nature_fullnode.json \
        --out outputs/bench_train_suite.json
"""
from __future__ import annotations

import argparse
import json
import math
import re
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PROCGEN16 = ("plunder bigfish bossfight ninja starpilot leaper heist "
             "dodgeball jumper maze caveflyer chaser climber fruitbot "
             "coinrun miner").split()

SPS_RE = re.compile(r"\bsps=([0-9][0-9.]*)")


def bench_game(game: str, template: dict, windows_needed: int,
               max_minutes: float, keep_logs: Path | None,
               rdzv_port: int = 29400) -> dict:
    cfg = dict(template)
    cfg["game"] = game
    cfg["total_steps"] = 10 ** 12  # driver stops the run, not the budget
    # One rendezvous port per game. A game that hits max_minutes is SIGINT-ed,
    # and its DDP rank-1 child outlives the rank 0 we killed -- that orphan keeps
    # retrying the port, so the NEXT game collided on the hard-coded 29400 and
    # died during init_process_group with zero scalars logged. Failures tracked
    # timed-out predecessors 4-for-4 (jobs 37796722/37796735).
    cfg["ddp_rdzv_port"] = rdzv_port
    cfg["log_dir"] = f"outputs/bench_train_suite/{game}"
    with tempfile.NamedTemporaryFile("w", suffix=f"_{game}.json",
                                     delete=False) as f:
        json.dump(cfg, f)
        cfg_path = f.name

    proc = subprocess.Popen(
        [sys.executable, "-m", "analogen.train_impala", "--config", cfg_path],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    windows: list[float] = []
    t0 = time.time()
    log_lines: list[str] = []
    interrupted = False
    try:
        for line in proc.stdout:
            log_lines.append(line)
            m = SPS_RE.search(line)
            if m:
                w = float(m.group(1))
                if w > 5000:  # skip compile/idle windows
                    windows.append(w)
                    print(f"  [{game}] window {len(windows)}: {w:,.0f} sps",
                          flush=True)
            timed_out = time.time() - t0 > max_minutes * 60
            if (len(windows) >= windows_needed or timed_out) \
                    and not interrupted:
                proc.send_signal(signal.SIGINT)
                interrupted = True
        proc.wait(timeout=180)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
    if keep_logs:
        keep_logs.mkdir(parents=True, exist_ok=True)
        # head AND tail: a startup crash puts the traceback at the top, and
        # NCCL retry spam from the surviving rank can be thousands of lines,
        # which evicted the root cause when this kept the tail alone.
        keep = (log_lines if len(log_lines) <= 800 else
                log_lines[:400] + ["\n... [trimmed] ...\n"] + log_lines[-400:])
        (keep_logs / f"{game}.log").write_text("".join(keep))

    steady = windows[1:] if len(windows) > 1 else windows
    sps = sorted(steady)[len(steady) // 2] if steady else 0.0
    row = {"game": game, "sps": round(sps), "windows": [round(w)
           for w in windows], "minutes": round((time.time() - t0) / 60, 1)}
    if not steady:
        # No throughput window was ever parsed: the run stalled or died rather
        # than ran slowly. Flag it, because "sps 0" reads like a measurement and
        # a reader skimming a geomean will not notice the games_ok count.
        # Seen in practice: the second DDP learner intermittently fails to take
        # its GPU under MPS (cudaErrorDevicesUnavailable in ddp_learner), the
        # run hangs, and no stats are emitted.
        row["failed"] = True
        row["error"] = f"no sps windows parsed - see suite_logs/{game}.log"
        print(f"  [{game}] *** FAILED: no sps windows parsed ***", flush=True)
    return row


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--template", type=Path, required=True)
    p.add_argument("--games", default=",".join(PROCGEN16))
    p.add_argument("--windows", type=int, default=4)
    p.add_argument("--max-minutes", type=float, default=10.0)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--settle-seconds", type=float, default=20.0,
                   help="pause between games so the previous "
                        "learner releases its GPUs")
    p.add_argument("--retries", type=int, default=1)
    args = p.parse_args()

    template = json.loads(args.template.read_text())
    rows = []
    for gi, game in enumerate(args.games.split(",")):
        print(f"=== {game} ===", flush=True)
        # The previous game's learner ranks can still hold their GPUs when the
        # next one starts: rank 1 then dies with "could not acquire cuda:1 ...
        # device(s) is/are busy", which surfaces as "no sps windows parsed" and
        # silently drops the game from the geomean. Settling between games and
        # retrying once turns that race into a delay instead of a hole in the
        # suite. Six of 24 games were lost to it in job 38145467.
        r = None
        for attempt in range(args.retries + 1):
            if gi or attempt:
                time.sleep(args.settle_seconds)
            try:
                r = bench_game(game, template, args.windows, args.max_minutes,
                               keep_logs=args.out.parent / "suite_logs",
                               rdzv_port=29400 + gi + 100 * attempt)
            except Exception as e:  # noqa: BLE001
                r = {"game": game, "sps": 0, "error": repr(e)[:200]}
            if r.get("sps", 0) > 0:
                break
            if attempt < args.retries:
                print(f"  [{game}] retrying after {args.settle_seconds}s "
                      f"(attempt {attempt + 2}/{args.retries + 1})", flush=True)
        rows.append(r)
        print(r, flush=True)

    failed = [r["game"] for r in rows if r.get("sps", 0) <= 0]
    ok = [r["sps"] for r in rows if r.get("sps", 0) > 0]
    summary = {
        "rows": rows,
        "mean_sps": round(sum(ok) / max(len(ok), 1)),
        "geomean_sps": round(math.exp(
            sum(math.log(s) for s in ok) / max(len(ok), 1))) if ok else 0,
        "games_ok": len(ok), "games_total": len(rows),
        "games_failed": failed,
        "template": str(args.template),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(summary, indent=2))
    print(f"\nMEAN {summary['mean_sps']:,}  GEOMEAN {summary['geomean_sps']:,}"
          f"  ({summary['games_ok']}/{summary['games_total']} games)")
    if failed:
        # Loud, because the geomean above is over the SURVIVORS only and looks
        # perfectly healthy either way.
        print("*" * 68)
        print(f"*** {len(failed)} GAME(S) FAILED and are EXCLUDED from the "
              f"numbers above: {', '.join(failed)}")
        print(f"*** The geomean covers {summary['games_ok']} of "
              f"{summary['games_total']} games. Re-run the failures before "
              f"quoting it as a suite result.")
        print("*" * 68)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
