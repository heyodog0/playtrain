#!/usr/bin/env bash
# bench_fork.sh — single-core, same-process-shape, INTERLEAVED A/B of host
# binaries on the `qjs_host bench` protocol (panel-C style). Arms are run
# A,B,C,A,B,C,... per game so clock drift hits every arm equally.
#
#   bench_fork.sh <out_dir> "<game> ..." [reps] [steps]
# Env: GAMES_DIR, EXTRA_HOSTS ("name=/path ..." — e.g. ng=/.../qjs_host.adv),
#      QJS_DIRTY (exported to every arm; the published protocol runs with it set).
# Output: per (arm, game, rep) steps/sec lines, then a table of per-game medians,
# ratios vs the first arm (f0), and the geomean across games.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$1"; GAMES="$2"; REPS="${3:-3}"; STEPS="${4:-20000}"
GAMES_DIR="${GAMES_DIR:-$HERE/../../examples/games/js}"
RAW="$OUT/bench_raw.txt"; : > "$RAW"
echo "host=$(hostname) kernel=$(uname -r) steps=$STEPS reps=$REPS QJS_DIRTY=${QJS_DIRTY:-unset}"
md5() { command -v md5sum >/dev/null && md5sum "$1" | cut -c1-32 || /sbin/md5 -q "$1"; }
arms() { echo "f0=$OUT/host_f0"; [ -x "$OUT/host_f1_$1" ] && echo "f1=$OUT/host_f1_$1"; for kv in ${EXTRA_HOSTS:-}; do echo "$kv"; done; }
for g in $GAMES; do for kv in $(arms "$g"); do echo "md5 ${kv%%=*} $g $(md5 "${kv#*=}")"; done; done
for g in $GAMES; do
  for r in $(seq 1 "$REPS"); do
    for kv in $(arms "$g"); do
      name="${kv%%=*}"; bin="${kv#*=}"
      sps=$("$bin" "$GAMES_DIR/$g.js" bench 1 "$STEPS" 2>/dev/null | sed -n 's/.*= \([0-9.]*\) steps\/sec/\1/p')
      echo "$name $g $r $sps" | tee -a "$RAW"
    done
  done
done
python3 - "$RAW" <<'EOF'
import sys, collections, statistics, math
d = collections.defaultdict(list); arms = []; games = []
for line in open(sys.argv[1]):
    a, g, r, v = line.split()
    d[(a, g)].append(float(v))
    if a not in arms: arms.append(a)
    if g not in games: games.append(g)
base = arms[0]
print("\n%-12s" % "game" + "".join("%14s" % a for a in arms) + "".join("%10s" % (a + "/" + base) for a in arms[1:]))
ratios = {a: [] for a in arms[1:]}
for g in games:
    med = {a: statistics.median(d[(a, g)]) for a in arms if (a, g) in d}
    row = "%-12s" % g + "".join("%14.0f" % med.get(a, float("nan")) for a in arms)
    for a in arms[1:]:
        if a in med and base in med:
            r = med[a] / med[base]; ratios[a].append(r); row += "%10.3f" % r
        else: row += "%10s" % "-"
    print(row)
gm = lambda xs: math.exp(sum(map(math.log, xs)) / len(xs)) if xs else float("nan")
print("%-12s" % "geomean" + " " * (14 * len(arms)) + "".join("%10.3f" % gm(ratios[a]) for a in arms[1:]))
EOF
