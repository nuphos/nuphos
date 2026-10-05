#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
swiftc -emit-library -emit-module -module-name PostHog tests/support/PostHog.swift \
  -emit-module-path "$test_dir/PostHog.swiftmodule" -o "$test_dir/libPostHog.dylib"
for mode in release debug; do
  flags=(-Onone)
  if [[ "$mode" == debug ]]; then flags=(-D DEBUG); fi
  swiftc "${flags[@]}" -parse-as-library -I "$test_dir" -L "$test_dir" -lPostHog \
    -Xlinker -rpath -Xlinker "$test_dir" \
    nuphos-ios/Services/Analytics.swift nuphos-ios/Models/NuphosUser.swift tests/AnalyticsTests.swift \
    -o "$test_dir/analytics-$mode"
  "$test_dir/analytics-$mode"
done
