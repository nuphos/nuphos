#!/bin/bash
# Run on a disposable macOS release runner, before archiving the binary.
set -euo pipefail

BINARY=${1:?Usage: sign-macos.sh path/to/nuphos}
: "${RUNNER_TEMP:?}"

: "${SIGNING_IDENTITIES:?}"
: "${APPLE_API_KEY_BASE64:?}"
: "${APPLE_API_KEY_ID:?}"
: "${APPLE_API_ISSUER:?}"
IDENTITY=$(jq -er '
  [.[] | select(.name | startswith("Developer ID Application:") and endswith("(6T873K59LQ)"))]
  | if length == 1 then .[0].hash else error("Expected one Nuphos Developer ID identity") end
' <<< "$SIGNING_IDENTITIES")

# The import-codesign-certs action owns the temporary signing keychain.
SIGNING_DIR=$(mktemp -d "$RUNNER_TEMP/cli-notary.XXXXXX")
trap 'rm -rf "$SIGNING_DIR"' EXIT
umask 077
printf '%s' "$APPLE_API_KEY_BASE64" | base64 --decode > "$SIGNING_DIR/AuthKey.p8"

# A stable identifier and Apple's default Developer ID requirement let Keychain
# trust subsequent versions, rather than pinning an ad-hoc binary's cdhash.
codesign --force --sign "$IDENTITY" \
  --identifier ai.nuphos.cli --options runtime --timestamp "$BINARY"
REQUIREMENT='identifier "ai.nuphos.cli" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "6T873K59LQ"'
codesign --verify --strict --verbose=2 -R "$REQUIREMENT" "$BINARY"
codesign --display --requirements - "$BINARY"

# notarytool accepts ZIP, not tar.gz. Raw Mach-O binaries cannot be stapled;
# the notarization ticket is available online using the signed binary's hash.
ditto -c -k "$BINARY" "$SIGNING_DIR/nuphos.zip"
xcrun notarytool submit "$SIGNING_DIR/nuphos.zip" \
  --key "$SIGNING_DIR/AuthKey.p8" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" \
  --wait --timeout 20m --output-format json > "$SIGNING_DIR/notarization.json"
cat "$SIGNING_DIR/notarization.json"
plutil -extract status raw -o - "$SIGNING_DIR/notarization.json" | grep -qx Accepted
