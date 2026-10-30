#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
swiftc -parse-as-library nuphos-ios/Services/AuthSession.swift nuphos-ios/Models/NuphosUser.swift \
  tests/support/AuthSessionStubs.swift tests/AuthSessionTests.swift -o "$test_dir/auth-session"
"$test_dir/auth-session"
