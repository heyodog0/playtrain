#!/usr/bin/env bash
# Redraw every measured figure and table in the paper.
#
#   bash reproduction/reproduce.sh          # everything that needs no download
#   bash reproduction/reproduce.sh --all    # also the learning-curve composite
#
# Outputs land in reproduction/out/. Each step prints the number the paper
# reports beside the one it just computed.
set -uo pipefail
cd "$(dirname "$0")"
OUT="$PWD/out"; mkdir -p "$OUT"
PY="uv run --no-project --with matplotlib --with numpy --with pillow"
PYTB="$PY --with tensorboard"
ok=0; fail=0
if [ "${1:-}" = "--all" ] && [ ! -f figures/outputs/percmd.json ]; then
  echo "fetching run data (277 MB, once)"; bash figures/fetch_data.sh || exit 1
fi
step() { printf '\n=== %s\n' "$1"; }
done_() { if [ "$1" -eq 0 ]; then ok=$((ok+1)); echo "    ok"; else fail=$((fail+1)); echo "    FAILED"; fi; }

step "Figure 4, environment efficiency  (paper: 2.19x ProcGen, 12.62x ALE)"
( cd figures && $PY python tools/plot_env_efficiency_bestonly.py \
    --ab-results scaling --pg-job 44515188 --ale-job 44515188 --out "$OUT" ) ; done_ $?

step "Environment cost breakdown"
if [ -f figures/outputs/percmd.json ]; then
  ( cd figures && $PY python tools/plot_env_cost.py \
      outputs/percmd.json outputs/logic_probes.json outputs/grid.json "$OUT/fig_env_cost" )
  done_ $?
else
  echo "    skipped: run 'bash reproduction/figures/fetch_data.sh' first"
fi

step "Table 1(a), training throughput  (paper: 1.07M / 0.35M / 185k / 68k)"
( cd figures/tables && uv run --no-project python t1a_agg.py \
    impala_nature=44748571+44784183 impala_icnn=44748573 \
    ppo_nature=44748574+44784184 ppo_impala=44748575+44784185 | head -14 ) ; done_ $?

step "Table 1(b), environment swap  (paper: 372k -> 838k, 175k -> 1,018k)"
( cd figures/tables && uv run --no-project python tab1b.py ) ; done_ $?

step "Table 7, double-buffering ablation  (paper: miner 969k/465k/2.08x)"
( cd figures/tables && $PY python dbuf_tex2.py | head -6 ) ; done_ $?

step "Human wall-clock figure"
TMPS=$(mktemp -d)
python3 -c "
import gzip, glob, os, shutil, sys
for f in glob.glob('data/study/*.json.gz'):
    with gzip.open(f, 'rb') as i, open(os.path.join(sys.argv[1], os.path.basename(f)[:-3]), 'wb') as o:
        shutil.copyfileobj(i, o)" "$TMPS"
( cd figures/human && $PY python plot_wallclock5.py rerun_curves.json "$TMPS" "$OUT" ) ; done_ $?

step "Architecture schematic"
( cd figures && $PY python fig_schematic.py "$OUT" ) ; done_ $?

step "Appendix eval table  (paper: 24 games, e.g. seaquest 102.5 / 732.5)"
python3 - <<'PYEOF'
import json
d = json.load(open("figures/results/eval_iddp_suite.json"))
for g in ("seaquest", "bigfish", "pong"):
    print(f"    {g:10s} random {d[g]['random_return']:7.1f}  greedy {d[g]['greedy_return']:7.1f}")
print(f"    {len(d)} games total")
PYEOF
done_ $?

if [ "${1:-}" = "--all" ]; then
  step "Learning-curve composite"
  ( cd figures && $PYTB python tools/plot_main_composite.py "$OUT/fig_main.png" ) ; done_ $?
  step "Per-game suite grids"
  ( cd figures && cp outputs/_suite*_curves.json . 2>/dev/null
    $PYTB python tools/plot_suite_grid.py --out "$OUT" \
    && $PYTB python tools/plot_suite_grid3.py --out "$OUT" ) ; done_ $?
fi

printf '\n%s\n' "----"
echo "$ok ok, $fail failed. Outputs in reproduction/out/"
echo "Not covered here: tab:llm-cost, which needs GEMINI_API_KEY (playtrain.gen.count_tokens)."
