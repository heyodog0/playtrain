"""One index of every run and benchmark on disk -> CSV + JSON.

WHY: identity was being re-derived by globbing directory names in each
consumer, and each did it slightly differently. That is how IMPALA-CNN IMPALA
curves ended up plotted against Nature PPO curves in 13 of 16 comparisons
(the selector filtered on game and steps but not `net`), and how a headline
number ended up with a config and a README row but no locatable log.

Everything downstream -- plot selectors, paper numbers, "what have we run" --
should read this index instead of globbing.

usage:
    python tools/run_index.py                 # write results/run_index.{csv,json}
    python tools/run_index.py --check         # also report gaps/mismatches, exit 1 if any
    python tools/run_index.py --grep bigfish  # print matching rows
"""
import argparse, csv, glob, hashlib, json, os, sys

TRAIN_COLS = [
    "kind", "run", "trainer", "game", "net", "seed", "steps_cfg", "steps_done",
    "complete", "final_return", "batch", "n_envs", "n_steps", "n_minibatches",
    "unroll", "vec_workers", "vec_threads", "double_buffer", "worker_device",
    "learner_gpus", "precision", "compiled", "ddp", "env_threads",
    "mps", "node", "cfg_hash", "path",
]


def _tb(d):
    """(last_step, final_return, n_points) from the run's TensorBoard log."""
    fs = (glob.glob(f"{d}/tb/**/events*", recursive=True)
          or glob.glob(f"{d}/tb/events*"))
    if not fs:
        return None, None, 0
    try:
        from tensorboard.backend.event_processing.event_accumulator import EventAccumulator
        ea = EventAccumulator(sorted(fs)[-1]); ea.Reload()
        tags = ea.Tags().get("scalars", [])
        tag = next((t for t in ("charts/ep_return_mean", "episode_return") if t in tags), None)
        if not tag:
            return None, None, 0
        s = ea.Scalars(tag)
        if not s:
            return None, None, 0
        n = max(1, len(s) // 20)
        return s[-1].step, sum(x.value for x in s[-n:]) / n, len(s)
    except Exception:
        return None, None, 0


def index_runs(root="outputs"):
    rows = []
    for cj in sorted(glob.glob(f"{root}/*/config.json") + glob.glob(f"{root}/*/*/config.json")):
        try:
            c = json.load(open(cj))
        except Exception:
            continue
        d = cj.rsplit("/", 1)[0]
        # PPO configs carry n_minibatches; IMPALA configs carry unroll_length.
        trainer = "ppo" if "n_minibatches" in c else ("impala" if "unroll_length" in c else "?")
        if trainer == "?":
            continue
        steps_cfg = c.get("total_steps") or c.get("total_timesteps") or 0
        last, ret, npts = _tb(d)
        rows.append({
            "kind": "run",
            "run": os.path.basename(d),
            "trainer": trainer,
            "game": c.get("game"),
            "net": c.get("net"),
            "seed": c.get("seed"),
            "steps_cfg": steps_cfg,
            "steps_done": last or 0,
            # a run counts as complete only if tb reached ~the configured budget
            "complete": bool(last and steps_cfg and last >= 0.97 * steps_cfg),
            "final_return": round(ret, 3) if ret is not None else None,
            "batch": c.get("batch_size"),
            "n_envs": c.get("n_envs"),
            "n_steps": c.get("n_steps"),
            "n_minibatches": c.get("n_minibatches"),
            "unroll": c.get("unroll_length"),
            "vec_workers": c.get("vec_workers"),
            "vec_threads": c.get("vec_env_threads"),
            "double_buffer": c.get("vec_double_buffer"),
            "worker_device": c.get("vec_worker_device"),
            "learner_gpus": c.get("learner_gpus"),
            "precision": c.get("learner_precision") or ("bf16" if c.get("bf16") else "fp32"),
            "compiled": bool(c.get("compile_learner") or c.get("compile_mode")),
            "ddp": c.get("ddp"),
            "env_threads": c.get("native_env_threads"),
            "mps": c.get("_mps"),        # only present if the run recorded it
            "node": c.get("_node"),
            "cfg_hash": hashlib.sha1(
                json.dumps({k: v for k, v in sorted(c.items())
                            if k not in ("log_dir", "seed")}).encode()).hexdigest()[:8],
            "path": d,
        })
    return rows


def index_benchmarks(root="outputs"):
    """Throughput sweeps: suite_*/sweep_*/db_ablate_* JSONs of {game, sps}."""
    rows = []
    for f in sorted(glob.glob(f"{root}/suite_*.json") + glob.glob(f"{root}/sweep_*.json")
                    + glob.glob(f"{root}/db_ablate_*.json")):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        recs = d.get("rows") if isinstance(d, dict) else (d if isinstance(d, list) else None)
        if not recs:
            continue
        for r in recs:
            if not (isinstance(r, dict) and "game" in r and "sps" in r):
                continue
            rows.append({
                "kind": "bench", "run": os.path.basename(f), "trainer": "impala",
                "game": r["game"], "sps": r["sps"], "windows": len(r.get("windows") or []),
                "minutes": r.get("minutes"), "path": f,
            })
    return rows


def check(runs, want_seeds=3):
    """Report the failure modes that have actually bitten this project.

    Counts DISTINCT seeds, not runs: the matrix holds several seed-0 runs per
    game, and a "3 runs" count that is really one seed three times would hide
    exactly the thing this is meant to catch.
    """
    problems = []
    by = {}                      # (game, trainer, net) -> {seed: [run, ...]}
    for r in runs:
        if r["complete"] and r["game"]:
            by.setdefault((r["game"], r["trainer"], r["net"]), {}) \
              .setdefault(r["seed"], []).append(r["run"])

    # For each game with BOTH trainers: is there an encoder where both have
    # enough seeds? If not, any figure pairing them is encoder-confounded --
    # this is the panel-C / human-figure bug.
    games = {}
    for (g, tr, net), seeds in by.items():
        games.setdefault(g, {}).setdefault(net, {})[tr] = len(seeds)
    for g, nets in sorted(games.items()):
        trainers = {tr for d in nets.values() for tr in d}
        if len(trainers) < 2:
            continue
        ok = [n for n, d in nets.items()
              if d.get("impala", 0) >= want_seeds and d.get("ppo", 0) >= want_seeds]
        if not ok:
            detail = {n: dict(d) for n, d in sorted(nets.items())}
            problems.append(f"NO MATCHED ENCODER  {g}: {detail}")

    # Distinct-seed shortfall, and duplicate runs at one seed.
    for (g, tr, net), seeds in sorted(by.items()):
        if len(seeds) < want_seeds:
            problems.append(
                f"FEW SEEDS           {g} {tr}/{net}: {len(seeds)} distinct "
                f"(have {sorted(seeds)})")
        dups = {sd: rs for sd, rs in seeds.items() if len(rs) > 1}
        if dups:
            problems.append(
                f"DUPLICATE SEED      {g} {tr}/{net}: " +
                "; ".join(f"seed {sd} x{len(rs)}" for sd, rs in sorted(dups.items())))
    return problems


ap = argparse.ArgumentParser()
ap.add_argument("--check", action="store_true")
ap.add_argument("--grep")
ap.add_argument("--out", default="results")
a = ap.parse_args()

runs, benches = index_runs(), index_benchmarks()
os.makedirs(a.out, exist_ok=True)
with open(f"{a.out}/run_index.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=TRAIN_COLS, extrasaction="ignore")
    w.writeheader()
    for r in runs:
        w.writerow(r)
with open(f"{a.out}/bench_index.csv", "w", newline="") as fh:
    cols = ["kind", "run", "trainer", "game", "sps", "windows", "minutes", "path"]
    w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for r in benches:
        w.writerow(r)
json.dump({"runs": runs, "benchmarks": benches},
          open(f"{a.out}/run_index.json", "w"), indent=1)
print(f"indexed {len(runs)} runs ({sum(r['complete'] for r in runs)} complete), "
      f"{len(benches)} benchmark rows -> {a.out}/run_index.csv, bench_index.csv, run_index.json")

if a.grep:
    hits = [r for r in runs if a.grep in json.dumps(r)]
    for r in hits:
        print(f"  {r['run']:34s} {r['trainer']:6s} {str(r['game']):16s} "
              f"net={str(r['net']):7s} s{r['seed']} {r['steps_done']:>11,}/{r['steps_cfg']:<11,} "
              f"{'OK' if r['complete'] else 'INCOMPLETE'}")
    print(f"  ({len(hits)} rows)")

if a.check:
    ps = check(runs)
    print(f"\n=== check: {len(ps)} problems ===")
    for p in ps:
        print("  " + p)
    sys.exit(1 if ps else 0)
