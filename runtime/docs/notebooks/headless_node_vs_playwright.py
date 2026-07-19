import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _():
    import marimo as mo
    import subprocess
    import json
    import struct
    import time
    import sys
    import os
    from pathlib import Path
    import numpy as np
    import matplotlib
    import matplotlib.pyplot as plt

    # Find repo root by walking up from cwd until we find the project markers
    _cwd = Path.cwd()
    REPO_ROOT = str(_cwd)
    for _p in [_cwd] + list(_cwd.parents):
        if (_p / "envs" / "kazuki-env.mjs").exists():
            REPO_ROOT = str(_p)
            break

    # Configure matplotlib for crisp rendering
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
    return REPO_ROOT, json, mo, np, os, plt, struct, subprocess, sys, time


@app.cell(hide_code=True)
def _(REPO_ROOT, json, os):
    # Load cached benchmark data for use in diagrams throughout the notebook.
    # Section 8 re-runs the benchmark live; this reads the latest cached results.
    _path = os.path.join(REPO_ROOT, "outputs", "kazuki-benchmark-latest.json")
    bench_data = json.loads(open(_path).read())
    return (bench_data,)


@app.cell(hide_code=True)
def _(mo, bench_data):
    _h_fps = bench_data["headless"]["rlStep"]["fps"]
    _b_json_fps = bench_data["browser"]["canvasReadback"]["fps"]
    _b_b64_fps = bench_data["browser"]["base64Readback"]["fps"]
    _json_transfer = bench_data["browser"]["substeps"]["jsonTransfer"]["perStepMs"]
    _b64_transfer = bench_data["browser"]["substeps"]["base64Transfer"]["perStepMs"]
    mo.md(f"""
    # Optimizing RL Game Environments: From {_b_json_fps:.0f} to {_h_fps:,.0f} FPS

    Running a browser game as an RL environment with Playwright starts at
    **~{_b_json_fps:.0f} FPS** — too slow for serious training. A single encoding change
    (base64 instead of JSON for pixel transfer) jumps to **~{_b_b64_fps:,.0f} FPS**. Going
    fully headless with a Node.js Canvas 2D shim reaches **~{_h_fps:,.0f} FPS**.

    The bottleneck is never the game itself — rendering costs ~0.4 ms either way.
    The gap is entirely in **how pixels get from the game to the RL agent**:

    | Approach | Transfer cost | Total FPS |
    |---|---:|---:|
    | Playwright + JSON array | {_json_transfer:.1f} ms | {_b_json_fps:.0f} |
    | Playwright + base64 | {_b64_transfer:.2f} ms | {_b_b64_fps:,.0f} |
    | Headless Node + raw bytes | ~0 ms | {_h_fps:,.0f} |

    This notebook explains each layer from first principles:

    1. What a browser actually does when it runs a p5.js game
    2. What Playwright does to automate that browser
    3. What our shim replaces — and what it doesn't need
    4. The pixel observation pipeline
    5. The inter-process communication protocol between Python and Node
    6. Frame-locked stepping vs `requestAnimationFrame`
    7. Can we fix Playwright? The base64 optimization
    8. Full data-flow comparison
    9. Benchmarks
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ---

    ## 1. What Does a Browser Actually Do?

    When a p5.js game runs in Chrome, it passes through many layers that exist for
    general-purpose web browsing but are completely unnecessary for RL:
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    _css = """
    <style>
    .arch-diagram { font-family: ui-monospace, monospace; font-size: 13px; line-height: 1.5; }
    .arch-diagram .box {
        border: 2px solid #555; border-radius: 8px; padding: 10px 16px;
        margin: 6px 0; background: #f8f9fa;
    }
    .arch-diagram .box-red {
        border-color: #e74c3c; background: #fdf0ef;
    }
    .arch-diagram .box-green {
        border-color: #27ae60; background: #eafaf1;
    }
    .arch-diagram .label { font-weight: 700; margin-bottom: 4px; }
    .arch-diagram .sub { color: #666; font-size: 12px; }
    .arch-diagram .arrow { text-align: center; color: #888; font-size: 18px; line-height: 1; }
    .arch-diagram .needed { display: inline-block; background: #27ae60; color: white; padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .arch-diagram .waste { display: inline-block; background: #e74c3c; color: white; padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    </style>
    """
    mo.Html(
        _css
        + """
    <div class="arch-diagram" style="max-width: 520px;">
      <div style="text-align:center; font-weight:700; margin-bottom:8px; font-size:14px;">Chrome Process Architecture</div>
      <div class="box box-green">
        <div class="label">V8 JavaScript Engine <span class="needed">NEEDED</span></div>
        <div class="sub">Executes game code: draw(), keyPressed(), physics</div>
      </div>
      <div class="arrow">&darr;</div>
      <div class="box box-red">
        <div class="label">Blink / DOM / Layout <span class="waste">WASTE</span></div>
        <div class="sub">HTML parsing, CSS cascade, layout tree, style resolution</div>
      </div>
      <div class="arrow">&darr;</div>
      <div class="box box-green">
        <div class="label">Canvas 2D Context <span class="needed">NEEDED</span></div>
        <div class="sub">rect(), ellipse(), fill() &mdash; the actual drawing surface</div>
      </div>
      <div class="arrow">&darr;</div>
      <div class="box box-red">
        <div class="label">Skia / GPU Compositor <span class="waste">WASTE</span></div>
        <div class="sub">Rasterize layers, composite, GPU dispatch overhead</div>
      </div>
      <div class="arrow">&darr;</div>
      <div class="box box-red">
        <div class="label">GPU Process (separate OS process) <span class="waste">WASTE</span></div>
        <div class="sub">Display buffer, vsync, process isolation, security sandbox</div>
      </div>
    </div>
    """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    **What the game actually needs:** V8 (to run JavaScript) + Canvas 2D (to draw pixels).

    **What it gets for free but doesn't need:**
    - Process isolation (browser/renderer/GPU are separate OS processes)
    - DOM/HTML parsing and layout engine
    - CSS cascade and style resolution
    - Layer compositing
    - GPU process and display buffer management
    - `requestAnimationFrame` scheduling tied to vsync
    - Security sandboxing

    A p5.js game calls `rect()`, `ellipse()`, `fill()` on a Canvas 2D context.
    It doesn't touch the DOM layout engine. It doesn't need GPU compositing.
    It certainly doesn't need process isolation. **All it needs is a JavaScript
    engine and a 2D drawing surface.**
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ---

    ## 2. What Does Playwright Do?

    Playwright automates Chrome via the **Chrome DevTools Protocol (CDP)** — a
    WebSocket-based protocol between a Node.js controller process and the browser.

    Every single RL step requires this round-trip:
    """)
    return


@app.cell(hide_code=True)
def _(mo, bench_data):
    _b = bench_data["browser"]
    _cdp = _b["substeps"]["cdpRoundtrip"]["perStepMs"]
    _gpu = _b["substeps"]["gpuReadback"]["perStepMs"]
    _json_ms = _b["substeps"]["jsonTransfer"]["perStepMs"]
    _total = _b["canvasReadback"]["elapsedMs"] / _b["canvasReadback"]["steps"]
    _fps = _b["canvasReadback"]["fps"]
    _css = """
    <style>
    .flow-diagram { font-family: ui-monospace, monospace; font-size: 12px; max-width: 680px; }
    .flow-row { display: flex; align-items: stretch; min-height: 36px; }
    .flow-col { flex: 1; padding: 4px 8px; border-left: 3px solid transparent; }
    .flow-col-py { border-left-color: #3498db; background: #ebf5fb; }
    .flow-col-pw { border-left-color: #f39c12; background: #fef9e7; }
    .flow-col-cr { border-left-color: #e74c3c; background: #fdf0ef; }
    .flow-header { font-weight: 700; font-size: 13px; padding: 6px 8px; border-bottom: 2px solid #ddd; }
    .flow-arrow { text-align: center; font-size: 20px; color: #888; padding: 2px 0; }
    .flow-cost { float: right; color: #c0392b; font-weight: 600; font-size: 11px; }
    .flow-sep { border-top: 2px dashed #e74c3c; margin: 2px 0; position: relative; }
    .flow-sep::after { content: "process boundary"; position: absolute; right: 4px; top: -9px;
        font-size: 10px; color: #e74c3c; background: white; padding: 0 4px; }
    </style>
    """
    mo.Html(
        _css
        + f"""
    <div class="flow-diagram">
      <div class="flow-row">
        <div class="flow-header flow-col" style="border-left: 3px solid #3498db;">Python RL Agent</div>
        <div class="flow-header flow-col" style="border-left: 3px solid #f39c12;">Playwright (Node.js)</div>
        <div class="flow-header flow-col" style="border-left: 3px solid #e74c3c;">Chromium</div>
      </div>
      <div class="flow-row">
        <div class="flow-col flow-col-py">env.step(action) &rarr;</div>
        <div class="flow-col flow-col-pw">&nbsp;</div>
        <div class="flow-col flow-col-cr">&nbsp;</div>
      </div>
      <div class="flow-row">
        <div class="flow-col flow-col-py">&nbsp;</div>
        <div class="flow-col flow-col-pw">page.evaluate(js) &rarr;</div>
        <div class="flow-col flow-col-cr">&nbsp;</div>
      </div>
      <div class="flow-row">
        <div class="flow-col">&nbsp;</div>
        <div class="flow-col" style="padding:0;"><div class="flow-sep"></div></div>
        <div class="flow-col">&nbsp;</div>
      </div>
      <div class="flow-row">
        <div class="flow-col flow-col-py">&nbsp;</div>
        <div class="flow-col flow-col-pw">&nbsp;</div>
        <div class="flow-col flow-col-cr">draw() + getState() <span class="flow-cost">{_cdp:.2f} ms</span></div>
      </div>
      <div class="flow-row">
        <div class="flow-col flow-col-py">&nbsp;</div>
        <div class="flow-col flow-col-pw">&nbsp;</div>
        <div class="flow-col flow-col-cr">getImageData() GPU&rarr;CPU <span class="flow-cost">{_gpu:.2f} ms</span></div>
      </div>
      <div class="flow-row">
        <div class="flow-col flow-col-py">&nbsp;</div>
        <div class="flow-col flow-col-pw">&nbsp;</div>
        <div class="flow-col flow-col-cr">Array.from() + JSON.stringify <span class="flow-cost">{_json_ms:.2f} ms</span></div>
      </div>
      <div class="flow-row">
        <div class="flow-col">&nbsp;</div>
        <div class="flow-col" style="padding:0;"><div class="flow-sep"></div></div>
        <div class="flow-col">&nbsp;</div>
      </div>
      <div class="flow-row">
        <div class="flow-col flow-col-py">&nbsp;</div>
        <div class="flow-col flow-col-pw">&larr; parse JSON response</div>
        <div class="flow-col flow-col-cr">&nbsp;</div>
      </div>
      <div class="flow-row">
        <div class="flow-col flow-col-py">&larr; obs, reward, done</div>
        <div class="flow-col flow-col-pw">&nbsp;</div>
        <div class="flow-col flow-col-cr">&nbsp;</div>
      </div>
      <div style="font-weight:700; color:#c0392b; margin-top:8px; font-size:14px;">
        Measured total: {_total:.2f} ms/step ({_fps:.0f} FPS) &mdash; render is only {_cdp:.2f} ms of that
      </div>
      <div style="color:#888; font-size:11px; margin-top:2px;">
        Each sub-step measured independently via isolated benchmark phases
      </div>
    </div>
    """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ---

    ## 3. The Shim — What We Replace and What We Keep

    Our approach: run the game's JavaScript directly in a Node.js process, with a thin
    shim that provides just the p5.js drawing API on top of **node-canvas** (a native
    binding to the Cairo 2D graphics library).
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.Html(
        """
    <style>
    .shim-diagram { font-family: ui-monospace, monospace; font-size: 13px; max-width: 440px; }
    .shim-box {
        border: 2px solid #27ae60; border-radius: 8px; padding: 10px 16px;
        margin: 6px 0; background: #eafaf1;
    }
    .shim-label { font-weight: 700; margin-bottom: 4px; }
    .shim-sub { color: #555; font-size: 12px; }
    .shim-arrow { text-align: center; color: #27ae60; font-size: 18px; line-height: 1; }
    .shim-highlight { background: #27ae60; color: white; padding: 2px 10px; border-radius: 4px;
        font-size: 11px; font-weight: 600; display: inline-block; margin-top: 4px; }
    </style>
    <div class="shim-diagram">
      <div style="text-align:center; font-weight:700; margin-bottom:8px; font-size:14px; color: #27ae60;">
        Headless Node.js &mdash; Single Process
      </div>
      <div class="shim-box">
        <div class="shim-label">V8 JavaScript Engine</div>
        <div class="shim-sub">Same engine as Chrome &mdash; runs game code unchanged</div>
      </div>
      <div class="shim-arrow">&darr;</div>
      <div class="shim-box">
        <div class="shim-label">p5-shim.mjs (our code)</div>
        <div class="shim-sub">Provides p5.js API: rect(), fill(), ellipse(), tick()...</div>
        <div class="shim-sub">Maps directly to Canvas 2D context calls</div>
      </div>
      <div class="shim-arrow">&darr;</div>
      <div class="shim-box">
        <div class="shim-label">node-canvas (Cairo C++ binding)</div>
        <div class="shim-sub">CPU-rendered 2D graphics &mdash; no GPU needed</div>
        <div class="shim-highlight">Pixels live in main memory &mdash; zero-cost readback</div>
      </div>
    </div>
    """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    **What the shim provides** (see `poc/p5/p5-shim.mjs`):
    - `createCanvas(w, h)` &rarr; creates a node-canvas instance
    - Drawing primitives: `rect()`, `ellipse()`, `fill()`, `line()`, `stroke()`, etc.
    - Input injection: `setKeysDown()`, `simulateKeyPress()`
    - Frame advancing: `tick()` &rarr; calls `draw()` once
    - Pixel access: `getPixelData()` &rarr; returns raw RGBA from the canvas context

    **What the shim does NOT need:**
    - DOM, HTML parsing, or layout engine
    - GPU process or compositing
    - requestAnimationFrame / vsync scheduling
    - Process isolation or sandboxing
    - CDP WebSocket protocol
    - Any serialization at all for pixel access

    **The critical difference:** Cairo renders to a CPU buffer in the same process.
    `getPixelData()` is just `ctx.getImageData()` which reads directly from that
    buffer &mdash; no GPU readback, no process boundary, no serialization.

    Let's see it in action. Here's the demo script (`notebooks/demos/shim_demo.mjs`):
    """)
    return


@app.cell(hide_code=True)
def _(REPO_ROOT, mo, os):
    _path = os.path.join(REPO_ROOT, "notebooks", "demos", "shim_demo.mjs")
    with open(_path) as _f:
        _code = _f.read()
    mo.md(f"```javascript\n{_code}\n```")
    return


@app.cell(hide_code=True)
def _(REPO_ROOT, subprocess):
    _result = subprocess.run(
        ["node", "notebooks/demos/shim_demo.mjs"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    print(_result.stdout)
    if _result.stderr:
        print("STDERR:", _result.stderr[:500])
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ---

    ## 4. The Observation Pipeline (First Principles)

    RL agents don't consume raw canvas pixels. Following the Atari/DQN convention, we
    downsample the game frame to an **84x84 grayscale** observation. Here's the math.

    **Step 1 &mdash; Raw Canvas to RGBA Buffer:**
    The game renders to a 640x448 canvas. Each pixel is 4 bytes (R, G, B, A).
    Total: `640 x 448 x 4 = 1,146,880 bytes (~1.1 MB)`

    **Step 2 &mdash; Downsample to 84x84:**
    Nearest-neighbor sampling with center-pixel alignment:

    ```
    srcX = floor(((ox + 0.5) * 640) / 84)
    srcY = floor(((oy + 0.5) * 448) / 84)
    ```

    **Step 3 &mdash; RGB to Grayscale (ITU-R BT.601 Luminance):**

    ```
    gray = 0.299 * R + 0.587 * G + 0.114 * B
    ```

    Green contributes most because human eyes are most sensitive to green light.

    **Result:** `84 x 84 x 1 = 7,056 bytes (~7 KB)` &mdash; a **162x compression** from raw RGBA.

    This is implemented in `poc/p5/obs.mjs`:
    """)
    return


@app.cell(hide_code=True)
def _(REPO_ROOT, mo, os):
    _path = os.path.join(REPO_ROOT, "poc", "p5", "obs.mjs")
    with open(_path) as _f:
        _code = _f.read()
    mo.md(f"```javascript\n{_code}\n```")
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    Let's run the full pipeline on a real game frame. The demo script
    (`notebooks/demos/observation_demo.mjs`) loads the actual game,
    plays 30 frames, and extracts the observation:
    """)
    return


@app.cell(hide_code=True)
def _(REPO_ROOT, mo, os):
    _path = os.path.join(REPO_ROOT, "notebooks", "demos", "observation_demo.mjs")
    with open(_path) as _f:
        _code = _f.read()
    mo.md(f"```javascript\n{_code}\n```")
    return


@app.cell(hide_code=True)
def _(REPO_ROOT, json, subprocess):
    _result = subprocess.run(
        ["node", "notebooks/demos/observation_demo.mjs"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    obs_data = json.loads(_result.stdout)
    print(f"Canvas:           {obs_data['canvas_width']}x{obs_data['canvas_height']}")
    print(f"Raw RGBA buffer:  {obs_data['rgba_bytes']:,} bytes ({obs_data['rgba_bytes']/1024:.1f} KB)")
    print(f"Observation:      {obs_data['obs_size']:,} bytes ({obs_data['obs_size']/1024:.1f} KB)")
    print(f"Compression:      {obs_data['rgba_bytes']/obs_data['obs_size']:.0f}x")
    print(f"Game state:       {obs_data['state']}")
    return (obs_data,)


@app.cell(hide_code=True)
def _(np, obs_data, plt):
    _obs = np.array(obs_data["obs_all"], dtype=np.uint8).reshape(84, 84)
    _fig, _axes = plt.subplots(1, 2, figsize=(9, 4), gridspec_kw={"width_ratios": [1, 1]})

    # Left: the observation as the agent sees it
    _im = _axes[0].imshow(_obs, cmap="gray", vmin=0, vmax=255, interpolation="nearest")
    _axes[0].set_title("84x84 Grayscale Observation\n(what the RL agent sees)", fontsize=11)
    _axes[0].set_xlabel("pixel x")
    _axes[0].set_ylabel("pixel y")
    _axes[0].grid(False)

    # Right: pixel intensity histogram
    _axes[1].hist(_obs.flatten(), bins=50, color="#3498db", edgecolor="white", linewidth=0.5)
    _axes[1].set_title("Pixel Intensity Distribution", fontsize=11)
    _axes[1].set_xlabel("Pixel value (0-255)")
    _axes[1].set_ylabel("Count")
    _axes[1].axvline(_obs.mean(), color="#e74c3c", linestyle="--", linewidth=1.5, label=f"Mean: {_obs.mean():.0f}")
    _axes[1].legend(fontsize=9)

    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ---

    ## 5. The Inter-Process Protocol — Binary Framing vs JSON

    The Python Gymnasium wrapper communicates with the Node.js worker via **stdin/stdout
    pipes** using a custom binary frame protocol:
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.Html(
        """
    <style>
    .proto-diagram { font-family: ui-monospace, monospace; font-size: 13px; max-width: 600px; }
    .proto-row { display: flex; border: 2px solid #555; border-radius: 6px; overflow: hidden; margin: 8px 0; }
    .proto-cell { padding: 8px 12px; border-right: 1px solid #ccc; text-align: center; }
    .proto-cell:last-child { border-right: none; }
    .proto-cell .proto-label { font-weight: 700; font-size: 12px; }
    .proto-cell .proto-detail { font-size: 11px; color: #666; }
    .proto-header { background: #34495e; color: white; }
    .proto-meta { background: #f39c12; color: white; }
    .proto-binary { background: #27ae60; color: white; }
    </style>
    <div class="proto-diagram">
      <div style="font-weight:700; margin-bottom:4px;">Binary frame format (one RL step response):</div>
      <div class="proto-row">
        <div class="proto-cell proto-header" style="flex:1;">
          <div class="proto-label">4 bytes</div>
          <div class="proto-detail">meta_length<br>(big-endian uint32)</div>
        </div>
        <div class="proto-cell proto-header" style="flex:1;">
          <div class="proto-label">4 bytes</div>
          <div class="proto-detail">binary_length<br>(big-endian uint32)</div>
        </div>
        <div class="proto-cell proto-meta" style="flex:1.5;">
          <div class="proto-label">N bytes</div>
          <div class="proto-detail">JSON metadata<br>{"reward":1.0,...}</div>
        </div>
        <div class="proto-cell proto-binary" style="flex:2;">
          <div class="proto-label">7,056 bytes</div>
          <div class="proto-detail">Raw observation<br>84x84 grayscale pixels</div>
        </div>
      </div>
      <div style="display:flex; font-size:11px; color:#666; margin-top:4px;">
        <div style="flex:2; text-align:center;">&larr; 8-byte header &rarr;</div>
        <div style="flex:1.5; text-align:center;">&larr; ~50 bytes &rarr;</div>
        <div style="flex:2; text-align:center;">&larr; 7,056 bytes &rarr;</div>
      </div>
    </div>
    """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    **Why not just JSON for everything?**

    The observation is 7,056 bytes of raw pixel data. Sending it as JSON means:
    - `Array.from(uint8Array)` converts to a JS number array
    - `JSON.stringify([0, 128, 255, ...])` text-encodes 7,056 numbers
    - Each number becomes 1-3 ASCII characters plus a comma

    Let's measure the difference:
    """)
    return


@app.cell(hide_code=True)
def _(json, plt, struct, time):
    # Simulate a typical 84x84 observation
    _fake_obs = bytes(range(256)) * 27 + bytes(range(144))  # 7056 bytes
    assert len(_fake_obs) == 84 * 84

    # Method 1: JSON serialization (what Playwright does)
    _json_start = time.perf_counter()
    for _ in range(10000):
        _json_payload = json.dumps(list(_fake_obs))
    _json_elapsed = (time.perf_counter() - _json_start) * 1000

    # Method 2: Binary protocol (what our worker does)
    _bin_start = time.perf_counter()
    _header_struct = struct.Struct(">II")
    for _ in range(10000):
        _meta = json.dumps({"reward": 1.0, "terminated": False}).encode()
        _frame = _header_struct.pack(len(_meta), len(_fake_obs)) + _meta + _fake_obs
    _bin_elapsed = (time.perf_counter() - _bin_start) * 1000

    _json_size = len(json.dumps(list(_fake_obs)).encode())
    _meta_bytes = json.dumps({"reward": 1.0, "terminated": False}).encode()
    _bin_size = 8 + len(_meta_bytes) + len(_fake_obs)

    # Visualization
    _fig, (_ax1, _ax2) = plt.subplots(1, 2, figsize=(10, 3.5))

    # Payload size comparison
    _ax1.barh(
        ["Binary\n(our protocol)", "JSON\n(Playwright-style)"],
        [_bin_size / 1024, _json_size / 1024],
        color=["#27ae60", "#e74c3c"],
        height=0.5,
        edgecolor="white",
    )
    _ax1.set_xlabel("Payload size (KB)")
    _ax1.set_title("Payload Size per RL Step")
    _ax1.bar_label(
        _ax1.containers[0], fmt="%.1f KB", padding=4, fontweight="bold", fontsize=10
    )
    _ax1.set_xlim(0, _json_size / 1024 * 1.35)

    # Serialization speed
    _ax2.barh(
        ["Binary\n(our protocol)", "JSON\n(Playwright-style)"],
        [_bin_elapsed / 10000 * 1000, _json_elapsed / 10000 * 1000],
        color=["#27ae60", "#e74c3c"],
        height=0.5,
        edgecolor="white",
    )
    _ax2.set_xlabel("Time per serialization (microseconds)")
    _ax2.set_title("Serialization Speed (10k iterations)")
    _ax2.bar_label(
        _ax2.containers[0], fmt="%.0f us", padding=4, fontweight="bold", fontsize=10
    )

    _fig.suptitle(
        f"JSON is {_json_size/_bin_size:.0f}x larger and {_json_elapsed/_bin_elapsed:.0f}x slower",
        fontsize=12,
        fontweight="bold",
        y=1.02,
    )
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    The binary protocol sends the observation as **raw bytes** &mdash; the exact same
    `Uint8Array` that came out of the observation preprocessor. No conversion, no
    encoding, no parsing on the other end.

    On the Python side, decoding is a single zero-copy operation:
    ```python
    obs = np.frombuffer(raw_bytes, dtype=np.uint8).reshape(84, 84)
    ```

    Compare to what Playwright would need:
    ```python
    obs = np.array(json.loads(response)["observation"], dtype=np.uint8).reshape(84, 84)
    ```

    The JSON path parses ~30 KB of text, allocates a Python list of 7,056 integers,
    then copies them into a numpy array. The binary path just reinterprets 7 KB of
    bytes as a numpy array.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ---

    ## 6. Frame-Locked Stepping vs `requestAnimationFrame`

    In a browser, games use `requestAnimationFrame` (rAF) to schedule rendering,
    tied to the display's refresh rate (usually 60 Hz). **Maximum theoretical FPS: 60.**

    Even in headless Chrome, the event loop scheduling adds overhead. Each frame
    requires yielding to the browser event loop, checking the rAF callback, dispatching it.

    Our shim replaces this with **synchronous stepping**. Here's the actual code
    from `poc/p5/p5-shim.mjs`:

    ```javascript
    function tick() {
        if (!_looping) return false;
        _frameCount++;
        if (typeof globalThis.draw === 'function') globalThis.draw();
        return _looping;
    }
    ```

    A plain function call. No event loop. No scheduling. No vsync.
    The RL agent calls `tick()`, the game advances exactly one frame, and control
    returns immediately. This is essential for RL because:

    1. **Deterministic timing** &mdash; each step is exactly one frame, always
    2. **No idle time** &mdash; we don't wait 16.7ms between frames
    3. **Synchronous control** &mdash; the agent picks the next action before the next frame

    Let's see how fast we can tick the game (`notebooks/demos/tick_benchmark.mjs`):
    """)
    return


@app.cell(hide_code=True)
def _(REPO_ROOT, mo, os):
    _path = os.path.join(REPO_ROOT, "notebooks", "demos", "tick_benchmark.mjs")
    with open(_path) as _f:
        _code = _f.read()
    mo.md(f"```javascript\n{_code}\n```")
    return


@app.cell(hide_code=True)
def _(REPO_ROOT, subprocess):
    _result = subprocess.run(
        ["node", "notebooks/demos/tick_benchmark.mjs"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    print(_result.stdout)
    if _result.stderr:
        print("STDERR:", _result.stderr[:300])
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ---

    ## 7. Can We Fix Playwright? The Base64 Optimization

    The sub-step benchmarks reveal something striking: **JSON serialization dominates
    the Playwright path.** The CDP round-trip and GPU readback together cost less than
    1 ms — it's `Array.from()` + `JSON.stringify()` of 7,056 pixel values that takes
    over 10 ms.

    The fix is simple: **encode the observation as base64 instead of a JSON number array.**
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    **Why JSON arrays are expensive for pixel data:**

    `JSON.stringify([0, 128, 255, ...])` must convert each of 7,056 bytes into
    its ASCII decimal representation, separated by commas. The result is ~30 KB of
    text for 7 KB of data. Each number requires individual string conversion, comma
    insertion, and later individual parsing on the receiving side.

    **Why base64 is fast:**

    `btoa(binaryString)` converts the same 7 KB into a ~9.4 KB base64 string — a single
    contiguous string value in JSON. No per-element overhead. The browser's native
    `btoa()` is a tight C++ loop, and CDP transfers it as one JSON string field instead
    of a 7,056-element array.

    Here's the change inside `page.evaluate()`:
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ```javascript
    // BEFORE: JSON array — 7,056 individual numbers serialized to ~30 KB
    window.__codexGetObservation = () => {
      const imageData = ctx.getImageData(0, 0, w, h);
      const obs = preprocessObservation(imageData.data, w, h, 84, 84);
      return Array.from(obs);  // slow: per-element JSON serialization
    };

    // AFTER: base64 string — same 7 KB encoded to ~9.4 KB single string
    window.__codexGetObservationBase64 = () => {
      const imageData = ctx.getImageData(0, 0, w, h);
      const obs = preprocessObservation(imageData.data, w, h, 84, 84);
      let binary = '';
      for (let i = 0; i < obs.length; i++) binary += String.fromCharCode(obs[i]);
      return btoa(binary);  // fast: single native C++ call
    };
    ```

    On the receiving side, decoding is equally simple:

    ```javascript
    // Node.js
    const obs = Buffer.from(base64String, 'base64');
    ```

    ```python
    # Python
    obs = np.frombuffer(base64.b64decode(payload), dtype=np.uint8).reshape(84, 84)
    ```
    """)
    return


@app.cell(hide_code=True)
def _(mo, bench_data):
    _b = bench_data["browser"]["substeps"]
    _json_ms = _b["jsonTransfer"]["perStepMs"]
    _b64_ms = _b["base64Transfer"]["perStepMs"]
    _ratio = _json_ms / _b64_ms
    _json_fps = bench_data["browser"]["canvasReadback"]["fps"]
    _b64_fps = bench_data["browser"]["base64Readback"]["fps"]
    _h_fps = bench_data["headless"]["rlStep"]["fps"]
    mo.md(f"""
    **Measured impact:**

    | Transfer method | Per-step transfer cost | End-to-end FPS |
    |---|---:|---:|
    | JSON (`Array.from` + `JSON.stringify`) | {_json_ms:.2f} ms | {_json_fps:.0f} |
    | base64 (`btoa` + string) | {_b64_ms:.4f} ms | {_b64_fps:,.0f} |
    | Headless Node (raw bytes, no CDP) | ~0 ms | {_h_fps:,.0f} |

    Base64 is **{_ratio:.0f}x faster** than JSON for the transfer step. This single change
    takes Playwright from {_json_fps:.0f} FPS to {_b64_fps:,.0f} FPS — closing most of the gap
    with headless Node ({_h_fps:,.0f} FPS).

    The remaining {_h_fps/_b64_fps:.1f}x gap comes from overhead that base64 can't eliminate:
    the CDP WebSocket round-trip, GPU-to-CPU readback for `getImageData()`, and the
    process boundary between Playwright and Chromium. The headless Node path avoids all
    of these because the game, observation pipeline, and RL agent share the same process.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ---

    ## 8. Putting It All Together — The Full Data Flow

    Side-by-side comparison of one RL step through each approach:
    """)
    return


@app.cell(hide_code=True)
def _(mo, bench_data):
    _h = bench_data["headless"]
    _b = bench_data["browser"]
    # Headless measured sub-steps
    _h_tick = _h["substeps"]["tick"]["perStepMs"]
    _h_pixel = _h["substeps"]["pixelRead"]["perStepMs"]
    _h_preprocess = _h["substeps"]["preprocess"]["perStepMs"]
    _h_state = _h["substeps"]["stateRead"]["perStepMs"]
    _h_total = _h["rlStep"]["elapsedMs"] / _h["rlStep"]["steps"]
    _h_fps = _h["rlStep"]["fps"]
    # Playwright measured sub-steps
    _b_cdp = _b["substeps"]["cdpRoundtrip"]["perStepMs"]
    _b_gpu = _b["substeps"]["gpuReadback"]["perStepMs"]
    _b_json = _b["substeps"]["jsonTransfer"]["perStepMs"]
    _b_b64 = _b["substeps"]["base64Transfer"]["perStepMs"]
    _b_json_total = _b["canvasReadback"]["elapsedMs"] / _b["canvasReadback"]["steps"]
    _b_json_fps = _b["canvasReadback"]["fps"]
    _b_b64_total = _b["base64Readback"]["elapsedMs"] / _b["base64Readback"]["steps"]
    _b_b64_fps = _b["base64Readback"]["fps"]
    _css = """
    <style>
    .compare-container { display: flex; gap: 12px; max-width: 960px; font-family: ui-monospace, monospace; font-size: 11px; }
    .compare-col { flex: 1; border-radius: 8px; overflow: hidden; }
    .compare-header { padding: 8px 10px; font-weight: 700; font-size: 12px; text-align: center; }
    .compare-header-red { background: #e74c3c; color: white; }
    .compare-header-blue { background: #3498db; color: white; }
    .compare-header-green { background: #27ae60; color: white; }
    .compare-step { padding: 5px 8px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
    .compare-step:nth-child(odd) { background: #fafafa; }
    .compare-step .cost { font-weight: 700; white-space: nowrap; }
    .cost-bad { color: #e74c3c; }
    .cost-blue { color: #3498db; }
    .cost-good { color: #27ae60; }
    .compare-total { padding: 8px 10px; font-weight: 700; font-size: 12px; display: flex; justify-content: space-between; }
    .compare-total-red { background: #fdf0ef; border-top: 2px solid #e74c3c; }
    .compare-total-blue { background: #ebf5fb; border-top: 2px solid #3498db; }
    .compare-total-green { background: #eafaf1; border-top: 2px solid #27ae60; }
    </style>
    """
    mo.Html(
        _css
        + f"""
    <div class="compare-container">
      <div class="compare-col" style="border: 2px solid #e74c3c;">
        <div class="compare-header compare-header-red">Playwright + JSON</div>
        <div class="compare-step">CDP + draw() + state<span class="cost cost-bad">{_b_cdp:.2f} ms</span></div>
        <div class="compare-step">getImageData() GPU&rarr;CPU<span class="cost cost-bad">{_b_gpu:.2f} ms</span></div>
        <div class="compare-step">preprocess 84x84<span class="cost cost-bad" style="font-size:10px">included &darr;</span></div>
        <div class="compare-step" style="background:#fdf0ef;"><b>Array.from() + JSON.stringify</b><span class="cost cost-bad"><b>{_b_json:.2f} ms</b></span></div>
        <div class="compare-total compare-total-red">Total<span><b>{_b_json_total:.1f} ms</b> ({_b_json_fps:.0f} FPS)</span></div>
      </div>
      <div class="compare-col" style="border: 2px solid #3498db;">
        <div class="compare-header compare-header-blue">Playwright + base64</div>
        <div class="compare-step">CDP + draw() + state<span class="cost cost-blue">{_b_cdp:.2f} ms</span></div>
        <div class="compare-step">getImageData() GPU&rarr;CPU<span class="cost cost-blue">{_b_gpu:.2f} ms</span></div>
        <div class="compare-step">preprocess 84x84<span class="cost cost-blue" style="font-size:10px">included &darr;</span></div>
        <div class="compare-step" style="background:#ebf5fb;"><b>btoa() + string transfer</b><span class="cost cost-blue"><b>{_b_b64:.4f} ms</b></span></div>
        <div class="compare-total compare-total-blue">Total<span><b>{_b_b64_total:.2f} ms</b> ({_b_b64_fps:,.0f} FPS)</span></div>
      </div>
      <div class="compare-col" style="border: 2px solid #27ae60;">
        <div class="compare-header compare-header-green">Headless Node</div>
        <div class="compare-step">tick() &rarr; draw()<span class="cost cost-good">{_h_tick:.3f} ms</span></div>
        <div class="compare-step">getPixelData() RAM read<span class="cost cost-good">{_h_pixel:.3f} ms</span></div>
        <div class="compare-step">preprocess 84x84<span class="cost cost-good">{_h_preprocess:.4f} ms</span></div>
        <div class="compare-step">getGameState()<span class="cost cost-good">{_h_state:.4f} ms</span></div>
        <div class="compare-total compare-total-green">Total<span><b>{_h_total:.2f} ms</b> ({_h_fps:,.0f} FPS)</span></div>
      </div>
    </div>
    """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    Let's run the actual Python Gymnasium wrapper and time a real RL step sequence:
    """)
    return


@app.cell(hide_code=True)
def _(REPO_ROOT, os, sys, time):
    # Add the project to sys.path so we can import the env
    if os.path.join(REPO_ROOT, "src") not in sys.path:
        sys.path.insert(0, os.path.join(REPO_ROOT, "src"))

    from fast_games.archive.kazuki_gym_env import KazukiGymEnv

    env = KazukiGymEnv()
    obs, info = env.reset(seed=42)
    print(f"Observation shape: {obs.shape}")
    print(f"Observation dtype: {obs.dtype}")
    print(f"Game state: {info['gameState']}, Score: {info['score']}, Lives: {info['lives']}")
    print()

    # Time 500 steps
    _n_steps = 500
    _start = time.perf_counter()
    for _i in range(_n_steps):
        _action = 2 if _i % 60 < 30 else 1  # Alternate right/left
        obs, _reward, _terminated, _truncated, info = env.step(_action)
        if _terminated or _truncated:
            obs, info = env.reset(seed=42 + _i)
    _elapsed_ms = (time.perf_counter() - _start) * 1000

    print(f"Benchmark: {_n_steps} steps in {_elapsed_ms:.1f} ms")
    print(f"  Per step: {_elapsed_ms/_n_steps:.3f} ms")
    print(f"  FPS: {_n_steps / (_elapsed_ms / 1000):.0f}")
    print(f"  Final obs range: [{obs.min()}, {obs.max()}]")
    env.close()
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ---

    ## 9. Benchmarks — Measuring the Gap

    Running the full Node.js benchmark suite that compares headless vs Playwright:
    """)
    return


@app.cell(hide_code=True)
def _(REPO_ROOT, json, os, subprocess):
    _latest_path = os.path.join(REPO_ROOT, "outputs", "kazuki-benchmark-latest.json")

    # Run the Node.js benchmark (includes Playwright — needs Chrome installed)
    _bench_result = subprocess.run(
        ["node", "benchmarks/kazuki-compare.mjs"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if _bench_result.returncode == 0:
        print(_bench_result.stdout)
    else:
        print("Benchmark run failed (Chrome not found?), using cached results.")
        if _bench_result.stderr:
            print("STDERR:", _bench_result.stderr[:300])

    # Load the results (fresh or cached)
    bench_results = json.loads(open(_latest_path).read())
    return (bench_results,)


@app.cell(hide_code=True)
def _(bench_results, np, plt):
    _labels = [
        "Node headless\n(render only)",
        "Node headless\n(RL step)",
        "Playwright\n(render only)",
        "Playwright\n(base64)",
        "Playwright\n(getImageData)",
        "Playwright\n(screenshot)",
    ]
    _fps = [
        bench_results["headless"]["renderOnly"]["fps"],
        bench_results["headless"]["rlStep"]["fps"],
        bench_results["browser"]["renderOnly"]["fps"],
        bench_results["browser"]["base64Readback"]["fps"],
        bench_results["browser"]["canvasReadback"]["fps"],
        bench_results["browser"]["screenshotReadback"]["fps"],
    ]
    _colors = ["#2ecc71", "#27ae60", "#f39c12", "#3498db", "#e74c3c", "#c0392b"]

    _fig, (_ax1, _ax2) = plt.subplots(1, 2, figsize=(14, 4.5))

    # ── Chart 1: FPS comparison (log scale) ──
    _bars = _ax1.bar(
        _labels, _fps, color=_colors, edgecolor="white", linewidth=0.8, width=0.65
    )
    _ax1.set_ylabel("Frames per Second (FPS)")
    _ax1.set_title("FPS Comparison", fontweight="bold")
    _ax1.set_yscale("log")
    for _bar, _f in zip(_bars, _fps):
        _ax1.text(
            _bar.get_x() + _bar.get_width() / 2,
            _bar.get_height() * 1.2,
            f"{_f:,.0f}",
            ha="center",
            va="bottom",
            fontweight="bold",
            fontsize=9,
        )
    _ax1.set_ylim(10, max(_fps) * 4)
    _ax1.tick_params(axis="x", labelsize=7)

    # ── Chart 2: Per-step time breakdown (stacked bar) ──
    _h_render = (
        bench_results["headless"]["renderOnly"]["elapsedMs"]
        / bench_results["headless"]["renderOnly"]["steps"]
    )
    _h_total = (
        bench_results["headless"]["rlStep"]["elapsedMs"]
        / bench_results["headless"]["rlStep"]["steps"]
    )
    _h_obs = _h_total - _h_render

    _b_render = (
        bench_results["browser"]["renderOnly"]["elapsedMs"]
        / bench_results["browser"]["renderOnly"]["steps"]
    )

    _b_b64 = (
        bench_results["browser"]["base64Readback"]["elapsedMs"]
        / bench_results["browser"]["base64Readback"]["steps"]
    )
    _b_b64_obs = _b_b64 - _b_render

    _b_canvas = (
        bench_results["browser"]["canvasReadback"]["elapsedMs"]
        / bench_results["browser"]["canvasReadback"]["steps"]
    )
    _b_canvas_obs = _b_canvas - _b_render

    _b_ss = (
        bench_results["browser"]["screenshotReadback"]["elapsedMs"]
        / bench_results["browser"]["screenshotReadback"]["steps"]
    )
    _b_ss_obs = _b_ss - _b_render

    _bd_labels = [
        "Node\nheadless",
        "Playwright\nbase64",
        "Playwright\ngetImageData",
        "Playwright\nscreenshot",
    ]
    _render = [_h_render, _b_render, _b_render, _b_render]
    _obs = [_h_obs, _b_b64_obs, _b_canvas_obs, _b_ss_obs]

    _x = np.arange(len(_bd_labels))
    _w = 0.5
    _ax2.bar(
        _x,
        _render,
        _w,
        label="Render (draw())",
        color="#3498db",
        edgecolor="white",
        linewidth=0.8,
    )
    _ax2.bar(
        _x,
        _obs,
        _w,
        bottom=_render,
        label="Observation + transfer",
        color="#e74c3c",
        edgecolor="white",
        linewidth=0.8,
    )
    _ax2.set_ylabel("Time per step (ms)")
    _ax2.set_title("Per-Step Breakdown", fontweight="bold")
    _ax2.set_xticks(_x)
    _ax2.set_xticklabels(_bd_labels, fontsize=9)
    _ax2.legend(fontsize=9, loc="upper left")

    for _i, (_r, _o) in enumerate(zip(_render, _obs)):
        _total = _r + _o
        _ax2.text(
            _i,
            _total + max(_obs) * 0.04,
            f"{_total:.2f} ms\n({1000/_total:.0f} FPS)",
            ha="center",
            fontweight="bold",
            fontsize=8,
        )

    _ax2.set_ylim(0, max(r + o for r, o in zip(_render, _obs)) * 1.25)

    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(bench_results, np, plt):
    # ── Granular sub-step breakdown chart ──
    _h_sub = bench_results["headless"]["substeps"]
    _b_sub = bench_results["browser"]["substeps"]

    _fig, (_ax1, _ax2) = plt.subplots(1, 2, figsize=(13, 4.5),
                                       gridspec_kw={"width_ratios": [1, 1.2]})

    # Left: Headless Node sub-steps (horizontal bar)
    _h_labels = ["tick() / draw()", "getPixelData()", "preprocess 84x84", "getGameState()"]
    _h_values = [
        _h_sub["tick"]["perStepMs"],
        _h_sub["pixelRead"]["perStepMs"],
        _h_sub["preprocess"]["perStepMs"],
        _h_sub["stateRead"]["perStepMs"],
    ]
    _h_colors = ["#2ecc71", "#27ae60", "#1abc9c", "#16a085"]
    _y = np.arange(len(_h_labels))
    _bars1 = _ax1.barh(_y, _h_values, color=_h_colors, height=0.55, edgecolor="white")
    _ax1.set_yticks(_y)
    _ax1.set_yticklabels(_h_labels, fontsize=9)
    _ax1.set_xlabel("Time per step (ms)")
    _ax1.set_title("Headless Node Sub-Steps", fontweight="bold")
    _ax1.invert_yaxis()
    for _bar, _v in zip(_bars1, _h_values):
        _label = f"{_v:.4f} ms" if _v < 0.01 else f"{_v:.3f} ms"
        _ax1.text(
            _bar.get_width() + max(_h_values) * 0.03,
            _bar.get_y() + _bar.get_height() / 2,
            _label,
            va="center",
            fontweight="bold",
            fontsize=9,
        )
    _ax1.set_xlim(0, max(_h_values) * 1.45)

    # Right: Playwright sub-steps (horizontal bar) — JSON vs base64 comparison
    _b_labels = [
        "CDP roundtrip\n+ draw() + state",
        "getImageData()\nGPU\u2192CPU readback",
        "JSON: Array.from() +\nJSON.stringify + transfer",
        "base64: btoa() +\nstring transfer",
    ]
    _b_values = [
        _b_sub["cdpRoundtrip"]["perStepMs"],
        _b_sub["gpuReadback"]["perStepMs"],
        _b_sub["jsonTransfer"]["perStepMs"],
        _b_sub["base64Transfer"]["perStepMs"],
    ]
    _b_colors = ["#f39c12", "#e67e22", "#e74c3c", "#3498db"]
    _y2 = np.arange(len(_b_labels))
    _bars2 = _ax2.barh(_y2, _b_values, color=_b_colors, height=0.55, edgecolor="white")
    _ax2.set_yticks(_y2)
    _ax2.set_yticklabels(_b_labels, fontsize=9)
    _ax2.set_xlabel("Time per step (ms)")
    _ax2.set_title("Playwright Sub-Steps", fontweight="bold")
    _ax2.invert_yaxis()
    for _bar, _v in zip(_bars2, _b_values):
        _label = f"{_v:.4f} ms" if _v < 0.1 else f"{_v:.2f} ms"
        _ax2.text(
            _bar.get_width() + max(_b_values) * 0.03,
            _bar.get_y() + _bar.get_height() / 2,
            _label,
            va="center",
            fontweight="bold",
            fontsize=9,
        )
    _ax2.set_xlim(0, max(_b_values) * 1.3)

    _h_total = sum(_h_values)
    _b_json_total = _b_values[0] + _b_values[1] + _b_values[2]
    _b_b64_total = _b_values[0] + _b_values[1] + _b_values[3]
    _fig.suptitle(
        f"Sub-step breakdown: headless {_h_total:.2f} ms vs Playwright JSON {_b_json_total:.1f} ms "
        f"vs base64 {_b_b64_total:.2f} ms",
        fontsize=11,
        fontweight="bold",
        y=1.02,
    )
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ---

    ## Summary — The Optimization Ladder
    """)
    return


@app.cell(hide_code=True)
def _(mo, bench_data):
    _b = bench_data["browser"]
    _h = bench_data["headless"]
    _json_fps = _b["canvasReadback"]["fps"]
    _b64_fps = _b["base64Readback"]["fps"]
    _h_fps = _h["rlStep"]["fps"]
    _json_ms = _b["canvasReadback"]["elapsedMs"] / _b["canvasReadback"]["steps"]
    _b64_ms = _b["base64Readback"]["elapsedMs"] / _b["base64Readback"]["steps"]
    _h_ms = _h["rlStep"]["elapsedMs"] / _h["rlStep"]["steps"]
    _css = """
    <style>
    .ladder-table { border-collapse: collapse; font-family: system-ui, sans-serif; font-size: 13px; max-width: 820px; width: 100%; }
    .ladder-table th { background: #34495e; color: white; padding: 8px 12px; text-align: left; font-weight: 600; }
    .ladder-table td { padding: 8px 12px; border-bottom: 1px solid #eee; }
    .ladder-table tr:nth-child(odd) td { background: #fafafa; }
    .ladder-table .fps { font-weight: 700; font-size: 15px; }
    .ladder-table .fps-red { color: #e74c3c; }
    .ladder-table .fps-blue { color: #3498db; }
    .ladder-table .fps-green { color: #27ae60; }
    </style>
    """
    mo.Html(
        _css
        + f"""
    <table class="ladder-table">
      <tr>
        <th>Approach</th>
        <th>What changes</th>
        <th>Per-step</th>
        <th>FPS</th>
        <th>Speedup</th>
      </tr>
      <tr>
        <td><b>Playwright + JSON</b></td>
        <td>Naive: Array.from() + JSON.stringify 7,056 numbers</td>
        <td>{_json_ms:.1f} ms</td>
        <td class="fps fps-red">{_json_fps:.0f}</td>
        <td>&mdash;</td>
      </tr>
      <tr>
        <td><b>Playwright + base64</b></td>
        <td>Encode observation as base64 string instead of JSON array</td>
        <td>{_b64_ms:.2f} ms</td>
        <td class="fps fps-blue">{_b64_fps:,.0f}</td>
        <td>{_b64_fps/_json_fps:.0f}x vs JSON</td>
      </tr>
      <tr>
        <td><b>Headless Node + raw bytes</b></td>
        <td>No browser, no CDP &mdash; game runs in same process, raw pipe IPC</td>
        <td>{_h_ms:.2f} ms</td>
        <td class="fps fps-green">{_h_fps:,.0f}</td>
        <td>{_h_fps/_json_fps:.0f}x vs JSON</td>
      </tr>
    </table>
    """
    )
    return


@app.cell(hide_code=True)
def _(mo, bench_data):
    _b = bench_data["browser"]
    _h = bench_data["headless"]
    _json_fps = _b["canvasReadback"]["fps"]
    _b64_fps = _b["base64Readback"]["fps"]
    _h_fps = _h["rlStep"]["fps"]
    _json_transfer = _b["substeps"]["jsonTransfer"]["perStepMs"]
    _b64_transfer = _b["substeps"]["base64Transfer"]["perStepMs"]
    _cpu = bench_data["system"]["cpu_model"] or "unknown"
    mo.md(f"""
    **The game rendering is the same speed across all three approaches** (~0.4 ms).
    Everything else is overhead.

    **Step 1 — Fix the serialization ({_json_fps:.0f} &rarr; {_b64_fps:,.0f} FPS):**
    The naive Playwright approach spends {_json_transfer:.1f} ms per step on
    `Array.from()` + `JSON.stringify()` of 7,056 pixel values. Switching to `btoa()`
    encodes the same data in {_b64_transfer:.4f} ms. This alone is a **{_b64_fps/_json_fps:.0f}x speedup**
    and is a one-line change. If you need a real browser (WebGL, complex DOM), this
    makes Playwright viable for RL training.

    **Step 2 — Eliminate the browser ({_b64_fps:,.0f} &rarr; {_h_fps:,.0f} FPS):**
    The remaining {_h_fps/_b64_fps:.1f}x gap comes from overhead that no encoding trick can fix:
    - CDP WebSocket round-trip (~{_b["substeps"]["cdpRoundtrip"]["perStepMs"]:.2f} ms per step)
    - GPU&rarr;CPU readback for `getImageData()` (~{_b["substeps"]["gpuReadback"]["perStepMs"]:.2f} ms per step)
    - Process boundary between Playwright and Chromium

    The headless Node shim eliminates all of these by running the game in the same
    process: Cairo renders to a CPU buffer, `getPixelData()` reads it directly from
    memory, and the observation goes to Python via raw bytes over a stdin/stdout pipe.

    **Choose based on your needs:**
    - Game requires a real browser (WebGL, DOM)? &rarr; **Playwright + base64** ({_b64_fps:,.0f} FPS)
    - Game uses only Canvas 2D? &rarr; **Headless Node shim** ({_h_fps:,.0f} FPS)

    *(All numbers from `outputs/kazuki-benchmark-latest.json`, measured on {_cpu}.)*
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ---

    ### Appendix: The VM Trick for Game State Access

    One subtle piece: how does the Node.js environment access the game's internal variables
    (`score`, `lives`, `gameState`) when they're declared with `let`/`const` inside the
    game script?

    `let` and `const` in a script evaluated via `vm.runInThisContext()` are **script-scoped**,
    not properties of `globalThis`. You can't access them from outside the script.

    The solution: **append getter/setter closures** to the game code before evaluation:

    ```javascript
    // envs/kazuki-env.mjs
    let gameCode = readFileSync('kazuki_game.js', 'utf8');
    gameCode += `
    globalThis.getGameState = () => ({
        gameState, score, lives, player, inventory, currentRoom
    });
    globalThis.setGameState = (s) => { gameState = s; };
    `;
    vm.runInThisContext(gameCode);
    ```

    Because the appended code runs in the **same script scope**, it captures the game's
    `let`-declared variables in a closure. Now `globalThis.getGameState()` can return them,
    and the RL environment can read game state without modifying the original game code.
    """)
    return


if __name__ == "__main__":
    app.run()
