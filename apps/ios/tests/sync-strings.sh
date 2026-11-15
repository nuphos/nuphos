#!/bin/bash
# Brings Localizable.xcstrings in line with the strings a build found in the
# source: new ones are added, ones no longer used are removed.
#   bash tests/sync-strings.sh <DerivedData>
set -euo pipefail
cd "$(dirname "$0")/.."
find "${1:?usage: sync-strings.sh <DerivedData>}" -path '*/nuphos-ios.build/*' -name '*.stringsdata' \
  -exec printf -- '--stringsdata\0%s\0' {} + |
  xargs -0 xcrun xcstringstool sync nuphos-ios/Localizable.xcstrings
