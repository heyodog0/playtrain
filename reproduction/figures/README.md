# Paper figures

`tools/` draws every figure in the paper. `results/` holds the throughput data, committed
because it is small. Everything else the figures read (TensorBoard events, per-run
configs, curve JSONs, rendered frames) is 1.1 GB, so it is a release asset:

```bash
bash reproduction/figures/fetch_data.sh
```

Then, for the main figure:

```bash
cd reproduction/figures
uv run --no-project --with matplotlib --with numpy --with pillow --with tensorboard \
   python tools/plot_main_composite.py outputs/figs/fig_main.png
```

Two things to know before changing anything here.

`throughput_panels.py` verifies the committed throughput data against the values printed
in the paper and refuses to draw if they disagree. That is deliberate. If it fires, the
data and the paper have diverged, and the figure would otherwise be quietly wrong.

Runs are selected by config content, not by directory name. `_runs()` in
`plot_main_composite.py` reads every `outputs/*/config.json` and filters on game,
encoder and step budget. Selecting by directory prefix has twice dropped a whole arm of
the comparison without any error, so do not reintroduce it.
