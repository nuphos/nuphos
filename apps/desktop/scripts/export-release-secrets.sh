#!/usr/bin/env bash
# Helper that prints all GitHub secret values for the Release workflow.
# Run this LOCALLY on the Mac that holds the Developer ID Application cert
# in its login keychain. Requires: gh (`brew install gh`).

set -euo pipefail

CERT_NAME="Developer ID Application: ZEABUR PTE. LTD. (6T873K59LQ)"
P12_PATH="$(mktemp -d)/cert.p12"
P12_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"

echo "==> Exporting cert to $P12_PATH"
echo "    (Keychain Access will prompt for your login password)"
security export -k ~/Library/Keychains/login.keychain-db \
  -t identities -f pkcs12 -P "$P12_PASS" -o "$P12_PATH" \
  "$CERT_NAME" >/dev/null

CERT_B64=$(base64 -i "$P12_PATH" | tr -d '\n')
KEY_B64=$(base64 -i ~/.appstore-connect-keys/AuthKey_66Q44L35XP.p8 | tr -d '\n')

cat <<EOF

==> Pipe through gh:

gh secret set MAC_CERTS --repo zeabur/nuphos --body "$CERT_B64"
gh secret set MAC_CERTS_PASSWORD --repo zeabur/nuphos --body "$P12_PASS"
gh secret set APPLE_API_KEY_BASE64 --repo zeabur/nuphos --body "$KEY_B64"
gh secret set APPLE_API_KEY_ID --repo zeabur/nuphos --body "66Q44L35XP"
gh secret set APPLE_API_ISSUER --repo zeabur/nuphos --body "acc0b783-e12f-41e3-b181-f79a462630d8"

# AWS — set with byos-connector creds:
# gh secret set AWS_ACCESS_KEY_ID --repo zeabur/nuphos --body "AKIA..."
# gh secret set AWS_SECRET_ACCESS_KEY --repo zeabur/nuphos --body "..."

EOF

rm -f "$P12_PATH"
