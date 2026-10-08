#!/bin/bash
# Build the DMLab oracle image (one-off; slow under amd64 emulation).
#   bash reference/oracle/build.sh            # from the dmlab family dir
set -euo pipefail
cd "$(dirname "$0")"
docker build --platform linux/amd64 -t playtrain-dmlab-oracle:latest . "$@"
docker image inspect playtrain-dmlab-oracle:latest --format '{{.Id}}'
