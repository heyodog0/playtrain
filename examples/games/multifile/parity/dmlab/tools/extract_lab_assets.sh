#!/bin/bash
# Copy the parts of DMLab's //assets (CC BY 4.0) that tools/dmlab_assets.py
# reads out of the oracle image, plus lab's LICENSE, into <dir>.
#   bash tools/extract_lab_assets.sh <dir>
set -euo pipefail
out="$(mkdir -p "$1" && cd "$1" && pwd)"
docker run --rm --platform linux/amd64 -v "$out:/x" playtrain-dmlab-oracle:latest bash -c '
  set -e; cd /lab/assets
  mkdir -p /x/textures/map /x/textures/decal /x/textures/model /x/models
  cp -r scripts /x/
  cp -r textures/map/lab_games /x/textures/map/
  cp textures/map/*.tga /x/textures/map/
  mkdir -p /x/maps/src && cp maps/src/*.map /x/maps/src/
  cp -r textures/decal/lab_games /x/textures/decal/
  cp textures/model/*.tga /x/textures/model/
  cp models/goal_object_0*.md3 models/apple.md3 models/lemon.md3 models/strawberry.md3 models/hr_*.md3 models/fut_obj_*.md3 models/fut_ldm_img_frame_*.md3 /x/models/
  cp /lab/LICENSE /x/LICENSE
  cd /lab && git rev-parse HEAD > /x/LAB_COMMIT'
echo "extracted to $out"
