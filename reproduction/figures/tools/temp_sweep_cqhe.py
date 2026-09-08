"""Temperature sweep on the cavequest_hard_explore no-holdout checkpoints.

Settles the greedy-vs-sampled collapse: greedy (T=0) win rate ~0 while sampled
(T=1) ~0.6. This sweeps T in {0, 0.1, 0.25, 0.5, 1.0} on the NORMAL game, all 360
bindings, per run. If win rate holds down to T~0.1 and only craters at T=0 the
policy is *almost* argmax-stable (sharpening/entropy-anneal will recover greedy);
if it degrades smoothly the policy is genuinely sampling-dependent.

Writes outputs/<run>/temp_sweep_T{t}.json per (run, T). Skips-existing (resumable).
Parallel over run-dir x temperature. Mirrors reeval_hard_all360.py (MAXDEC=800,
binding_set='all', normal game)."""
import os, sys, json, glob
from pathlib import Path
from multiprocessing import Pool

REPO = Path(os.environ.get("ANALOGEN_REPO", Path(__file__).resolve().parents[1]))
os.environ.setdefault("PLAYTRAIN_GAMES_DIR", str(REPO / "games" / "js"))
sys.path.insert(0, str(REPO / "tools"))

GAME = "analogen_cavequest_hard_explore"
TEMPS = [float(x) for x in os.environ.get("TEMPS", "0,0.1,0.25,0.5,1.0").split(",")]
NPROC = int(os.environ.get("NPROC", "32"))
MAXDEC = int(os.environ.get("MAXDEC", "800"))


def tag(t):
    return ("%g" % t).replace(".", "p")  # 0 -> "0", 0.25 -> "0p25"


def run_dirs():
    ds = sorted(glob.glob(str(REPO / "outputs/impala_cqhe_nohd_N*_s*")), reverse=True)
    return [d for d in ds if (Path(d) / "final.pt").exists()]


def work(task):
    import torch
    from eval_generalization import evaluate_run, WIN_RETURN_THRESHOLD
    rd, t = task
    out = Path(rd) / f"temp_sweep_T{tag(t)}.json"
    if out.exists():
        return (Path(rd).name, t, "skip")
    try:
        res = evaluate_run(Path(rd), device=torch.device("cpu"),
                           win_threshold=WIN_RETURN_THRESHOLD, max_decisions=MAXDEC,
                           deterministic=(t <= 0), temperature=t,
                           game_override=GAME, binding_set="all")
        res["binding_set"] = "all"; res["eval_game"] = GAME
        res["temperature"] = t; res["recolor"] = "none"
        out.write_text(json.dumps(res))
        return (Path(rd).name, t,
                f"wr={res['heldout_win_rate']:.2f} ret={res['heldout_mean_return']:.0f} n={res['n_eval']}")
    except Exception as e:  # noqa: BLE001
        return (Path(rd).name, t, f"ERR {e}")


if __name__ == "__main__":
    rds = run_dirs()
    tasks = [(rd, t) for rd in rds for t in TEMPS]
    print(f"{len(rds)} runs x {len(TEMPS)} temps = {len(tasks)} evals, "
          f"NPROC={NPROC} MAXDEC={MAXDEC} TEMPS={TEMPS}", flush=True)
    done = errs = 0
    with Pool(NPROC) as p:
        for r in p.imap_unordered(work, tasks):
            done += 1
            if "ERR" in r[2]: errs += 1
            if done % 20 == 0 or "ERR" in r[2]:
                print(f"[{done}/{len(tasks)}] {r}", flush=True)
    print(f"DONE  ({errs} errors)", flush=True)
