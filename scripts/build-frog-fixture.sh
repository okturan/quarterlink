#!/bin/sh
set -eu

SOURCE_URL=https://frogfeast.rastersoft.net/Files/CPS1Frog.zip
SOURCE_SHA=53706e7d86ae4f998981bfbc0f3f0058df014a820895bd7a9b09c65c7f87f14f
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

curl -fsSL "$SOURCE_URL" -o "$WORK/source.zip"
printf '%s  %s\n' "$SOURCE_SHA" "$WORK/source.zip" | shasum -a 256 -c -
unzip -q "$WORK/source.zip" -d "$WORK"
mkdir "$WORK/rom"
unzip -q "$WORK/ffight.zip" -d "$WORK/rom"
for file in "$WORK"/rom/ff*.bin; do
  base=$(basename "$file")
  mv "$file" "$WORK/rom/frog${base#ff}"
done
(cd "$WORK/rom" && zip -q -X "$ROOT/public/demo/cps1frog.zip" ./*.bin)
shasum -a 256 "$ROOT/public/demo/cps1frog.zip"
