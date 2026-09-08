"""Re-eval balanced + random cavequest_easy finesweep checkpoints on ALL 360
bindings (binding_set='all') across the 4 visual conditions, writing
heldout_eval_all360{,_recolor,_mono,_swap}.json. Parallel over run-dir x condition.

Visual robustness is a new-env property testable on ANY binding, so we drop the
60-binding held-out restriction and score the full 360-binding space."""
import os, sys, json, glob
from pathlib import Path
from multiprocessing import Pool

REPO = Path(os.environ.get("ANALOGEN_REPO", Path(__file__).resolve().parents[1]))
os.environ.setdefault("PLAYTRAIN_GAMES_DIR", str(REPO / "games" / "js"))
sys.path.insert(0, str(REPO / "tools"))

CONDS = [("analogen_cavequest_easy", "_all360"),
         ("analogen_cavequest_easy_recolor", "_all360_recolor"),
         ("analogen_cavequest_easy_mono", "_all360_mono"),
         ("analogen_cavequest_easy_swap", "_all360_swap")]
NPROC = int(os.environ.get("NPROC", "8"))
MAXDEC = 200


def run_dirs():
    ds = sorted(glob.glob(str(REPO / "outputs/impala_cavequest_finesweep_N[0-9]*"))) + \
         sorted(glob.glob(str(REPO / "outputs/impala_cavequest_finesweep_rand_N*_s*"))) + \
         sorted(glob.glob(str(REPO / "outputs/impala_cavequest_finesweep_nohd_N*_s*")))
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
                           game_override=game, binding_set="all")
        res["binding_set"] = "all"; res["eval_game"] = game; res["recolor"] = "none"
        out.write_text(json.dumps(res))
        return (Path(rd).name, suffix, f"wr={res['heldout_win_rate']:.3f} n={res['n_eval']}")
    except Exception as e:  # noqa: BLE001
        return (Path(rd).name, suffix, f"ERR {e}")


if __name__ == "__main__":
    rds = run_dirs()
    tasks = [(rd, g, s) for rd in rds for g, s in CONDS]
    print(f"{len(rds)} runs x {len(CONDS)} conds = {len(tasks)} evals, NPROC={NPROC}", flush=True)
    done = errs = 0
    with Pool(NPROC) as p:
        for r in p.imap_unordered(work, tasks):
            done += 1
            if "ERR" in r[2]: errs += 1
            if done % 25 == 0 or "ERR" in r[2]:
                print(f"[{done}/{len(tasks)}] {r}", flush=True)
    print(f"DONE  ({errs} errors)", flush=True)
