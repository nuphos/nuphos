#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
swiftc -D SHARE_SESSION_INTEGRATION_TESTS -module-cache-path "$test_dir/cache" \
  nuphos-ios/Services/Chat/JSONValue.swift ShareSupport/SharedShareSession.swift \
  tests/ShareSessionKeychainIntegrationTests.swift -o "$test_dir/keychain-tests"
"$test_dir/keychain-tests" "ai.nuphos.ios.share-session.integration.$(uuidgen)"
swiftc -D SHARE_SESSION_INTEGRATION_TESTS -module-cache-path "$test_dir/cache" \
  nuphos-ios/Services/Chat/JSONValue.swift ShareSupport/SharedShareSession.swift ShareSupport/SubmissionAdmission.swift \
  tests/SubmissionAdmissionIntegrationTests.swift -o "$test_dir/admission-tests"
"$test_dir/admission-tests" "ai.nuphos.ios.share-session.integration.$(uuidgen)"
