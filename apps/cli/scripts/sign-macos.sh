#!/bin/bash
# Run on a disposable macOS release runner, before archiving the binary.
set -euo pipefail

BINARY=${1:?Usage: sign-macos.sh path/to/nuphos}
: "${RUNNER_TEMP:?}"
: "${MAC_CERTS:?}"
: "${MAC_CERTS_PASSWORD:?}"
: "${APPLE_API_KEY_BASE64:?}"
: "${APPLE_API_KEY_ID:?}"
: "${APPLE_API_ISSUER:?}"
: "${APPLE_TEAM_ID:?}"
[[ "$APPLE_TEAM_ID" == '6T873K59LQ' ]] || { echo 'Unexpected signing team' >&2; exit 1; }

SIGNING_DIR=$(mktemp -d "$RUNNER_TEMP/cli-signing.XXXXXX")
KEYCHAIN="$SIGNING_DIR/signing.keychain-db"
KEYCHAIN_PASSWORD=$(openssl rand -hex 32)
# Preserve the runner's existing intermediate certificates and search list.
ORIGINAL_KEYCHAINS=()
while IFS= read -r entry; do
  entry=${entry#*\"}
  entry=${entry%\"*}
  ORIGINAL_KEYCHAINS+=("$entry")
done < <(security list-keychains -d user)
cleanup() {
  security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" || true
  security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  rm -rf "$SIGNING_DIR"
}
trap cleanup EXIT
umask 077
printf '%s' "$MAC_CERTS" | base64 --decode > "$SIGNING_DIR/certificate.p12"
printf '%s' "$APPLE_API_KEY_BASE64" | base64 --decode > "$SIGNING_DIR/AuthKey.p8"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security list-keychains -d user -s "$KEYCHAIN" "${ORIGINAL_KEYCHAINS[@]}"
security import "$SIGNING_DIR/certificate.p12" -k "$KEYCHAIN" -P "$MAC_CERTS_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
IDENTITY=$(security find-identity -v -p codesigning "$KEYCHAIN" \
  | sed -n '/"Developer ID Application: .* (6T873K59LQ)"/s/.*\([A-F0-9]\{40\}\).*/\1/p')
[[ "$IDENTITY" =~ ^[A-F0-9]{40}$ ]] || { echo 'Expected exactly one Developer ID Application identity' >&2; exit 1; }

# A stable identifier and Apple's default Developer ID requirement let Keychain
# trust subsequent versions, rather than pinning an ad-hoc binary's cdhash.
codesign --force --sign "$IDENTITY" --keychain "$KEYCHAIN" \
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
