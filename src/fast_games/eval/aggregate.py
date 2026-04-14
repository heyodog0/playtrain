"""Aggregate experiment results across games and algorithms.

Scans outputs/experiments/ for completed runs, loads eval logs,
and computes normalized scores and aggregate metrics.

Usage:
    uv run python -m fast_games.eval.aggregate
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from fast_games.metrics import aggregate_results, compute_normalized_scores, interquartile_mean, load_random_baselines

EXPERIMENTS_DIR = Path(__file__).resolve().parents[3] / "outputs" / "experiments"
BASELINES_PATH = Path(__file__).resolve().parents[3] / "outputs" / "baselines" / "random_agent_scores.json"
OUTPUT_DIR = Path(__file__).resolve().parents[3] / "outputs" / "results"


def find_experiments() -> dict[str, dict[str, list[Path]]]:
    """Scan experiments directory. Returns {game: {algorithm: [run_dirs]}}."""
    results: dict[str, dict[str, list[Path]]] = {}

    if not EXPERIMENTS_DIR.exists():
        return results

    for game_dir in sorted(EXPERIMENTS_DIR.iterdir()):
        if not game_dir.is_dir() or game_dir.name == "multigame":
            continue
        game = game_dir.name
        results[game] = {}
        for algo_dir in sorted(game_dir.iterdir()):
            if not algo_dir.is_dir():
                continue
            algo = algo_dir.name
            runs = sorted([d for d in algo_dir.iterdir() if d.is_dir()])
            if runs:
                results[game][algo] = runs

    return results


def load_eval_results(run_dir: Path) -> dict | None:
    """Load evaluation results from a run directory."""
    eval_dir = run_dir / "eval"
    if not eval_dir.exists():
        return None

    evaluations = eval_dir / "evaluations.npz"
    if evaluations.exists():
        data = np.load(str(evaluations))
        return {
            "timesteps": data["timesteps"].tolist(),
            "results": data["results"].tolist(),
            "ep_lengths": data["ep_lengths"].tolist(),
            "best_mean_reward": float(data["results"].mean(axis=1).max()),
            "final_mean_reward": float(data["results"][-1].mean()) if len(data["results"]) > 0 else 0.0,
        }
    return None


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load random baselines
    baselines = {}
    if BASELINES_PATH.exists():
        baselines = load_random_baselines(BASELINES_PATH)
        print(f"Loaded random baselines for {len(baselines)} games")
    else:
        print(f"No baselines found at {BASELINES_PATH}")
        print("Run: uv run python -m fast_games.eval.baselines --all")

    # Find experiments
    experiments = find_experiments()
    if not experiments:
        print("No experiments found in outputs/experiments/")
        return

    # Aggregate per algorithm
    algo_scores: dict[str, dict[str, float]] = {}  # {algo: {game: best_mean_reward}}

    print(f"\n{'Game':<20} {'Algo':<8} {'Best Mean':>10} {'Runs':>5}")
    print("-" * 50)

    for game, algos in experiments.items():
        for algo, runs in algos.items():
            best_reward = float("-inf")
            for run_dir in runs:
                eval_data = load_eval_results(run_dir)
                if eval_data:
                    best_reward = max(best_reward, eval_data["best_mean_reward"])

            if best_reward > float("-inf"):
                if algo not in algo_scores:
                    algo_scores[algo] = {}
                algo_scores[algo][game] = best_reward
                print(f"{game:<20} {algo:<8} {best_reward:>10.1f} {len(runs):>5}")

    # Normalize and aggregate
    if baselines and algo_scores:
        print(f"\n{'=' * 60}")
        print("Normalized Scores (IQM)")
        print(f"{'=' * 60}")

        summary = {}
        for algo, scores in algo_scores.items():
            normalized = compute_normalized_scores(scores, baselines)
            agg = aggregate_results(normalized)
            summary[algo] = {
                "per_game_raw": scores,
                "per_game_normalized": normalized,
                "aggregate": agg,
            }
            print(f"\n  {algo.upper()}")
            for game, ns in sorted(normalized.items()):
                raw = scores[game]
                print(f"    {game:<20} raw={raw:>8.1f}  normalized={ns:>6.2f}")
            print(f"    {'---':<20}")
            print(f"    IQM: {agg.get('iqm', 0):.2f}  Mean: {agg.get('mean', 0):.2f}  Median: {agg.get('median', 0):.2f}")

        # Save
        output = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "algorithms": summary,
            "baselines_source": str(BASELINES_PATH),
        }
        out_path = OUTPUT_DIR / "summary.json"
        out_path.write_text(json.dumps(output, indent=2, default=str) + "\n")
        print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    main()
