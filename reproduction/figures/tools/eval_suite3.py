"""tab:eval on the 3-seed 100M IMPALA-CNN runs, both trainers.

Reads the committed evaluator outputs
    results/eval_s3_icnn_s{0,1,2}.json   IMPALA  (job 41853620)
    results/eval_p3_icnn_s{0,1,2}.json   PPO     (job 47073317)
which ran eval_final_agents.py / eval_final_agents_ppo.py with the published
protocol (greedy final checkpoint, held-out seeds 9,000,000..9,000,007, 3,000-step
cap, random policy on the same seeds). Prints the per-trainer means and writes
tab:eval's LaTeX table to OUT/tab_eval3.tex.

    uv run --no-project python tools/eval_suite3.py [OUT_DIR]
"""
import json
import statistics as st
import sys
from pathlib import Path

FIG = Path(__file__).resolve().parents[1]
RES = FIG / "results"
out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else FIG.parent / "out"


def load(prefix):
    return [json.load(open(RES / f"{prefix}_s{i}.json")) for i in range(3)]


def main():
    tab = json.load(open(RES / "eval_iddp_suite.json"))
    I, P = load("eval_s3_icnn"), load("eval_p3_icnn")
    games = sorted(tab)
    rows, bad_r = [], 0
    for g in games:
        r = I[0][g]["random_return"]
        if any(abs(s[g]["random_return"] - r) > 1e-6 for s in I + P):
            bad_r += 1
        gi = [s[g]["greedy_return"] for s in I]
        gp = [s[g]["greedy_return"] for s in P]
        rows.append((g, r, tab[g]["greedy_return"], st.fmean(gi), st.pstdev(gi), st.fmean(gp), st.pstdev(gp)))
    print(f"    {'game':15}{'R':>7}{'G IMPALA x3':>13}{'sd':>6}{'G PPO x3':>11}{'sd':>6}")
    for g, r, gt, mi, si, mp, sp in rows:
        print(f"    {g:15}{r:>7.1f}{mi:>13.1f}{si:>6.1f}{mp:>11.1f}{sp:>6.1f}")
    wins_p = sum(mp > mi * 1.02 for _, _, _, mi, _, mp, _ in rows)
    wins_i = sum(mi > mp * 1.02 for _, _, _, mi, _, mp, _ in rows)
    print(f"    held-out greedy, 3-seed means, 2% band: PPO ahead on {wins_p}, IMPALA on {wins_i}, ties {24 - wins_p - wins_i}")
    print(f"    random column identical across all six files: {'yes' if bad_r == 0 else f'NO, {bad_r} games differ'}")

    out_dir.mkdir(parents=True, exist_ok=True)
    half = len(rows) // 2
    lines = [r"\begin{table}[t]",
             r"\caption{Mean return over 8 held-out level seeds, averaged over three training seeds, "
             r"for IMPALA and PPO with the IMPALA-CNN encoder after 100M steps (the runs in "
             r"Figure~\ref{fig:suite_trainers}). R = random policy on the same seeds; the greedy "
             r"final checkpoint is evaluated.}",
             r"\label{tab:eval}", r"\centering", r"\small",
             r"\begin{tabular}{lrrr@{\hskip 2.5em}lrrr}", r"\toprule",
             r"game & R & IMPALA & PPO & game & R & IMPALA & PPO \\", r"\midrule"]
    for a, b in zip(rows[:half], rows[half:]):
        def cell(x):
            g, r, _, mi, _, mp, _ = x
            return f"{g.replace('_', chr(92) + '_')} & {r:.1f} & {mi:.1f} & {mp:.1f}"
        lines.append(f"{cell(a)} & {cell(b)} \\\\")
    lines += [r"\bottomrule", r"\end{tabular}", r"\end{table}"]
    (out_dir / "tab_eval3.tex").write_text("\n".join(lines) + "\n")
    print(f"    wrote {out_dir / 'tab_eval3.tex'}  (mean over 3 seeds x 8 held-out level seeds; R = random, same seeds)")
    return 1 if bad_r else 0


if __name__ == "__main__":
    raise SystemExit(main())
