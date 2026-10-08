#!/bin/bash
# Run a script inside the oracle image with this directory at /oracle and the
# dumps directory at /out. The wrapper level is copied into DMLab's levels.
#   bash reference/oracle/run.sh dump_level.py explore_goal_locations_small --seeds 0-31
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dumps="$(cd "$here/.." && pwd)/dumps"
mkdir -p "$dumps"
script="$1"; shift
docker run --rm --platform linux/amd64 -v "$here:/oracle:ro" -v "$dumps:/out" \
  playtrain-dmlab-oracle:latest bash -c '
    set -e
    L="$(python3 -c "import deepmind_lab,os;print(os.path.dirname(deepmind_lab.__file__))")/baselab/game_scripts/levels/playtrain"
    mkdir -p "$L" && cp /oracle/levels/*.lua "$L/"
    cd /oracle && exec python3 "/oracle/$0" "$@"' "$script" "$@"
