#!/bin/bash -l
#SBATCH -J e3_probe
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH --exclusive
#SBATCH -N 1
#SBATCH --mem=64G
#SBATCH -t 0-03:00
# E3 probe (PLAN-engine-tier-round6.md §5 E3, §4 protocol, untuned first):
# p5 intrinsics in the AOT emitter (aot-intrinsics.patch + qjsc -P + host
# wrappers). Untuned arms, same flags, same engine source:
#   futN_<g> = qjsc -A, engine with the patch, NO -P   (TAG=N)  <- the control
#   futI_<g> = qjsc -A -P aot_intr.txt                  (TAG=I)  <- the lever
# plus adv (adopted), fut (banked untuned AOT, old engine) and futT2 (banked
# tuned) for the record. Gate: host_f0N + host_f1I on all 33 paper games x 3
# seeds vs V8 (Bytecode-mismatch scan on), checksum24 futI vs ng. Proceed gate
# (§4): futI/futN >= +5% geomean on the 5 profiled games; E3 kill: < +3% on
# miner+maze. Writes only *N*/*I*-tagged artifacts + out/e3_<job>/.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
BASE=/n/holylabs/gershman_lab/Users/rtruong
WE=$BASE/playtrain-wt-engine; WT=$BASE/playtrain-wt-tuning; LIVE=$BASE/playtrain; TR=$BASE/playtrain-trainers
PY=$BASE/analogen-jaxbench/.venv/bin/python
export PATH="$HOME/.cargo/bin:/n/home06/truong/.local-node/bin:$PATH"
export PYTHONPATH="$TR/src:$WE/src" OMP_NUM_THREADS=1
echo "node=$(hostname) kernel=$(uname -r) job=${SLURM_JOB_ID:-none}"; lscpu | grep "Model name" | head -1
cd "$WE" || exit 1; git log --oneline -1
OUT=$WE/native/aotfork/out; GDIR=$LIVE/examples/games/js
PROCGEN="bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot"
ALE="asteroids breakout freeway frostbite pong qbert seaquest space_invaders"
FIVE="breakout plunder bigfish miner maze"
SEVEN="$FIVE coinrun heist"
JOB="${SLURM_JOB_ID:-x}"; OUTD="$OUT/e3_$JOB"; mkdir -p "$OUTD"
RA=$WE/crates/rasterizer/target/release/libplaytrain_rasterizer.a
NGSO=$WE/native/build/libqjs_vec.so
for f in "$RA" "$NGSO" "$OUT/libqjs_vec.adv.so" "$OUT/libqjs_vec.fork.so" "$OUT/fork24.profdata"; do [ -e "$f" ] || { echo "missing $f"; exit 1; }; done
for g in $FIVE; do [ -f "$OUT/libqjs_vec.fut_$g.so" ] && [ -f "$OUT/libqjs_vec.futT2_$g.so" ] || { echo "missing fut/futT2 $g"; exit 1; }; done
cd native/aotfork; export FORK_OUT=$OUT RA

echo "== 1. engine (patched: qjsc-hostmode + aot-intrinsics), TAG=N control and TAG=I lever, untuned =="
export TAG=N; rm -rf "$OUT/objN" "$OUT/picN"
bash build_fork.sh engine 2>&1 | grep -E "^fork:|^engine built|error"
( "$OUT/qjsc" -h 2>&1 || true ) | grep -q "^-P" || { echo "qjsc lacks -P"; exit 1; }
bash build_fork.sh f0 2>&1 | grep -E "^built|error"
bash build_fork.sh vec0 2>&1 | grep -E "^built|error"
for g in $SEVEN; do echo "$GDIR/$g.js"; done | xargs -P 7 -I{} bash -c 'bash build_fork.sh vec1 "$1" 2>&1 | grep -E "^built|error" || echo "BUILD_FAIL vec1 N $1"' _ {}
for g in $FIVE; do echo "$GDIR/$g.js"; done | xargs -P 5 -I{} bash -c 'bash build_fork.sh f1 "$1" 2>&1 | grep -E "^built|error" || echo "BUILD_FAIL f1 N $1"' _ {}
export TAG=I INTR=1; rm -rf "$OUT/objI" "$OUT/picI"
bash build_fork.sh engine 2>&1 | grep -E "^engine built|error"
echo "intrinsics: $(wc -l < "$OUT/aot_intr.txt") names"
bash build_fork.sh vec0 2>&1 | grep -E "^built|error"
for g in $PROCGEN $ALE; do echo "$GDIR/$g.js"; done | xargs -P 12 -I{} bash -c 'bash build_fork.sh vec1 "$1" 2>&1 | grep -E "^built|error" || echo "BUILD_FAIL vec1 I $1"' _ {}
for f in "$WE"/examples/games/js/*.js; do echo "$f"; done | xargs -P 12 -I{} bash -c 'bash build_fork.sh f1 "$1" 2>&1 | grep -E "^built|error" || echo "BUILD_FAIL f1 I $1"' _ {}
unset TAG INTR
echo "futI .so: $(ls "$OUT"/libqjs_vec.futI_*.so | wc -l) / 24; host_f1I: $(ls "$OUT"/host_f1I_* | wc -l) / 33"
echo "== intrinsic sites per game (emitted C) =="
for g in $PROCGEN $ALE; do printf "  %-14s %3d sites  (%s)\n" "$g" "$(grep -c '/\* intrinsic ' "$OUT/aotI_$g/game_aot.c")" "$(grep -o '/\* intrinsic [A-Za-z]*' "$OUT/aotI_$g/game_aot.c" | awk '{print $3}' | sort | uniq -c | awk '{printf "%s=%s ", $2, $1}')"; done

echo "== 2. gate: f0N + f1I, 33 paper games x 3 seeds x 3000 vs V8 (F1 stderr scanned for Bytecode mismatch) =="
GT=$OUT/gateI; rm -rf "$GT"; mkdir -p "$GT"; ln -sf "$OUT/host_f0N" "$GT/host_f0"
for f in "$WE"/examples/games/js/*.js; do g=$(basename "$f" .js); [ -x "$OUT/host_f1I_$g" ] && ln -sf "$OUT/host_f1I_$g" "$GT/host_f1_$g"; done
REFDIR=$OUT/gate_ref GAMES_DIR=$WE/examples/games/js bash gate_fork.sh "$GT" --all 3000 2>&1 | tee "$OUTD/gateI.txt" | grep -v "^  PASS"
echo "== 2b. vec obs checksum 2000 x 24: ng (reference) vs futN (7) vs futI (24) =="
QJS_DIRTY=1 WE=$WE GDIR=$GDIR "$PY" aot_obs_checksum.py 2000 "$(echo $PROCGEN $ALE | tr ' ' ',')" \
  ng="$NGSO" futI="$OUT/libqjs_vec.futI_{game}.so" 2>&1 | tee "$OUTD/checksumI.txt" | grep -E "MISMATCH|MISSING|CHECKSUM"
QJS_DIRTY=1 WE=$WE GDIR=$GDIR "$PY" aot_obs_checksum.py 2000 "$(echo $SEVEN | tr ' ' ',')" \
  ng="$NGSO" futN="$OUT/libqjs_vec.futN_{game}.so" 2>&1 | tee "$OUTD/checksumN.txt" | grep -E "MISMATCH|MISSING|CHECKSUM"

bench() {  # game arm libpath rep
  local g=$1 a=$2 lib=$3 r=$4
  echo "=== $g rep$r $a $(md5sum "$lib" | cut -c1-32)"
  QJS_DIRTY=1 "$PY" "$TR/benchmarks/bench_vec_knobs.py" --game "$g" --games-dir "$GDIR" \
    --lib-path "$lib" --mode sync --envs 128 --workers 1 --env-threads 5 \
    --steps 300 --warmup 20 --max-steps 2000 --frame-skip 1 \
    --out "$OUTD/${g}_${a}_r${r}.json" 2>&1 | grep -o '"env_steps_per_s": [0-9]*' || echo "RUN_FAIL $g $a r$r"
}
arms() { echo "adv=$OUT/libqjs_vec.adv.so fut=$OUT/libqjs_vec.fut_$1.so futT2=$OUT/libqjs_vec.futT2_$1.so futN=$OUT/libqjs_vec.futN_$1.so futI=$OUT/libqjs_vec.futI_$1.so"; }
echo "== 3. vec A/B: 7 games x 2 reps interleaved (adv fut futT2 futN futI) =="
for g in $SEVEN; do for r in 1 2; do for kv in $(arms $g); do bench "$g" "${kv%%=*}" "${kv#*=}" $r; done; done; done
echo "== 4. single-core: f1N vs f1I, 5 games x 5 reps x 50k, QJS_DIRTY=1 =="
RAW=$OUTD/sc_raw.txt; : > "$RAW"
for g in $FIVE; do for r in 1 2 3 4 5; do
  for kv in "f1N=$OUT/host_f1N_$g" "f1I=$OUT/host_f1I_$g" "f1T2=$OUT/host_f1T2_$g" "adv=$OUT/qjs_host.adv"; do
    n=${kv%%=*}; b=${kv#*=}
    sps=$(QJS_DIRTY=1 "$b" "$GDIR/$g.js" bench 1 50000 2>/dev/null | sed -n 's/.*= \([0-9.]*\) steps\/sec/\1/p')
    echo "$n $g $r $sps" | tee -a "$RAW"
  done
done; done
echo "== summary =="
"$PY" - "$OUTD" <<'EOF'
import json, sys, glob, os, collections, statistics, math
gm = lambda xs: math.exp(sum(map(math.log, xs)) / len(xs)) if xs else float("nan")
FIVE = "breakout plunder bigfish miner maze".split()
def table(d, arms, ratios, title):
    print("\n" + title)
    games = sorted({g for g, _ in d}, key=lambda g: (g not in FIVE, g))
    print("%-14s" % "game" + "".join("%9s" % a for a in arms) + "".join("%11s" % (n + "/" + dn) for n, dn in ratios))
    R = collections.defaultdict(list)
    for g in games:
        m = {a: statistics.median(d[(g, a)]) for a in arms if (g, a) in d}
        row = "%-14s" % g + "".join("%9.0f" % m.get(a, float("nan")) for a in arms)
        for n, dn in ratios:
            if n in m and dn in m:
                v = m[n] / m[dn]; R[(n, dn, g in FIVE)].append(v); row += "%11.3f" % v
            else: row += "%11s" % "-"
        print(row)
    for five in (True, False):
        vals = [gm(R[(n, dn, True)] + ([] if five else R[(n, dn, False)])) for n, dn in ratios]
        print("%-14s" % ("geomean-5" if five else "geomean-all") + " " * (9 * len(arms)) + "".join("%11.3f" % v for v in vals))
d = collections.defaultdict(list)
for f in glob.glob(sys.argv[1] + "/*.json"):
    g, a, r = os.path.basename(f)[:-5].rsplit("_", 2); d[(g, a)].append(json.load(open(f))["env_steps_per_s"])
table(d, ["adv", "fut", "futT2", "futN", "futI"], [("futI", "futN"), ("futN", "fut"), ("futI", "fut"), ("futI", "futT2"), ("futI", "adv")], "VEC (env steps/s, medians of 2)")
d2 = collections.defaultdict(list)
for line in open(sys.argv[1] + "/sc_raw.txt"):
    p = line.split()
    if len(p) == 4 and p[3]: d2[(p[1], p[0])].append(float(p[3]))
table(d2, ["adv", "f1T2", "f1N", "f1I"], [("f1I", "f1N"), ("f1I", "f1T2"), ("f1I", "adv")], "SINGLE-CORE (qjs_host bench steps/s, medians of 5)")
EOF
echo "E3_PROBE_DONE $(date)"
