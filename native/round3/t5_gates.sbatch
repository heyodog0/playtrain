#!/bin/bash -l
#SBATCH -J t5_gates
#SBATCH -o logs/%x_%j.out
#SBATCH -e logs/%x_%j.err
#SBATCH -p serial_requeue
#SBATCH -C genoa
#SBATCH -N 1
#SBATCH -c 8
#SBATCH --mem=16G
#SBATCH -t 0-05:00
# Round-3 determinism gates: rv2r (emit-relocs null), rv2bolt (lever 1),
# cb (lever 2, PLAYTRAIN_QJS_CMDBUF=1). No pipes on gate output; preflight
# asserts a non-empty trace on this node first. Expected baseline = rv2's
# gate output: qbert fails all 3 seeds on the terminal frame, all else clean.
set -uo pipefail
cd "${SLURM_SUBMIT_DIR:-.}"; mkdir -p logs
WT=/n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-tuning
export PATH="$HOME/.local-node/bin:$PATH"
echo "node=$(hostname)"; uname -r; command -v node
cd "$WT/native"
GV="${GATE_VARIANTS:-rv2r rv2bolt cb}"
PF=$(echo $GV | cut -d" " -f1)
cp "build/variants/qjs_host.$PF" build/qjs_host
./build/qjs_host ../examples/games/js/breakout.js trace 1 50 > /tmp/pf.txt 2>/tmp/pf.err || true
if [ ! -s /tmp/pf.txt ]; then echo "PREFLIGHT_EMPTY on $(hostname):"; cat /tmp/pf.err; exit 1; fi
echo "preflight ok ($(wc -l < /tmp/pf.txt) lines)"
OUT="$WT/gates_r3"; mkdir -p "$OUT"
for V in $GV; do
  cp "build/variants/qjs_host.$V" build/qjs_host
  if [ "$V" = cb ]; then export PLAYTRAIN_QJS_CMDBUF=1; else unset PLAYTRAIN_QJS_CMDBUF; fi
  case "$V" in dv*) export QJS_DIRTY=1;; *) unset QJS_DIRTY;; esac
  echo; echo "######## gate $V ($(md5sum build/qjs_host | cut -d" " -f1)) cmdbuf=${PLAYTRAIN_QJS_CMDBUF:-0}"
  if ./gate_qjs.sh --all 3000 > "$OUT/gate_$V.log" 2>&1; then
    echo "GATE_CLEAN $V"
  else
    echo "GATE_RC1 $V fails=$(grep -c FAIL "$OUT/gate_$V.log")"
    grep "FAIL" "$OUT/gate_$V.log" | head -8
  fi
done
unset PLAYTRAIN_QJS_CMDBUF
echo T5_GATES_DONE
