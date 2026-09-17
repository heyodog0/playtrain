#!/usr/bin/env bash
# Redraw every measured figure and table in the paper.
#
#   bash reproduction/reproduce.sh                  # everything that needs no download
#   bash reproduction/reproduce.sh --all            # also the learning curves (277 MB fetch)
#   bash reproduction/reproduce.sh env_efficiency   # one step by name
#   bash reproduction/reproduce.sh --list           # the step names
#
# Outputs land in reproduction/out/. Each step prints the number the paper
# reports beside the one it just computed. Provenance for every step -- code,
# data, cluster job -- is in reproduction/PROVENANCE.md.
set -uo pipefail
cd "$(dirname "$0")"
OUT="$PWD/out"; mkdir -p "$OUT"
PY="uv run --no-project --with matplotlib --with numpy --with pillow"
PYTB="$PY --with tensorboard"
ok=0; fail=0

STEPS="env_efficiency backend_ladder bench_setup env_cost t1a t1a_nodes t1b dbuf dbuf_check human_cohort human_wallclock human_crossings schematic eval learning suite_check suite_grids"
ALL=0; SEL=""
case "${1:-}" in
  --list) printf '%s\n' $STEPS; exit 0 ;;
  --all)  ALL=1 ;;
  "")     ;;
  -*)     echo "unknown option $1; try --list" >&2; exit 2 ;;
  *)      SEL="$1"
          case " $STEPS " in *" $SEL "*) ;; *) echo "no such step: $SEL (see --list)" >&2; exit 2 ;; esac ;;
esac
# Named steps run on their own; the two heavy ones also run under --all.
want() { if [ -n "$SEL" ]; then [ "$SEL" = "$1" ]; else [ "${2:-1}" -eq 1 ] || [ "$ALL" -eq 1 ]; fi; }

if [ "$ALL" -eq 1 ] && [ ! -f figures/outputs/percmd.json ]; then
  echo "fetching run data (277 MB, once)"; bash figures/fetch_data.sh || exit 1
fi
step() { printf '\n=== %s\n' "$1"; }
done_() { if [ "$1" -eq 0 ]; then ok=$((ok+1)); echo "    ok"; else fail=$((fail+1)); echo "    FAILED"; fi; }

if want env_efficiency; then
step "Figure 4, environment efficiency  (paper: per core 2.19x ProcGen 14/16, 12.62x ALE 8/8; 80 threads 2.58x / 20.80x)"
( cd figures && $PY python tools/plot_env_efficiency_bestonly.py --out "$OUT" ) ; done_ $?
fi

if want backend_ladder; then
step "Figure 4B, backend ladder  (paper: 13.4x V8 -> QuickJS, 117x browser -> QuickJS)"
( cd figures && uv run --no-project python tools/check_backend_ladder.py ) ; done_ $?
fi

if want bench_setup; then
step "Table 9, benchmark setup  (paper: 12.62x / 2.19x, 20.80x / 2.58x, 5.8x / 2.25x)"
( cd figures && $PY python tools/check_bench_setup.py ) ; done_ $?
fi

if want env_cost; then
step "Environment cost breakdown"
if [ -f figures/outputs/percmd.json ]; then
  ( cd figures && $PY python tools/plot_env_cost.py \
      outputs/percmd.json outputs/logic_probes.json outputs/grid.json "$OUT/fig_env_cost" )
  done_ $?
else
  echo "    skipped: run 'bash reproduction/figures/fetch_data.sh' first"
fi
fi

if want t1a; then
step "Table 1(a), training throughput  (paper: 1.07M / 0.35M / 185k / 68k)"
( cd figures/tables && uv run --no-project python t1a_agg.py \
    impala_nature=44748571+44784183 impala_icnn=44748573 \
    ppo_nature=44748574+44784184 ppo_impala=44748575+44784185 | head -14 ) ; done_ $?
fi

if want t1a_nodes; then
step "Table 1(a) node provenance  (impala_icnn: 0.34M all-24 vs the paper's 0.35M)"
( cd figures/tables && uv run --no-project python t1a_nodes.py ) ; done_ $?
fi

if want t1b; then
step "Table 1(b), environment swap  (paper: 372k -> 838k, 175k -> 1,018k)"
( cd figures/tables && uv run --no-project python tab1b.py ) ; done_ $?
fi

if want dbuf; then
step "Table 7, double-buffering ablation  (paper: miner 969k/465k/2.08x)"
( cd figures/tables && $PY python dbuf_tex2.py | head -6 ) ; done_ $?
fi

# Both human steps read the study JSONs unpacked; CURVES must be the IMPALA-CNN
# file, since the caption says both arms use that encoder. rerun_curves.json has
# its PPO arm on Nature -- check_curve_encoder.py enforces the difference.
CURVES=rerun_curves_icnn.json
unpack_study() {
  python3 -c "
import gzip, glob, os, shutil, sys
for f in glob.glob('data/study/*.json.gz'):
    with gzip.open(f, 'rb') as i, open(os.path.join(sys.argv[1], os.path.basename(f)[:-3]), 'wb') as o:
        shutil.copyfileobj(i, o)" "$1"
}

if want dbuf_check; then
step "Table 7 caption claims  (paper: 1.34x overall, median 1.20x, plunder 0.97x)"
( cd figures/tables && $PY python dbuf_check.py ) ; done_ $?
fi

if want human_cohort; then
step "Human study cohort  (paper: 20 participants, 8 games, 6 female / 14 male)"
TMPS=$(mktemp -d); unpack_study "$TMPS"
( cd figures/human && uv run --no-project python cohort.py "$TMPS" ) ; done_ $?
fi

if want human_wallclock; then
step "Human wall-clock figure  (paper: 20 participants, 8 games, 100 s each, 3 seeds, IMPALA-CNN both arms)"
TMPS=$(mktemp -d); unpack_study "$TMPS"
( cd figures/human && uv run --no-project python check_curve_encoder.py "$CURVES" \
    && $PY python plot_wallclock5.py "$CURVES" "$TMPS" "$OUT" ) ; done_ $?
fi

if want human_crossings; then
step "Steps to reach the human mean  (paper: flappy_bird PPO 1M, coinrun IMPALA 81M, six of eight games)"
TMPS=$(mktemp -d); unpack_study "$TMPS"
( cd figures/human && $PY python crossings.py "$CURVES" "$TMPS" ) ; done_ $?
fi

if want schematic; then
step "Architecture schematic"
( cd figures && $PY python fig_schematic.py "$OUT" ) ; done_ $?
fi

if want eval; then
step "Appendix eval table  (all 48 cells, parsed straight out of main.tex)"
( cd figures && uv run --no-project python tools/check_eval.py ) ; done_ $?
fi

if want learning 0; then
step "Learning-curve composite"
( cd figures && $PYTB python tools/plot_main_composite.py "$OUT/fig_main.png" ) ; done_ $?
fi

if want suite_check; then
step "Suite figure composition  (paper: all 24 games, 3 seeds, 100M steps, PPO from 0.5M)"
( cd figures && $PY python tools/check_suite.py --data outputs/_suite4_curves.json ) ; done_ $?
fi

if want suite_grids 0; then
step "Per-game suite grids, the three appendix figures"
# --arms picks which of the four arms each figure shows, and --name must match
# the file main.tex includes. Without them plot_suite_grid3.py emits the 4-arm
# fig_suite_grid, which no label in the paper uses.
( cd figures \
  && $PYTB python tools/plot_suite_grid3.py --data outputs/_suite4_curves.json \
       --arms trainers --name fig_suite_trainers  --out "$OUT" \
  && $PYTB python tools/plot_suite_grid3.py --data outputs/_suite4_curves.json \
       --arms impala   --name fig_suite_enc_impala --out "$OUT" \
  && $PYTB python tools/plot_suite_grid3.py --data outputs/_suite4_curves.json \
       --arms ppo      --name fig_suite_enc_ppo    --out "$OUT" ) ; done_ $?
fi

printf '\n%s\n' "----"
echo "$ok ok, $fail failed. Outputs in reproduction/out/"
echo "Not covered here: tab:llm-cost, which needs GEMINI_API_KEY (playtrain.gen.count_tokens)."
