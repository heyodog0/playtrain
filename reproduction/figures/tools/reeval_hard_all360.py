"""Re-eval the cavequest_hard_explore no-holdout sweep on ALL 360 bindings, 4
visual conditions, using SAMPLED actions (deterministic=False).

Hard's greedy/argmax policy collapses (eval/greedy_return ~1000 while the sampled
policy returns ~45k), so generalization must be measured with sampling. Records
heldout_mean_return (the metric we plot vs N) + per_seed. Parallel over
run-dir x condition. Sampled episodes end early (win=death/terminal), so a 2000
cap is ample and keeps eval fast."""
import os, sys, json, glob
from pathlib import Path
from multiprocessing import Pool

REPO = Path(os.environ.get("ANALOGEN_REPO", Path(__file__).resolve().parents[1]))
os.environ.setdefault("PLAYTRAIN_GAMES_DIR", str(REPO / "games" / "js"))
sys.path.insert(0, str(REPO / "tools"))

G = "analogen_cavequest_hard_explore"
CONDS = [(G, "_all360"), (G + "_recolor", "_all360_recolor"),
         (G + "_mono", "_all360_mono"), (G + "_swap", "_all360_swap")]
NPROC = int(os.environ.get("NPROC", "32"))
# 800 caps at ~1.4x the observed win length (~575) — captures every real solve
# while bounding the wandering non-solvers (multiple lives → they'd otherwise run
# to the cap on nearly every binding). At 2000 the low-N evals starved the pool.
MAXDEC = int(os.environ.get("MAXDEC", "800"))


def run_dirs():
    # HIGH-N first (reversed): those runs solve fast (short episodes) so their
    # JSONs land early — the reeval skips-existing, so a partial/timed-out run
    # still yields the interesting high-N end and is resumable for the slow tail.
    ds = sorted(glob.glob(str(REPO / "outputs/impala_cqhe_nohd_N*_s*")), reverse=True)
    return [d for d in ds if (Path(d) / "final.pt").exists()]


def work(task):
    import torch
    from eval_generalization import evaluate_run, WIN_RETURN_THRESHOLD
    rd, game, suffix = task
    out = Path(rd) / f"heldout_eval{suffix}.json"
    if out.exists():
        return (Path(rd).name, suffix, "skip")
    try:
        res = evaluate_run(Path(rd), device=torch.device("cpu"),
                           win_threshold=WIN_RETURN_THRESHOLD, max_decisions=MAXDEC,
                           deterministic=False,  # SAMPLED — argmax collapses on hard
                           game_override=game, binding_set="all")
        res["binding_set"] = "all"; res["eval_game"] = game
        res["sampled"] = True; res["recolor"] = "none"
        out.write_text(json.dumps(res))
        return (Path(rd).name, suffix,
                f"ret={res['heldout_mean_return']:.0f} wr={res['heldout_win_rate']:.2f} n={res['n_eval']}")
    except Exception as e:  # noqa: BLE001
        return (Path(rd).name, suffix, f"ERR {e}")


if __name__ == "__main__":
    rds = run_dirs()
    tasks = [(rd, g, s) for rd in rds for g, s in CONDS]
    print(f"{len(rds)} runs x {len(CONDS)} conds = {len(tasks)} evals, "
          f"NPROC={NPROC} MAXDEC={MAXDEC} SAMPLED", flush=True)
    done = errs = 0
    with Pool(NPROC) as p:
        for r in p.imap_unordered(work, tasks):
            done += 1
            if "ERR" in r[2]: errs += 1
            if done % 20 == 0 or "ERR" in r[2]:
                print(f"[{done}/{len(tasks)}] {r}", flush=True)
    print(f"DONE  ({errs} errors)", flush=True)
