"""Paper figure generators — three figures matching the OpenAI ProcGen paper.

Reads a sweep produced by `fast_games.sweep` (under `outputs/sweeps/{ID}/`)
and writes PDFs into `figures/{ID}/`. Each figure is a separate function so
the paper writeup can regenerate any one in isolation.

  Fig 2 — per-game training curves (mean ± seed-std)
  Fig 3 — mean normalized return curve, aggregated across games
  Fig 4 — train vs. test return per game (generalization gap)

Usage:
    uv run python -m fast_games.figures --sweep ppo_20260424_120000
    uv run python -m fast_games.figures --sweep multigame_20260424 --figs fig3 fig4
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from fast_games.constants import (
    CANONICAL_GAMES,
    get_best_baselines,
    get_random_baselines,
    normalize_procgen,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SWEEPS_DIR = REPO_ROOT / "outputs" / "sweeps"
FIGURES_DIR = REPO_ROOT / "figures"


@dataclass
class RunCurve:
    game: str
    seed: int
    timesteps: np.ndarray   # shape (T,)
    returns: np.ndarray     # shape (T,) — mean over n_eval_episodes per timestep
    eval_kind: str          # "test" or "train"


def _load_eval_npz(eval_dir: Path) -> tuple[np.ndarray, np.ndarray] | None:
    p = eval_dir / "evaluations.npz"
    if not p.exists():
        return None
    data = np.load(str(p))
    if "results" not in data or len(data["results"]) == 0:
        return None
    timesteps = data["timesteps"]
    # `results` is shape (T, n_eval_episodes); average per checkpoint
    returns = data["results"].mean(axis=1)
    return timesteps, returns


def discover_runs(sweep_root: Path) -> list[RunCurve]:
    """Walk a sweep directory and load every (game, seed) curve found."""
    curves: list[RunCurve] = []
    for game_dir in sorted(sweep_root.iterdir()):
        if not game_dir.is_dir() or game_dir.name.startswith("."):
            continue
        if game_dir.name == "multigame":
            # Multigame runs have one entry per seed, not per game
            for seed_dir in sorted(game_dir.iterdir()):
                if not seed_dir.is_dir():
                    continue
                seed = _seed_from_dirname(seed_dir.name)
                # multigame logs both eval/ (test) and eval_train/
                for kind, sub in [("test", "eval"), ("train", "eval_train")]:
                    loaded = _load_eval_npz(seed_dir / sub)
                    if loaded is not None:
                        ts, ret = loaded
                        curves.append(RunCurve("multigame", seed, ts, ret, kind))
            continue
        game = game_dir.name
        for seed_dir in sorted(game_dir.iterdir()):
            if not seed_dir.is_dir():
                continue
            seed = _seed_from_dirname(seed_dir.name)
            loaded = _load_eval_npz(seed_dir / "eval")
            if loaded is not None:
                ts, ret = loaded
                curves.append(RunCurve(game, seed, ts, ret, "test"))
    return curves


def _seed_from_dirname(name: str) -> int:
    # e.g., "seed0" -> 0
    if name.startswith("seed"):
        try:
            return int(name[4:])
        except ValueError:
            return -1
    return -1


def _common_grid(curves: list[RunCurve]) -> np.ndarray:
    """Return the union of all timesteps across runs (sorted, dedup)."""
    all_t = np.concatenate([c.timesteps for c in curves]) if curves else np.array([])
    return np.unique(all_t)


def _interp_to_grid(curve: RunCurve, grid: np.ndarray) -> np.ndarray:
    """Interpolate one run onto the common timestep grid (left-fill before first eval)."""
    if len(curve.timesteps) == 0:
        return np.full_like(grid, np.nan, dtype=np.float64)
    return np.interp(grid, curve.timesteps, curve.returns,
                     left=curve.returns[0], right=curve.returns[-1])


# ---------------------------------------------------------------------------
# Figure 2 — per-game training curves
# ---------------------------------------------------------------------------

def fig2_per_game_curves(curves: list[RunCurve], out_dir: Path,
                          eval_kind: str = "test") -> Path:
    import matplotlib.pyplot as plt

    games = sorted({c.game for c in curves if c.eval_kind == eval_kind})
    if not games:
        raise SystemExit(f"fig2: no curves found for eval_kind={eval_kind!r}")

    n = len(games)
    cols = min(5, n)
    rows = (n + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(3.2 * cols, 2.4 * rows),
                             squeeze=False, sharex=False)

    for i, game in enumerate(games):
        ax = axes[i // cols][i % cols]
        runs = [c for c in curves if c.game == game and c.eval_kind == eval_kind]
        if not runs:
            ax.set_visible(False)
            continue
        grid = _common_grid(runs)
        stacked = np.vstack([_interp_to_grid(r, grid) for r in runs])
        mean = stacked.mean(axis=0)
        std = stacked.std(axis=0) if len(runs) > 1 else np.zeros_like(mean)
        ax.plot(grid, mean, color="#0a52a1", lw=1.5)
        if len(runs) > 1:
            ax.fill_between(grid, mean - std, mean + std, alpha=0.2, color="#0a52a1")
        ax.set_title(f"{game}  (n={len(runs)})", fontsize=10)
        ax.tick_params(labelsize=8)
        ax.grid(alpha=0.3, linestyle="--")

    # Hide unused axes
    for j in range(n, rows * cols):
        axes[j // cols][j % cols].set_visible(False)

    fig.supxlabel("timesteps")
    fig.supylabel(f"mean episode return ({eval_kind})")
    fig.tight_layout()

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"fig2_per_game_{eval_kind}.pdf"
    fig.savefig(out_path)
    plt.close(fig)
    return out_path


# ---------------------------------------------------------------------------
# Figure 3 — mean normalized return curve, aggregated across games
# ---------------------------------------------------------------------------

def fig3_mean_normalized_curve(curves: list[RunCurve], out_dir: Path) -> Path:
    import matplotlib.pyplot as plt

    random_bl = get_random_baselines()
    best_bl = get_best_baselines()

    games = sorted({c.game for c in curves if c.game != "multigame"})
    if not games:
        # Multigame mode: each "game" entry is the multigame policy itself
        games = sorted({c.game for c in curves})

    grid = _common_grid([c for c in curves if c.eval_kind == "test"])
    if len(grid) == 0:
        raise SystemExit("fig3: no test-eval curves to aggregate")

    # Build a stack: rows = (game, seed), columns = grid
    rows: list[np.ndarray] = []
    for game in games:
        runs = [c for c in curves if c.game == game and c.eval_kind == "test"]
        rand = random_bl.get(game)
        best = best_bl.get(game)
        for r in runs:
            interp = _interp_to_grid(r, grid)
            if rand is not None and best is not None:
                interp = np.array([normalize_procgen(v, rand, best) for v in interp])
            rows.append(interp)

    if not rows:
        raise SystemExit("fig3: nothing to plot after normalization")

    stacked = np.vstack(rows)
    mean = stacked.mean(axis=0)
    std = stacked.std(axis=0)

    fig, ax = plt.subplots(figsize=(7.5, 4.5))
    ax.plot(grid, mean, color="#0a52a1", lw=2, label=f"mean over {len(rows)} runs")
    ax.fill_between(grid, mean - std, mean + std, alpha=0.2, color="#0a52a1")
    ax.set_xlabel("timesteps")
    ax.set_ylabel("normalized return  (agent − random) / (best − random)"
                  if random_bl and best_bl else "raw return")
    ax.set_title(f"Mean normalized return across {len(games)} games")
    ax.grid(alpha=0.3, linestyle="--")
    ax.legend(loc="lower right")
    fig.tight_layout()

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "fig3_mean_normalized.pdf"
    fig.savefig(out_path)
    plt.close(fig)
    return out_path


# ---------------------------------------------------------------------------
# Figure 4 — train vs test return per game (generalization gap)
# ---------------------------------------------------------------------------

def fig4_train_test_gap(curves: list[RunCurve], out_dir: Path) -> Path:
    import matplotlib.pyplot as plt

    # We need both kinds present — per game, take the FINAL eval return
    games = sorted({c.game for c in curves})
    train_finals: dict[str, list[float]] = {}
    test_finals: dict[str, list[float]] = {}
    for game in games:
        for c in curves:
            if c.game != game:
                continue
            final = float(c.returns[-1])
            target = train_finals if c.eval_kind == "train" else test_finals
            target.setdefault(game, []).append(final)

    games_with_both = sorted([g for g in games
                              if g in train_finals and g in test_finals])
    if not games_with_both:
        raise SystemExit("fig4: need both train- and test-eval curves "
                         "(re-run multigame with --dual-eval)")

    train_means = [np.mean(train_finals[g]) for g in games_with_both]
    test_means = [np.mean(test_finals[g]) for g in games_with_both]
    train_stds = [np.std(train_finals[g]) if len(train_finals[g]) > 1 else 0
                  for g in games_with_both]
    test_stds = [np.std(test_finals[g]) if len(test_finals[g]) > 1 else 0
                 for g in games_with_both]

    x = np.arange(len(games_with_both))
    width = 0.4
    fig, ax = plt.subplots(figsize=(max(7.5, 0.4 * len(games_with_both)), 4.5))
    ax.bar(x - width / 2, train_means, width, yerr=train_stds, capsize=3,
           color="#0a52a1", label="train levels")
    ax.bar(x + width / 2, test_means, width, yerr=test_stds, capsize=3,
           color="#8a1a1a", label="test levels (held out)")
    ax.set_xticks(x)
    ax.set_xticklabels(games_with_both, rotation=45, ha="right", fontsize=8)
    ax.set_ylabel("final mean episode return")
    ax.set_title("Generalization gap: train vs. held-out test levels")
    ax.grid(alpha=0.3, linestyle="--", axis="y")
    ax.legend()
    fig.tight_layout()

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "fig4_train_test_gap.pdf"
    fig.savefig(out_path)
    plt.close(fig)
    return out_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

FIGURE_FNS = {
    "fig2": fig2_per_game_curves,
    "fig3": fig3_mean_normalized_curve,
    "fig4": fig4_train_test_gap,
}


def main() -> int:
    p = argparse.ArgumentParser(description="Generate paper figures from a sweep")
    p.add_argument("--sweep", type=str, required=True,
                   help="Sweep ID under outputs/sweeps/")
    p.add_argument("--figs", nargs="+", default=["fig2", "fig3", "fig4"],
                   choices=list(FIGURE_FNS.keys()))
    args = p.parse_args()

    sweep_root = SWEEPS_DIR / args.sweep
    if not sweep_root.exists():
        raise SystemExit(f"sweep not found: {sweep_root}")

    out_dir = FIGURES_DIR / args.sweep
    curves = discover_runs(sweep_root)
    if not curves:
        raise SystemExit(f"no eval curves found under {sweep_root}")
    print(f"loaded {len(curves)} run-curves from {sweep_root}")

    manifest_path = sweep_root / "manifest.json"
    manifest = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())

    written: list[Path] = []
    for name in args.figs:
        fn = FIGURE_FNS[name]
        try:
            path = fn(curves, out_dir)
            written.append(path)
            print(f"  wrote {path}")
        except SystemExit as exc:
            print(f"  skip {name}: {exc}")

    summary = {
        "sweep": args.sweep,
        "n_curves": len(curves),
        "manifest": manifest,
        "figures": [str(p.relative_to(REPO_ROOT)) for p in written],
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
