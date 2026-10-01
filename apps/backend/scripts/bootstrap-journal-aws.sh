#!/usr/bin/env bash
# One-time AWS setup for the tamper-evident audit journal (ZEA-10029/10031).
#
# Creates (idempotent):
#   - S3 bucket   nuphos-audit-journal   with Object Lock (governance mode)
#     enabled AT CREATION (it cannot be enabled later), versioning implied,
#     default retention JOURNAL_RETENTION_DAYS, public access fully blocked,
#     and an explicit bucket-policy Deny on deletes/retention changes.
#   - KMS key     alias/nuphos-journal-signing   asymmetric ECC_NIST_P256
#     SIGN_VERIFY, for segment manifest signatures.
#   - Prints the IAM separation-of-duties policy JSON (v2 #3):
#       sealer   — PutObject + kms:Sign only (no delete, no retention edits,
#                  NO s3:BypassGovernanceRetention)
#       verifier — read-only Get/List + kms:Verify / kms:GetPublicKey
#     Attach them to dedicated principals; the KMS key admin must NOT be a
#     runtime principal.
#   - Prints the JOURNAL_* env block for the backend Secret, including a
#     freshly generated JOURNAL_HMAC_KEY.
#
# Usage:
#   bash apps/backend/scripts/bootstrap-journal-aws.sh
#
# Requires AWS CLI v2 with credentials able to create the bucket/key/policies.

set -euo pipefail

REGION="${JOURNAL_S3_REGION:-us-east-1}"
BUCKET="${JOURNAL_S3_BUCKET:-nuphos-audit-journal}"
KMS_ALIAS="alias/nuphos-journal-signing"
RETENTION_DAYS="${JOURNAL_RETENTION_DAYS:-400}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "Account: $ACCOUNT_ID  Region: $REGION  Bucket: $BUCKET"
echo

# --- S3 bucket with Object Lock -------------------------------------------
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Bucket already exists — skipping create."
  LOCK="$(aws s3api get-object-lock-configuration --bucket "$BUCKET" \
    --query 'ObjectLockConfiguration.ObjectLockEnabled' --output text 2>/dev/null || echo MISSING)"
  if [ "$LOCK" != "Enabled" ]; then
    echo "FATAL: existing bucket $BUCKET has no Object Lock. It cannot be added"
    echo "after creation — pick a new bucket name and rerun." >&2
    exit 1
  fi
else
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --object-lock-enabled-for-bucket >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" \
      --object-lock-enabled-for-bucket >/dev/null
  fi
  echo "Created bucket $BUCKET (Object Lock enabled)."
fi

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Default retention: governance mode to start (switch to COMPLIANCE only once
# the retention policy is signed off — compliance is irrevocable).
aws s3api put-object-lock-configuration --bucket "$BUCKET" \
  --object-lock-configuration "{
    \"ObjectLockEnabled\": \"Enabled\",
    \"Rule\": { \"DefaultRetention\": { \"Mode\": \"GOVERNANCE\", \"Days\": $RETENTION_DAYS } }
  }"
echo "Object Lock default retention: GOVERNANCE, $RETENTION_DAYS days."

# Belt and braces on top of Object Lock: deny deletes and retention edits for
# everyone at the bucket-policy layer. Break-glass = edit this policy with
# account admin, which is itself CloudTrail-visible.
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"DenyJournalErasure\",
    \"Effect\": \"Deny\",
    \"Principal\": \"*\",
    \"Action\": [
      \"s3:DeleteObject\",
      \"s3:DeleteObjectVersion\",
      \"s3:PutObjectRetention\",
      \"s3:PutObjectLegalHold\",
      \"s3:PutBucketObjectLockConfiguration\",
      \"s3:DeleteBucket\"
    ],
    \"Resource\": [
      \"arn:aws:s3:::$BUCKET\",
      \"arn:aws:s3:::$BUCKET/*\"
    ]
  }]
}"
echo "Bucket policy: deletes and retention edits denied for all principals."

# --- KMS signing key --------------------------------------------------------
if aws kms describe-key --key-id "$KMS_ALIAS" --region "$REGION" >/dev/null 2>&1; then
  KEY_ID="$(aws kms describe-key --key-id "$KMS_ALIAS" --region "$REGION" \
    --query 'KeyMetadata.KeyId' --output text)"
  echo "KMS key already exists: $KEY_ID"
else
  KEY_ID="$(aws kms create-key --region "$REGION" \
    --key-spec ECC_NIST_P256 --key-usage SIGN_VERIFY \
    --description 'Nuphos audit journal segment signing (ZEA-10029)' \
    --query 'KeyMetadata.KeyId' --output text)"
  aws kms create-alias --region "$REGION" --alias-name "$KMS_ALIAS" --target-key-id "$KEY_ID"
  echo "Created KMS signing key: $KEY_ID ($KMS_ALIAS)"
fi

echo
echo "Public key (record next to the journal docs; anyone can verify offline):"
aws kms get-public-key --key-id "$KEY_ID" --region "$REGION" \
  --query PublicKey --output text
echo

# --- IAM policies (printed; attach to dedicated principals) ----------------
cat <<EOF
==> SEALER policy (backend runtime writes segments; NOTHING else):
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": [
        "arn:aws:s3:::$BUCKET/segments/*",
        "arn:aws:s3:::$BUCKET/anchors/*"
      ] },
    { "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::$BUCKET", "arn:aws:s3:::$BUCKET/*"] },
    { "Effect": "Allow",
      "Action": ["kms:Sign"],
      "Resource": "arn:aws:kms:$REGION:$ACCOUNT_ID:key/$KEY_ID" }
  ]
}
NOTE: the sealer principal must NOT have s3:BypassGovernanceRetention,
s3:DeleteObject*, s3:PutObjectRetention, or kms admin permissions.

==> VERIFIER policy (journal-verify.ts / auditors; read-only):
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::$BUCKET", "arn:aws:s3:::$BUCKET/*"] },
    { "Effect": "Allow",
      "Action": ["kms:Verify", "kms:GetPublicKey"],
      "Resource": "arn:aws:kms:$REGION:$ACCOUNT_ID:key/$KEY_ID" }
  ]
}

==> Backend env block (add to the atlas-backend-env Secret):
JOURNAL_S3_BUCKET=$BUCKET
JOURNAL_S3_REGION=$REGION
JOURNAL_KMS_SIGNING_KEY_ID=$KEY_ID
JOURNAL_RETENTION_DAYS=$RETENTION_DAYS
JOURNAL_HMAC_KEY=$(openssl rand -base64 48 | tr -d '\n')
JOURNAL_HMAC_KEY_ID=env-$(date +%Y%m%d)
JOURNAL_HMAC_KEY_VERSION=1
# Plus JOURNAL_AWS_ACCESS_KEY_ID / JOURNAL_AWS_SECRET_ACCESS_KEY for the
# dedicated sealer principal created from the SEALER policy above.
EOF
