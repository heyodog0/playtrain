#!/bin/bash -l
#SBATCH -J tier3_pg_ab
#SBATCH -p kempner_h100
#SBATCH -A kempner_gershman_lab
#SBATCH --exclude=holygpu8a13401,holygpu8a13402,holygpu8a13403,holygpu8a13404,holygpu8a17601
#SBATCH -N 1
#SBATCH -c 92
#SBATCH --gres=gpu:4
#SBATCH --mem=300G
#SBATCH -t 0-08:00
#SBATCH -o /n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench/logs/tier3_pg_ab_%j.out
#SBATCH -e /n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench/logs/tier3_pg_ab_%j.err
#
# Table 1(b) ProcGen swap row under the ENGINE TIER 3.
# Derived from playtrain-trainers/benchmarks/baselines/as_run/run_procgen_ab_adv16.sh
# (the adv re-measure of the published 618k/372k row) with two changes:
#   1. a THIRD arm per game, tier3 = $OUT/libqjs_vec.futIT2_<game>.so, so the
#      row exists under the compile-at-load production binary. adv2 stays in
#      the same job as the reference arm, and the ProcGen C++ arm is unchanged.
#   2. all 16 games in ONE job (the adv version was split 8+8) and NOT
#      node-pinned (Ryan 2026-09-05: no --nodelist, no -w). The original had
#      no --nodelist either; the pin was applied at submit time.
# Per-game binary selection: the job-private shadow tree's libqjs_vec.so is
# re-copied and md5-gated before every PlayTrain arm.
set -uo pipefail
BASE=/n/holylabs/gershman_lab/Users/rtruong
cd "$BASE/playtrain-trainers" || exit 2
export PATH="$HOME/.local/bin:$PATH"
module load cuda/12.4.1-fasrc01 2>/dev/null || module load cuda 2>/dev/null || true
VENV="$BASE/analogen-jaxbench/.venv"
PY="$VENV/bin/python"
[ -x "$PY" ] || { echo "ERROR: no venv at $VENV" >&2; exit 2; }
export LD_LIBRARY_PATH="$VENV/lib/python3.13/site-packages/PyQt5/Qt5/lib:${LD_LIBRARY_PATH:-}"
WT=$BASE/playtrain-wt-tuning
WE=$BASE/playtrain-wt-engine
OUT=$WE/native/aotfork/out
ADV2="$WT/native/build/variants/libqjs_vec.adv.so"
ADV2_MD5_WANT=1c5149364c32fb58ce9b81cda49fa763
J="${SLURM_JOB_ID:-local}"
mkdir -p logs
echo "=== NODE $(hostname)  job=$J cores=$(nproc)"; uname -r
[ -f "$ADV2" ] || { echo "FATAL missing $ADV2"; exit 2; }
got=$(md5sum "$ADV2" | awk '{print $1}')
[ "$got" = "$ADV2_MD5_WANT" ] || { echo "FATAL adv2 md5 $got != $ADV2_MD5_WANT"; exit 2; }
echo "adv2 md5 OK $got"
: "${GAMES:=bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot}"
for g in $GAMES; do
  [ -f "$OUT/libqjs_vec.futIT2_$g.so" ] || { echo "FATAL missing tier3 .so for $g"; exit 2; }
done

export ADVTREE="${TMPDIR:-/tmp}/pttree_${J}"
rm -rf "$ADVTREE"; mkdir -p "$ADVTREE/native/build"
cp -a "$WT/src" "$ADVTREE/src"     # REAL copy: native_vec_env resolves symlinks
cp -a "$WT/runtime" "$ADVTREE/runtime"
cp "$WT/pyproject.toml" "$ADVTREE/pyproject.toml"
cp "$ADV2" "$ADVTREE/native/build/libqjs_vec.so"
export QJS_DIRTY=1
export PLAYTRAIN_AOT=off
export ADV_MD5="$ADV2_MD5_WANT"
export PYTHONPATH="$(pwd)/src:$ADVTREE/src"
export CUDA_MPS_PIPE_DIRECTORY="${TMPDIR:-/tmp}/mps_${J}"
export CUDA_MPS_LOG_DIRECTORY="$CUDA_MPS_PIPE_DIRECTORY/log"
mkdir -p "$CUDA_MPS_LOG_DIRECTORY"
nvidia-cuda-mps-control -d && echo MPS-up || echo WARN-no-MPS
trap "echo quit | nvidia-cuda-mps-control 2>/dev/null || true" EXIT

echo "=== shadow-tree provenance gate ==="
"$PY" - <<'PYEOF' || { echo "PROVENANCE CHECK FAILED — aborting" >&2; exit 2; }
import hashlib, os
import playtrain
from playtrain.runtime import native_vec_env as nve
p = str(nve._LIB_PATH); md5 = hashlib.md5(open(p, "rb").read()).hexdigest()
print("playtrain:", playtrain.__file__, "\n_LIB_PATH:", p, md5)
assert p.startswith(os.environ["ADVTREE"]), "shadow tree not selected"
assert md5 == os.environ["ADV_MD5"], "loaded .so is not adv2"
assert os.environ.get("QJS_DIRTY"), "QJS_DIRTY not set"
print("SHADOW PROVENANCE OK")
PYEOF

echo "=== preflight: envpool ProcGen envs ==="
GAMES="$GAMES" "$PY" - <<'PYEOF' || { echo "PREFLIGHT FAILED" >&2; exit 3; }
import os, envpool, numpy as np
for g in os.environ['GAMES'].split():
    eid = f"{g.capitalize()}Easy-v0"
    e = envpool.make_gymnasium(eid, num_envs=2)
    obs, _ = e.reset(); a = np.asarray(obs)
    ok = a.shape[1:] in ((3, 64, 64), (64, 64, 3))
    print(f"  {eid:20} obs={a.shape} {'OK' if ok else '** BAD **'}")
    assert ok
PYEOF

SO="$ADVTREE/native/build/libqjs_vec.so"
select_so () {  # arm game
  local src want got
  case "$1" in
    adv2)  src="$ADV2" ;;
    tier3) src="$OUT/libqjs_vec.futIT2_$2.so" ;;
    *) echo "FATAL unknown arm $1"; exit 2 ;;
  esac
  want=$(md5sum "$src" | awk '{print $1}'); cp "$src" "$SO"
  got=$(md5sum "$SO" | awk '{print $1}')
  [ "$got" = "$want" ] || { echo "FATAL md5 gate $2 $1: $got != $want"; exit 2; }
  echo "--- arm=$1 game=$2 so_md5=$got"
}

echo "=== derived configs (as-run pgab pairs, log_dir only change) ==="
CFGD="outputs/cfg_pgt3_${J}"; mkdir -p "$CFGD"
for g in $GAMES; do
  for arm in playtrain envpool; do
    for tag in adv2 tier3; do
      [ "$arm" = envpool ] && [ "$tag" = tier3 ] && continue
      "$PY" - "configs/pt_throughput/pt_pgab_${g}_${arm}.json" \
              "$CFGD/${g}_${arm}_${tag}.json" "outputs/pgt3_${g}_${arm}_${tag}" <<'PYEOF'
import json, sys
src, dst, logdir = sys.argv[1], sys.argv[2], sys.argv[3]
c = json.load(open(src)); c["log_dir"] = logdir
json.dump(c, open(dst, "w"), indent=2)
PYEOF
    done
  done
done
echo "configs written to $CFGD"

: "${PT_TIMEOUT:=6m}"
: "${PG_TIMEOUT:=11m}"
verify_arm () {  # tag logfile log_dir
  "$PY" - "$1" "$2" "$3" <<'PYEOF'
import re, sys, glob, os
tag, logf, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
txt = open(logf, errors='replace').read()
died = [l for l in txt.splitlines() if 'died' in l or 'aborting' in l.lower()]
sps = [float(m) for m in re.findall(r'sps=([0-9.]+)', txt)]
tb = [os.path.getsize(p) for p in glob.glob(os.path.join(outdir, 'tb', 'events.out*'))]
steady = sps[1:] or sps
verdict = 'PASS'
if died:                        verdict = 'FAIL(aborted)'
elif len(sps) < 3:              verdict = f'FAIL(only {len(sps)} windows)'
elif max(tb, default=0) < 1000: verdict = f'FAIL(empty TB {max(tb, default=0)}B)'
med = sorted(steady)[len(steady)//2] if steady else 0.0
print(f"ARM {tag}: {verdict}  windows={len(sps)}  median_sps={med:,.0f}")
for l in died[:2]: print("   !", l.strip()[:150])
print(f"MEDIAN_SPS {tag} {med:.1f} {verdict}")
PYEOF
}
STATUS=0
run_arm () {  # tag config log_dir timeout
  local tag="$1" cfg="$2" out="$3" tmo="$4" lg="logs/pgt3_${1}_${J}.log"
  echo "########## ARM $tag  ($cfg)  cap=$tmo"
  timeout -k 30s "$tmo" "$PY" -m playtrain_trainers.train_impala --config "$cfg" > "$lg" 2>&1
  [ $? -eq 124 ] && echo "  (capped at $tmo — expected; median still valid)"
  verify_arm "$tag" "$lg" "$out" | tee "logs/pgt3_${tag}_${J}.verdict"
  grep -q PASS "logs/pgt3_${tag}_${J}.verdict" || STATUS=1
  echo
}

for g in $GAMES; do
  select_so adv2  "$g"; run_arm "${g}_pt_adv2"  "$CFGD/${g}_playtrain_adv2.json"  "outputs/pgt3_${g}_playtrain_adv2"  "$PT_TIMEOUT"
  select_so tier3 "$g"; run_arm "${g}_pt_tier3" "$CFGD/${g}_playtrain_tier3.json" "outputs/pgt3_${g}_playtrain_tier3" "$PT_TIMEOUT"
                        run_arm "${g}_envpool"  "$CFGD/${g}_envpool_adv2.json"    "outputs/pgt3_${g}_envpool_adv2"    "$PG_TIMEOUT"
done

echo "=== matched ProcGen ratios (adv2 and tier3 vs real ProcGen, same node) ==="
J="$J" "$PY" - <<'PYEOF'
import glob, os, re, math, json
vals = {}
for f in glob.glob(f"logs/pgt3_*_{os.environ['J']}.verdict"):
    for line in open(f):
        m = re.match(r'MEDIAN_SPS (\S+) ([0-9.]+) (\S+)', line)
        if m: vals[m.group(1)] = (float(m.group(2)), m.group(3))
games = sorted({k.rsplit('_pt_', 1)[0] for k in vals if '_pt_' in k})
rows, ra, rt, rr = [], [], [], []
for g in games:
    a, t, b = vals.get(f'{g}_pt_adv2'), vals.get(f'{g}_pt_tier3'), vals.get(f'{g}_envpool')
    if a and t and b and all('PASS' in x[1] for x in (a, t, b)) and b[0] > 0:
        ra.append(a[0]/b[0]); rt.append(t[0]/b[0]); rr.append(t[0]/a[0])
        rows.append(dict(game=g, adv2=a[0], tier3=t[0], procgen=b[0],
                         ratio_adv2=a[0]/b[0], ratio_tier3=t[0]/b[0]))
        print(f"  {g:12} adv2 {a[0]:>10,.0f}  tier3 {t[0]:>10,.0f}  ProcGen {b[0]:>10,.0f}"
              f"   adv2/pg {a[0]/b[0]:5.2f}x  tier3/pg {t[0]/b[0]:5.2f}x  t3/adv2 {t[0]/a[0]:5.3f}")
    else:
        print(f"  {g:12} NO VALID TRIPLE  adv2={a} tier3={t} pg={b}")
geo = lambda xs: math.exp(sum(map(math.log, xs))/len(xs))
if rr:
    print(f"\n  n={len(rr)}  GEOMEAN adv2/ProcGen {geo(ra):.2f}x   tier3/ProcGen {geo(rt):.2f}x   tier3/adv2 {geo(rr):.3f}")
    print(f"  PlayTrain faster on: adv2 {sum(r>1 for r in ra)}/{len(ra)}, tier3 {sum(r>1 for r in rt)}/{len(rt)}")
    print("  (published 16-game row, live binary: 618k / 372k = 1.66x; adv1 re-measure: 701,992 / 372,539 = 1.88x)")
    json.dump(dict(rows=rows, geo_adv2=geo(ra), geo_tier3=geo(rt), geo_t3_over_adv2=geo(rr), n=len(rr)),
              open(f"logs/pgt3_summary_{os.environ['J']}.json", 'w'), indent=2)
PYEOF
rm -rf "$ADVTREE"
echo "=== exit=$STATUS ==="
exit "$STATUS"
