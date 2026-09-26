#!/usr/bin/env bash
# Redraw every measured figure and table in the paper.
#
#   bash reproduction/reproduce.sh                  # every step
#   bash reproduction/reproduce.sh env_efficiency   # one step by name
#   bash reproduction/reproduce.sh --list           # the step names
#
# Outputs land in reproduction/out/. Each step prints the number the paper
# reports beside the one it just computed. Provenance for every step -- code,
# data, cluster job -- is in reproduction/PROVENANCE.md.
set -uo pipefail
cd "$(dirname "$0")"
OUT="$PWD/out"; mkdir -p "$OUT"
# Each figure is drawn with the matplotlib version the paper's copy records, so
# redraws match it pixel for pixel: 3.11.2 by default, 3.10.9 for the learning
# composite and the human figure, 3.11.1 for the suite grids.
PY="uv run --no-project --with matplotlib==3.11.2 --with numpy --with pillow"
PYTB="$PY --with tensorboard"
PY3109="uv run --no-project --python 3.13 --with matplotlib==3.10.9 --with numpy==2.4.4 --with pillow==12.2.0"
PY3111="uv run --no-project --with matplotlib==3.11.1 --with numpy --with pillow --with tensorboard"
# Pixel comparison of a redrawn figure with the file the paper includes (expected/figures/).
CMP="uv run --no-project --with numpy --with pillow --with pymupdf python tools/compare_figure.py"
ok=0; fail=0; skipped=0
# Steps that read the run data (TensorBoard events, configs, timings; ~120 MB), a release asset.
need_data() {
  [ -f figures/outputs/percmd.json ] && [ -f figures/outputs/_suite4_curves.json ] && return 0
  echo "    skipped: needs the run data -- bash reproduction/fetch_data.sh"; done_ 3; return 1
}

STEPS="env_efficiency panel_a backend_ladder bench_setup bench_scaling env_cost env_cost_check envcost_table t1a t1a_nodes t1b dbuf dbuf_check human_cohort human_wallclock human_crossings human_rescore eval eval3 learning suite_check suite_grids craftax_views craftax_frames llm_cost action_space step_return p5_subset hyperparams envpool_config"
ALL=0; SEL=""
case "${1:-}" in
  --list) printf '%s\n' $STEPS; exit 0 ;;
  --all)  ALL=1 ;;
  "")     ;;
  -*)     echo "unknown option $1; try --list" >&2; exit 2 ;;
  *)      SEL="$1"
          case " $STEPS " in *" $SEL "*) ;; *) echo "no such step: $SEL (see --list)" >&2; exit 2 ;; esac ;;
esac
# Named steps run on their own.
want() { if [ -n "$SEL" ]; then [ "$SEL" = "$1" ]; else [ "${2:-1}" -eq 1 ] || [ "$ALL" -eq 1 ]; fi; }

step() { printf '\n=== %s\n' "$1"; }
done_() { case "$1" in 0) ok=$((ok+1)); echo "    ok";; 3) skipped=$((skipped+1));; *) fail=$((fail+1)); echo "    FAILED";; esac; }

if want env_efficiency; then
step "Figure 4, environment efficiency  (paper: per core 2.18x ProcGen 14/16, 12.62x ALE 8/8; 80 threads 2.58x / 20.80x)"
( cd figures && $PY python tools/plot_env_efficiency_bestonly.py --out "$OUT" \
  && $CMP "$OUT/fig_env_efficiency.pdf" ../expected/figures/fig_env_efficiency.pdf ) ; done_ $?
fi

if want panel_a; then
step "Figure 4A constants  (paper: 2.58x ProcGen and 20.80x ALE at 80 threads; every plotted point against its job)"
( cd figures && uv run --no-project python tools/check_panel_a.py ) ; done_ $?
fi

if want backend_ladder; then
step "Figure 4B, backend ladder  (paper: 13.4x V8 -> QuickJS, 117x browser -> QuickJS)"
( cd figures && uv run --no-project python tools/check_backend_ladder.py ) ; done_ $?
fi

if want bench_setup; then
step "Table 9, benchmark setup  (paper: 12.62x / 2.18x, 20.80x / 2.58x, 5.8x / 2.25x)"
( cd figures && $PY python tools/check_bench_setup.py ) ; done_ $?
fi

if want bench_scaling; then
step "Table 10, thread scaling  (all 70 cells, parsed straight out of main.tex)"
( cd figures && uv run --no-project python tools/check_bench_scaling.py ) ; done_ $?
fi

if want env_cost; then
step "Environment cost breakdown"
if [ -f figures/outputs/percmd.json ]; then
  ( cd figures && $PY python tools/plot_env_cost.py \
      outputs/percmd.json outputs/logic_probes.json outputs/grid.json "$OUT/fig_env_cost" \
      && $CMP "$OUT/fig_env_cost.pdf" ../expected/figures/fig_env_cost.pdf )
  done_ $?
else
  echo "    skipped: needs the run data -- bash reproduction/fetch_data.sh"; done_ 3
fi
fi

if want env_cost_check; then
step "Figure 12 numbers  (paper: background 390 ns, pong 11 cmds, miner 75% on 787)"
if need_data; then
( cd figures && uv run --no-project python tools/check_env_cost.py ) ; done_ $?
fi
fi

if want envcost_table; then
step "Table 14, per-game cost  (all 87 cells against percmd.json)"
if need_data; then
( cd figures && uv run --no-project python tools/check_envcost_table.py ) ; done_ $?
fi
fi

if want t1a; then
step "Table 1(a), training throughput  (paper: 1.07M / 0.35M / 185k / 68k)"
( cd figures/tables && uv run --no-project python t1a_agg.py \
    impala_nature=44748571+44784183 impala_icnn=44748573+47057946 \
    ppo_nature=44748574+44784184 ppo_impala=44748575+44784185 | $PY python ../tools/check_table1.py t1a ) ; done_ $?
fi

if want t1a_nodes; then
step "Table 1(a) node provenance  (per-node means; impala_icnn 0.35M after re-run 47057946)"
( cd figures/tables && uv run --no-project python t1a_nodes.py ) ; done_ $?
fi

if want t1b; then
step "Table 1(b), environment swap  (paper: 372k -> 838k, 175k -> 1,018k)"
( cd figures/tables && uv run --no-project python tab1b.py | $PY python ../tools/check_table1.py t1b ) ; done_ $?
fi

if want dbuf; then
step "Table 7, double-buffering ablation  (paper: miner 969k/465k/2.08x)"
( cd figures/tables && $PY python dbuf_tex2.py | $PY python ../tools/check_table1.py dbuf ) ; done_ $?
fi

# CURVES: both arms IMPALA-CNN, as the caption says; VVVVVV from its win-bonus runs.
CURVES=rerun_curves_icnn_vvwin.json   # VVVVVV swapped for its win-bonus runs (swap_vv_curves.py)
unpack_study() {
  python3 -c "
import gzip, glob, os, shutil, sys
for f in glob.glob(sys.argv[2] + '/*.json.gz'):
    with gzip.open(f, 'rb') as i, open(os.path.join(sys.argv[1], os.path.basename(f)[:-3]), 'wb') as o:
        shutil.copyfileobj(i, o)" "$1" "${2:-data/study}"
}

if want dbuf_check; then
step "Table 7 caption claims  (paper: 1.34x overall, median 1.20x, plunder 0.97x)"
( cd figures/tables && $PY python dbuf_check.py ) ; done_ $?
fi

if want human_cohort; then
step "Human study cohort  (paper: 20 participants, 8 games, 6 women / 13 men / 1 non-binary)"
TMPS=$(mktemp -d); unpack_study "$TMPS"
( cd figures/human && uv run --no-project python cohort.py "$TMPS" ) ; done_ $?
fi

if want human_wallclock; then
step "Human play vs agent training  (fig:human_wallclock; 20 participants, VVVVVV scored with its win bonus)"
TMPS=$(mktemp -d); unpack_study "$TMPS" data/study_rescored
( cd figures/human && uv run --no-project python check_curve_encoder.py "$CURVES" \
    && $PY3109 python plot_human_wallclock.py "$CURVES" "$TMPS" "$OUT" \
    && cd .. && $CMP "$OUT/fig_human_wallclock.pdf" ../expected/figures/fig_human_wallclock.pdf ) ; done_ $?
fi

if want human_crossings; then
step "Steps to reach the human mean  (paper: six of eight; flappy_bird PPO 1M, coinrun IMPALA 81M)"
TMPS=$(mktemp -d); unpack_study "$TMPS" data/study_rescored
( cd figures/human && $PY python crossings.py "$CURVES" "$TMPS" ) ; done_ $?
fi

if want human_rescore 0; then
step "Human scores rescored by replaying every logged action  (needs this repo installed: uv pip install -e .)"
TIN=$(mktemp -d); TOUT=$(mktemp -d); TREF=$(mktemp -d); unpack_study "$TIN" data/study; unpack_study "$TREF" data/study_rescored
( cd .. && uv run --no-sync python reproduction/figures/human/replay_all.py "$TIN" "$TOUT" examples/games/js \
  && python3 -c "
import glob, json, os, sys
a, b = sys.argv[1], sys.argv[2]; bad = 0; n = 0
for f in sorted(glob.glob(a + '/*.json')):
    x, y = json.load(open(f)), json.load(open(os.path.join(b, os.path.basename(f))))
    for bx, by in zip(x['blocks'], y['blocks']):
        for ex, ey in zip(bx.get('episodes', []), by.get('episodes', [])):
            n += 1; bad += ex.get('score') != ey.get('score')
print(f'    {n} episodes, {bad} scores differ from data/study_rescored'); sys.exit(1 if bad else 0)" "$TOUT" "$TREF" ) ; done_ $?
fi

if want eval; then
step "Appendix eval table  (all 72 cells against the paper)"
( cd figures && uv run --no-project python tools/check_eval.py ) ; done_ $?
fi

if want eval3; then
step "Appendix eval table, 3 seeds x both trainers  (IMPALA-CNN, 100M; the runs behind the appendix curves)"
( cd figures && uv run --no-project python tools/eval_suite3.py "$OUT" ) ; done_ $?
fi

if want learning; then
step "Learning-curve composite"
if need_data; then
( cd figures && $PY3109 --with tensorboard python tools/plot_main_composite.py "$OUT/fig_main.png" --no-throughput \
  && $CMP "$OUT/fig_main.png" ../expected/figures/fig_main_D.png ) ; done_ $?
fi
fi

if want suite_check; then
step "Suite figure composition  (paper: all 24 games, 3 seeds, 100M steps, PPO from 0.5M)"
if need_data; then
( cd figures && $PY python tools/check_suite.py --data outputs/_suite4_curves.json ) ; done_ $?
fi
fi

if want suite_grids; then
step "Per-game suite grids, the three appendix figures"
if need_data; then
# --arms picks which of the four arms each figure shows, and --name must match
# the file main.tex includes. Without them plot_suite_grid3.py emits the 4-arm
# fig_suite_grid, which no label in the paper uses.
( cd figures \
  && $PY3111 python tools/plot_suite_grid3.py --data outputs/_suite4_curves.json \
       --arms trainers --name fig_suite_trainers  --out "$OUT" \
  && $PY3111 python tools/plot_suite_grid3.py --data outputs/_suite4_curves.json \
       --arms impala   --name fig_suite_enc_impala --out "$OUT" \
  && $PY3111 python tools/plot_suite_grid3.py --data outputs/_suite4_curves.json \
       --arms ppo      --name fig_suite_enc_ppo    --out "$OUT" \
  && for f in fig_suite_trainers fig_suite_enc_impala fig_suite_enc_ppo; do
       $CMP "$OUT/$f.pdf" ../expected/figures/$f.pdf || exit 1; done ) ; done_ $?
fi
fi

if want craftax_views; then
step "Craftax-Classic top-down vs first-person  (fig:craftax_views, from the committed seed-2 frames)"
( cd figures/craftax && $PY python make_figure.py frames "$OUT/fig_craftax_views" \
  && cd .. && $CMP "$OUT/fig_craftax_views.png" ../expected/figures/fig_craftax_views.png ) ; done_ $?
fi

if want craftax_frames 0; then
step "Craftax frames, regenerated by playing the scripted episode  (needs this repo installed: uv pip install -e .)"
mkdir -p "$OUT/craftax_frames"
( cd .. && uv run --no-sync python reproduction/figures/craftax/collect_frames.py "$OUT/craftax_frames" 2 300 \
  && for f in craftax_classic_scripted_s2.npy craftax_fp_scripted_s2.npy log_s2.json; do
       cmp -s "$OUT/craftax_frames/$f" reproduction/figures/craftax/frames/$f \
         && echo "    $f identical to the committed frames" || { echo "    $f DIFFERS"; exit 1; }; done ) ; done_ $?
fi

if want action_space; then
step "Table 3, the default Discrete(8) action space  (against runtime/action_spaces.json)"
( cd figures && uv run --no-project python tools/check_action_space.py ) ; done_ $?
fi

if want step_return; then
step "Table 4, what a step returns  (against the runtime source)"
( cd figures && uv run --no-project python tools/check_step_return.py ) ; done_ $?
fi

if want p5_subset; then
step "Table 5, the p5 subset  (caption says 37 commands)"
( cd figures && uv run --no-project python tools/check_p5_subset.py ) ; done_ $?
fi

if want hyperparams; then
step "Table 12, training configuration  (every cell against the suite run configs)"
if need_data; then
( cd figures && uv run --no-project python tools/check_hyperparams.py ) ; done_ $?
fi
fi

if want envpool_config; then
step "Table 13, the tuned EnvPool configuration  (row by row against job 43779854)"
( cd figures && uv run --no-project python tools/check_envpool_config.py ) ; done_ $?
fi

if want llm_cost; then
step "Table 11, authorship cost  (offline: the committed counts, not a new API call)"
( cd figures && uv run --no-project python tools/check_llm_cost.py ) ; done_ $?
fi

printf '\n%s\n' "----"
if [ "$skipped" -gt 0 ]; then
  echo "$ok ok, $skipped skipped (need the run data: bash reproduction/fetch_data.sh), $fail failed. Outputs in reproduction/out/"
else
  echo "$ok ok, $fail failed. Outputs in reproduction/out/"
fi
echo "tab:llm-cost is checked offline against the committed counts; regenerating them"
echo "from scratch needs GEMINI_API_KEY (playtrain.gen.count_tokens)."
