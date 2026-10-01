import { tmpdir } from 'node:os'

import { boundedInt, optional } from './env'

// The three S3-backed stores: short-lived file transfers, the skill overlay
// cache, and the sealed audit journal.
export function storageConfig() {
  return {
    // Temporary file-transfer store. Short-lived S3 objects ferry files between
    // the user and agent workflows; the store is fully decoupled from the agent
    // sandbox lifecycle (no transfer op extends a sandbox lease). `provider` is
    // the StorageProvider key — 's3' is the Zeabur-owned default; future
    // team-level BYOS S3 plugs in behind the same interface.
    fileTransfer: {
      provider: optional('NUPHOS_FILE_TRANSFER_PROVIDER') ?? 's3',
      s3: {
        bucket: optional('NUPHOS_FILE_TRANSFER_S3_BUCKET'),
        region: optional('NUPHOS_FILE_TRANSFER_S3_REGION') ?? 'us-east-1',
        // Dedicated credentials scoped to the transfer bucket only — NOT the
        // BYOS connector (that assumes customer roles for customer buckets).
        accessKeyId: optional('NUPHOS_FILE_TRANSFER_S3_ACCESS_KEY_ID'),
        secretAccessKey: optional('NUPHOS_FILE_TRANSFER_S3_SECRET_ACCESS_KEY'),
        // Unset ⇒ real AWS S3. Set ⇒ any S3-compatible server (self-hosted
        // RustFS/MinIO, R2, …); see `lib/storage/s3-client.ts`.
        endpoint: optional('NUPHOS_FILE_TRANSFER_S3_ENDPOINT'),
      },
      // Lifetime of a transfer record + its S3 object. The S3 bucket lifecycle
      // rule should mirror this as a backstop.
      ttlSeconds: 86_400,
      // Presigned PUT/GET URL validity — short, requested just-in-time right
      // before each transfer.
      presignExpirySeconds: 900,
      maxBytes: 100 * 1024 * 1024,
      maxTotalBytes: 500 * 1024 * 1024,
      maxFiles: 20,
    },
    // Team/global skill overlays synced from S3 into a local cache. Builtin
    // provider skills stay in the repo; this bucket holds editable scopes such as
    // `global` and `teams/<teamId>`.
    skillsStore: {
      s3: {
        bucket: optional('ATLAS_SKILLS_BUCKET'),
        region: optional('ATLAS_SKILLS_S3_REGION') ?? 'us-east-1',
        accessKeyId: optional('ATLAS_SKILLS_S3_ACCESS_KEY_ID'),
        secretAccessKey: optional('ATLAS_SKILLS_S3_SECRET_ACCESS_KEY'),
        endpoint: optional('ATLAS_SKILLS_S3_ENDPOINT'),
      },
      cacheDir: optional('ATLAS_SKILLS_CACHE_DIR') ?? `${tmpdir()}/nuphos-skills-cache`,
    },
    journal: {
      // HMAC key fingerprinting redacted-away originals in the audit journal.
      // P1 takes it from env; P2 moves custody to KMS. Without a key events
      // carry no fingerprint (redaction itself still applies).
      hmacKey: optional('JOURNAL_HMAC_KEY'),
      hmacKeyId: process.env.JOURNAL_HMAC_KEY_ID ?? 'env-local',
      hmacKeyVersion: process.env.JOURNAL_HMAC_KEY_VERSION ?? '1',
      // Sealed WORM layer. Bucket unset ⇒ L1-only deployment (hot-chain
      // integrity, no sealed segments); this is a deployment tier, not a
      // runtime switch. Dedicated sealer credentials keep the write path on
      // the least-privilege IAM role (fallback: default provider chain).
      s3Bucket: optional('JOURNAL_S3_BUCKET'),
      s3Region: process.env.JOURNAL_S3_REGION ?? 'us-east-1',
      awsAccessKeyId: optional('JOURNAL_AWS_ACCESS_KEY_ID'),
      awsSecretAccessKey: optional('JOURNAL_AWS_SECRET_ACCESS_KEY'),
      s3Endpoint: optional('JOURNAL_S3_ENDPOINT'),
      kmsSigningKeyId: optional('JOURNAL_KMS_SIGNING_KEY_ID'),
      retentionDays: boundedInt('JOURNAL_RETENTION_DAYS', 400, { min: 1, max: 3650 }),
      sealMaxEvents: 1000,
      sealCron: '*/5 * * * *',
      inventoryCron: '30 2 * * *',
      // External anchoring (T3). TSA on by default (public, free, no auth);
      // the public git anchor activates once the repo/token are provisioned.
      anchorCron: '0 3 * * *',
      tsaUrl: process.env.JOURNAL_TSA_URL ?? 'https://freetsa.org/tsr',
      anchorGithubRepo: optional('JOURNAL_ANCHOR_GITHUB_REPO'),
      anchorGithubToken: optional('JOURNAL_ANCHOR_GITHUB_TOKEN'),
      anchorGithubPath: process.env.JOURNAL_ANCHOR_GITHUB_PATH ?? 'anchors.log',
    },
  }
}
