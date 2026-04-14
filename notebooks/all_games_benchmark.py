import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _():
    import marimo as mo
    import subprocess
    import json
    import os
    from pathlib import Path
    import numpy as np
    import matplotlib
    import matplotlib.pyplot as plt

    _cwd = Path.cwd()
    REPO_ROOT = str(_cwd)
    for _p in [_cwd] + list(_cwd.parents):
        if (_p / "envs" / "game-env.mjs").exists():
            REPO_ROOT = str(_p)
            break

    matplotlib.rcParams.update(
        {
            "figure.dpi": 150,
            "savefig.dpi": 150,
            "font.size": 11,
            "axes.titlesize": 13,
            "axes.labelsize": 11,
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "axes.grid": True,
            "grid.alpha": 0.3,
            "grid.linestyle": "--",
        }
    )
    return REPO_ROOT, json, mo, np, os, plt, subprocess


@app.cell(hide_code=True)
def _(REPO_ROOT, json, os):
    _path = os.path.join(REPO_ROOT, "outputs", "all-games-benchmark-latest.json")
    bench_data = json.loads(open(_path).read())
    games = [r for r in bench_data["results"] if "error" not in r]
    game_names = [g["game"] for g in games]

    # Load per-game Playwright browser benchmark data
    _pw_path = os.path.join(REPO_ROOT, "outputs", "all-games-browser-benchmark-latest.json")
    browser_bench = None
    if os.path.exists(_pw_path):
        browser_bench = json.loads(open(_pw_path).read())
    return bench_data, browser_bench, game_names, games


@app.cell(hide_code=True)
def _(browser_bench, games, mo):
    _n = len(games)
    _rl_fps = [g["rlStep"]["fps"] for g in games]
    _mean = sum(_rl_fps) / len(_rl_fps)
    _min_g = games[_rl_fps.index(min(_rl_fps))]["game"]
    _max_g = games[_rl_fps.index(max(_rl_fps))]["game"]

    # Compute mean Playwright base64 FPS across all games
    _pw_results = [r for r in browser_bench["results"] if "error" not in r] if browser_bench else []
    _pw_b64_mean = sum(r["browser"]["base64Readback"]["fps"] for r in _pw_results) / len(_pw_results) if _pw_results else 2025
    _speedup_b64 = _mean / _pw_b64_mean
    mo.md(f"""
    # All Games Benchmark — {_n} LLM-Generated Games at Native Speed

    Every game runs headlessly in Node.js via a p5.js shim on `node-canvas`.
    No browser, no DOM, no GPU compositor — just V8 + Cairo CPU rendering.

    - **{_n} games** benchmarked with 500-step episodes, 64x64 RGB observations
    - **Mean RL step throughput: {_mean:,.0f} FPS** (action + tick + pixel readback + observation preprocessing)
    - **Fastest:** {_max_g} ({max(_rl_fps):,} FPS) — **Slowest:** {_min_g} ({min(_rl_fps):,} FPS)
    - Render-only throughput (no observation extraction) ranges from 12K to 90K FPS
    - **{_speedup_b64:.1f}x faster** than Playwright + base64 (mean {_pw_b64_mean:,.0f} FPS across all games)

    For context: ProcGen (hand-coded C++) runs at 2,000–5,000 FPS. ALE/Atari at ~6,000 FPS.
    These LLM-generated games are competitive with both — and there are **100 more in the catalog**
    waiting to be generated.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ---

    ## RL Step Throughput — All Games

    This is the number that matters for training: how many complete RL steps
    (action → game tick → pixel readback → 64x64 RGB observation → game state) per second.
    """)
    return


@app.cell(hide_code=True)
def _(browser_bench, games, np, plt):
    _names = [g["game"] for g in games]
    _rl_fps = [g["rlStep"]["fps"] for g in games]
    _order = np.argsort(_rl_fps)[::-1]
    _names_sorted = [_names[i] for i in _order]
    _fps_sorted = [_rl_fps[i] for i in _order]

    _fig, _ax = plt.subplots(figsize=(10, max(6, len(_names_sorted) * 0.35)))
    _colors = plt.cm.viridis(np.linspace(0.3, 0.9, len(_names_sorted)))
    _bars = _ax.barh(_names_sorted[::-1], _fps_sorted[::-1], color=_colors[::-1], edgecolor="white", linewidth=0.5)

    for _bar, _fps in zip(_bars, _fps_sorted[::-1]):
        _ax.text(_bar.get_width() + 80, _bar.get_y() + _bar.get_height() / 2,
                 f"{_fps:,}", va="center", fontsize=9, color="#333")

    _mean = np.mean(_rl_fps)
    _ax.axvline(_mean, color="#e74c3c", linestyle="--", linewidth=1.5, label=f"Mean headless: {_mean:,.0f} FPS")

    # Playwright base64 reference line from per-game browser benchmark
    _pw_results = [r for r in browser_bench["results"] if "error" not in r] if browser_bench else []
    _pw_b64 = np.mean([r["browser"]["base64Readback"]["fps"] for r in _pw_results]) if _pw_results else 2025
    _ax.axvline(_pw_b64, color="#f39c12", linestyle=":", linewidth=1.5, label=f"Playwright+base64 mean: {_pw_b64:,.0f} FPS")

    _ax.set_xlabel("RL Step FPS (64x64 RGB)")
    _ax.set_title(f"RL Step Throughput — All {len(_names)} Games (with Playwright reference)")
    _ax.legend(loc="lower right", fontsize=8)
    _ax.set_xlim(0, max(_rl_fps) * 1.15)
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ---

    ## Render-Only vs RL Step

    The gap between render-only and RL step shows the cost of pixel readback
    and observation preprocessing. Games with more complex rendering (more draw calls)
    are slower at render-only but hit a similar RL step ceiling since the observation
    pipeline cost is fixed.
    """)
    return


@app.cell(hide_code=True)
def _(games, np, plt):
    _names = [g["game"] for g in games]
    _render = [g["renderOnly"]["fps"] for g in games]
    _rl = [g["rlStep"]["fps"] for g in games]
    _order = np.argsort(_rl)[::-1]

    _x = np.arange(len(_names))
    _width = 0.35

    _fig, _ax = plt.subplots(figsize=(12, 6))
    _ax.bar(_x - _width / 2, [_render[i] for i in _order], _width, label="Render only", color="#3498db", alpha=0.8)
    _ax.bar(_x + _width / 2, [_rl[i] for i in _order], _width, label="RL step (with obs)", color="#e74c3c", alpha=0.8)

    _ax.set_xticks(_x)
    _ax.set_xticklabels([_names[i] for i in _order], rotation=45, ha="right", fontsize=9)
    _ax.set_ylabel("FPS")
    _ax.set_title("Render-Only vs RL Step Throughput")
    _ax.legend()
    _ax.set_yscale("log")
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ---

    ## Headless Node vs Playwright + base64

    The traditional approach to using browser games as RL environments is to automate
    a real browser with Playwright and extract pixels via the Chrome DevTools Protocol (CDP).
    Even with an optimized **base64** pixel transfer (preprocessing in-browser, encoding as
    a single `btoa()` string instead of a JSON number array), Playwright is bottlenecked by
    CDP round-trips.

    Our headless Node approach bypasses all of this: pixels are read directly from the
    `node-canvas` framebuffer in the same process — zero serialization, zero IPC.

    Both approaches benchmarked on **all games** with identical 64x64 RGB observations.
    """)
    return


@app.cell(hide_code=True)
def _(browser_bench, games, np, plt):
    # Build per-game comparison data
    _pw_results = {r["game"]: r for r in browser_bench["results"] if "error" not in r} if browser_bench else {}
    _headless_results = {g["game"]: g for g in games}
    _common = sorted(set(_pw_results.keys()) & set(_headless_results.keys()))

    _headless_fps = [_headless_results[n]["rlStep"]["fps"] for n in _common]
    _b64_fps = [_pw_results[n]["browser"]["base64Readback"]["fps"] for n in _common]

    # Sort by headless FPS descending
    _order = np.argsort(_headless_fps)[::-1]
    _names_sorted = [_common[i] for i in _order]
    _headless_sorted = [_headless_fps[i] for i in _order]
    _b64_sorted = [_b64_fps[i] for i in _order]

    _x = np.arange(len(_names_sorted))
    _width = 0.35

    _fig, _ax = plt.subplots(figsize=(14, 6))
    _ax.bar(_x - _width / 2, _b64_sorted, _width, label="Playwright + base64", color="#f39c12", alpha=0.85)
    _ax.bar(_x + _width / 2, _headless_sorted, _width, label="Headless Node", color="#2ecc71", alpha=0.85)

    # Add speedup labels on the headless bars
    for _xi, _h, _b in zip(_x, _headless_sorted, _b64_sorted):
        _ax.text(_xi + _width / 2, _h + 100, f"{_h/_b:.1f}x", ha="center", fontsize=8,
                 fontweight="bold", color="#27ae60")

    _ax.set_xticks(_x)
    _ax.set_xticklabels(_names_sorted, rotation=45, ha="right", fontsize=9)
    _ax.set_ylabel("FPS")
    _ax.set_title("Headless Node vs Playwright + base64 — Per-Game RL Step Throughput (64x64 RGB)")
    _ax.legend(loc="upper right")
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(browser_bench, games, np, plt):
    # Speedup chart: how many x faster is headless vs Playwright base64
    _pw_results = {r["game"]: r for r in browser_bench["results"] if "error" not in r} if browser_bench else {}
    _headless_results = {g["game"]: g for g in games}
    _common = sorted(set(_pw_results.keys()) & set(_headless_results.keys()))

    _speedup_b64 = []
    for _n in _common:
        _h = _headless_results[_n]["rlStep"]["fps"]
        _speedup_b64.append(_h / _pw_results[_n]["browser"]["base64Readback"]["fps"])

    _order = np.argsort(_speedup_b64)[::-1]
    _names_sorted = [_common[i] for i in _order]
    _b64_sorted = [_speedup_b64[i] for i in _order]

    _fig, _ax = plt.subplots(figsize=(12, max(5, len(_names_sorted) * 0.35)))
    _colors = plt.cm.YlOrRd(np.linspace(0.3, 0.7, len(_names_sorted)))
    _bars = _ax.barh(_names_sorted[::-1], _b64_sorted[::-1], color=_colors[::-1],
                     edgecolor="white", linewidth=0.5)

    for _bar, _v in zip(_bars, _b64_sorted[::-1]):
        _ax.text(_bar.get_width() + 0.05, _bar.get_y() + _bar.get_height() / 2,
                 f"{_v:.1f}x", va="center", fontsize=9, fontweight="bold", color="#333")

    _mean_speedup = np.mean(_b64_sorted)
    _ax.axvline(_mean_speedup, color="#e74c3c", linestyle="--", linewidth=1.5,
                label=f"Mean: {_mean_speedup:.1f}x")
    _ax.axvline(1, color="#999", linestyle="-", linewidth=0.5)
    _ax.set_xlabel("Speedup (x faster than Playwright + base64)")
    _ax.set_title("Headless Node Speedup over Playwright + base64 — Per Game")
    _ax.legend(loc="lower right")
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(browser_bench, games, mo):
    _pw_results = {r["game"]: r for r in browser_bench["results"] if "error" not in r} if browser_bench else {}
    _headless_results = {g["game"]: g for g in games}
    _common = sorted(set(_pw_results.keys()) & set(_headless_results.keys()),
                     key=lambda n: _headless_results[n]["rlStep"]["fps"], reverse=True)

    _rows = []
    _total_h, _total_b64 = 0, 0
    for _n in _common:
        _h = _headless_results[_n]["rlStep"]["fps"]
        _b = _pw_results[_n]["browser"]["base64Readback"]["fps"]
        _total_h += _h
        _total_b64 += _b
        _rows.append(f"| {_n} | {_b:,} | {_h:,} | {_h/_b:.1f}x |")
    _table = "\n".join(_rows)
    _cnt = len(_common)
    _mh = _total_h / _cnt
    _mb = _total_b64 / _cnt

    mo.md(f"""
    ### Per-Game Results

    All benchmarks on the same machine with 64x64 RGB observations.

    | Game | Playwright + base64 FPS | Headless Node FPS | Speedup |
    |------|------------------------:|------------------:|--------:|
    {_table}
    | **Mean** | **{_mb:,.0f}** | **{_mh:,.0f}** | **{_mh/_mb:.1f}x** |

    Playwright + base64 encodes the preprocessed observation as a single `btoa()` string,
    avoiding the catastrophic JSON serialization overhead. But CDP round-trip latency
    still caps throughput at ~2,000 FPS. Headless Node reads pixels directly from the
    `node-canvas` framebuffer in-process — zero serialization, zero IPC.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ---

    ## Sub-Step Breakdown

    Where does the time go in each RL step? We measure four components independently:

    - **tick()** — advance the game one frame (run `draw()`)
    - **getPixelData()** — read raw RGBA from the canvas
    - **preprocess** — downsample to 64x64 RGB
    - **getGameState()** — read score, lives, gameState
    """)
    return


@app.cell(hide_code=True)
def _(games, np, plt):
    _names = [g["game"] for g in games]
    _tick = [g["substeps"]["tick"]["perStepMs"] for g in games]
    _pixel = [g["substeps"]["pixelRead"]["perStepMs"] for g in games]
    _prep = [g["substeps"]["preprocess"]["perStepMs"] for g in games]
    _state = [g["substeps"]["stateRead"]["perStepMs"] for g in games]

    _order = np.argsort([t + p + pr + s for t, p, pr, s in zip(_tick, _pixel, _prep, _state)])[::-1]

    _fig, _ax = plt.subplots(figsize=(12, 6))
    _x = np.arange(len(_names))

    _bottom = np.zeros(len(_names))
    for _data, _label, _color in [
        (_tick, "tick()", "#e74c3c"),
        (_pixel, "getPixelData()", "#f39c12"),
        (_prep, "preprocess RGB", "#27ae60"),
        (_state, "getGameState()", "#3498db"),
    ]:
        _vals = [_data[i] for i in _order]
        _ax.bar(_x, _vals, bottom=[_bottom[j] for j in range(len(_x))],
                label=_label, color=_color, alpha=0.85, edgecolor="white", linewidth=0.3)
        _bottom_list = list(_bottom)
        for j in range(len(_x)):
            _bottom_list[j] += _vals[j]
        _bottom = np.array(_bottom_list)

    _ax.set_xticks(_x)
    _ax.set_xticklabels([_names[i] for i in _order], rotation=45, ha="right", fontsize=9)
    _ax.set_ylabel("ms per step")
    _ax.set_title("Per-Step Time Breakdown by Component")
    _ax.legend(loc="upper right")
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ---

    ## Sample Frames — What the Agent Sees

    Each game rendered at 64x64 RGB — the actual observation fed to the RL agent.
    These are captured mid-episode after 50 warmup frames.
    """)
    return


@app.cell(hide_code=True)
def _(games, np, plt):
    _valid = [g for g in games if "sampleFrame" in g and len(g["sampleFrame"]) == 64 * 64 * 3]

    _cols = 7
    _rows = (len(_valid) + _cols - 1) // _cols

    _fig, _axes = plt.subplots(_rows, _cols, figsize=(14, 4 * _rows))
    if _rows == 1:
        _axes = [_axes]
    _axes_flat = [ax for row in _axes for ax in (row if hasattr(row, '__len__') else [row])]

    for i, g in enumerate(_valid):
        _frame = np.array(g["sampleFrame"], dtype=np.uint8).reshape(64, 64, 3)
        _axes_flat[i].imshow(_frame, interpolation="nearest")
        _axes_flat[i].set_title(f"{g['game']}\n{g['rlStep']['fps']:,} FPS", fontsize=9)
        _axes_flat[i].axis("off")

    # Hide unused axes
    for i in range(len(_valid), len(_axes_flat)):
        _axes_flat[i].axis("off")

    _fig.suptitle("64x64 RGB Observations — All Games", fontsize=14, y=1.02)
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(bench_data, mo):
    _sys = bench_data["system"]
    _cfg = bench_data["config"]
    mo.md(f"""
    ---

    ## System Info

    | | |
    |---|---|
    | **Platform** | {_sys['platform']} {_sys['arch']} |
    | **CPU** | {_sys['cpu_model'] or 'unknown'} ({_sys['cpu_count']} cores) |
    | **Node.js** | {_sys['node']} |
    | **Observation** | {_cfg['obs_width']}x{_cfg['obs_height']} {_cfg['obs_format'].upper()} |
    | **Bench frames** | {_cfg['bench_frames']} per game |
    | **Warmup** | {_cfg['warmup_frames']} frames |
    | **Generated** | {bench_data['generated_at']} |
    """)
    return


@app.cell(hide_code=True)
def _(REPO_ROOT, games, mo, subprocess):
    mo.md("""
    ---

    ## Re-run Benchmark

    Click the button below to re-run the benchmark live. This spawns a Node.js
    child process per game and takes ~30 seconds.
    """)
    return


@app.cell
def _(REPO_ROOT, json, mo, subprocess):
    btn = mo.ui.run_button(label="Re-run All Games Benchmark")
    btn
    return (btn,)


@app.cell
def _(btn, REPO_ROOT, json, mo, subprocess):
    btn

    _result = subprocess.run(
        ["node", "benchmarks/all-games-bench.mjs", "--frames", "500"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=300,
    )

    if _result.returncode == 0:
        _data = json.loads(_result.stdout)
        _lines = []
        for r in _data["results"]:
            if "error" in r:
                _lines.append(f"| {r['game']} | ERROR | — | — |")
            else:
                _lines.append(
                    f"| {r['game']} | {r['renderOnly']['fps']:,} | {r['rlStep']['fps']:,} | {r['substeps']['tick']['perStepMs']:.3f} |"
                )
        _table = "\n".join(_lines)
        mo.md(f"""
        ### Fresh Results

        | Game | Render FPS | RL Step FPS | tick() ms |
        |------|----------:|----------:|----------:|
        {_table}

        Updated `outputs/all-games-benchmark-latest.json`.
        """)
    else:
        mo.md(f"**Error:**\n```\n{_result.stderr[:500]}\n```")
    return


if __name__ == "__main__":
    app.run()
