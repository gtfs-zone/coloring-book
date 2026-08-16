#!/usr/bin/env bash
# Zip each fixture directory into fixtures/flex/dist/<name>.zip, ready to drop
# into the app's Load dialog (it only accepts .zip).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/dist"
mkdir -p "$out"

for dir in "$here"/*/; do
  name="$(basename "$dir")"
  [ "$name" = "dist" ] && continue
  rm -f "$out/$name.zip"
  (cd "$dir" && zip -q -r "$out/$name.zip" . -x '.*')
  echo "built $out/$name.zip"
done
