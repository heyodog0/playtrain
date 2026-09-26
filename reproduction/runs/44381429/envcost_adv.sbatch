#!/bin/bash -l
#SBATCH -J envcost_adv
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C sapphirerapids
#SBATCH -N 1
#SBATCH -c 1
#SBATCH --mem=16G
#SBATCH -t 0-04:00
# Re-measure app:envcost (fig:envcost + tab:envcost) on the ADOPTED build.
# Anatomy (per-primitive prices, per-binding counts, decomposition) runs with
# QJS_DIRTY UNSET: dirty-skip removes the raster pass on skipped frames, so a
# step decomposition under it would not be an anatomy of a rendered step.
# Throughput is then re-run with QJS_DIRTY=1, the paper's measurement setting.
# Binary: libqjs_vec.advdc.so = adv recipe + per-binding counters (d336297).
# Published pre-adv outputs are preserved as *_preadv.json, never overwritten.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs outputs
D="$(pwd)"
WT=/n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-tuning
LIVE=/n/holylabs/gershman_lab/Users/rtruong/playtrain
PY="$D/.venv/bin/python"
export PYTHONPATH="$D/src:$WT/src"
V="$WT/native/build/variants"
INSTALLED="$WT/native/build/libqjs_vec.so"
echo "node=$(hostname)"; lscpu | grep -E "Model name|CPU max MHz|CPU MHz" | head -3

ADV=$(md5sum "$V/libqjs_vec.adv.so" | cut -d' ' -f1)
DC=$(md5sum "$V/libqjs_vec.advdc.so" | cut -d' ' -f1)
echo "adv=$ADV advdc=$DC"
[ -f "$V/libqjs_vec.advdc.so" ] || { echo NO_ADVDC; exit 1; }
nm -D --defined-only "$V/libqjs_vec.advdc.so" | grep -q vec_draw_count || { echo NO_COUNTERS; exit 1; }

restore() { cp "$V/libqjs_vec.adv.so" "$INSTALLED"; echo "restored adv: $(md5sum "$INSTALLED" | cut -d' ' -f1)"; }
trap restore EXIT

echo "== preserve pre-adv outputs =="
for f in percmd logic_probes grid probes; do
  [ -f "outputs/$f.json" ] && cp -n "outputs/$f.json" "outputs/${f}_preadv.json" && echo "kept outputs/${f}_preadv.json"
done

echo "== install advdc =="
cp "$V/libqjs_vec.advdc.so" "$INSTALLED"
md5sum "$INSTALLED"

echo "== regenerate probe environments =="
"$PY" tools/gen_probes.py       --outdir "$LIVE/examples/games/probe" || exit 1
"$PY" tools/gen_logic_probes.py --outdir "$LIVE/examples/games/probe" || exit 1
"$PY" tools/gen_grid_probes.py  --outdir "$LIVE/examples/games/probe" || exit 1

echo "== price the probes (dirty OFF) =="
unset QJS_DIRTY
"$PY" tools/bench_probes.py       --out outputs/probes.json       || exit 1
"$PY" tools/bench_logic_probes.py --out outputs/logic_probes.json || exit 1
"$PY" tools/bench_grid.py         --out outputs/grid.json         || exit 1

echo "== per-primitive prices + per-game counts (dirty OFF) =="
"$PY" tools/percmd_measure.py || exit 1
cp outputs/percmd.json outputs/percmd_adv_nodirty.json

echo "== throughput with QJS_DIRTY=1 (paper setting) =="
QJS_DIRTY=1 "$PY" tools/percmd_measure.py || exit 1
cp outputs/percmd.json outputs/percmd_adv_dirty.json
cp outputs/percmd_adv_nodirty.json outputs/percmd.json

echo "== figure + table from the dirty-off anatomy =="
"$PY" tools/plot_env_cost.py outputs/percmd.json outputs/logic_probes.json outputs/grid.json outputs/fig_env_cost_adv || echo PLOT_FAIL
"$PY" tools/mktab_envcost.py > outputs/tab_envcost_adv.tex || echo TAB_FAIL
head -20 outputs/tab_envcost_adv.tex 2>/dev/null
ls -la outputs/fig_env_cost_adv* outputs/percmd_adv_*.json 2>/dev/null
echo ENVCOST_ADV_DONE
