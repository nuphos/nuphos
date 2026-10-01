// One S3 client factory for the three Zeabur-owned stores: the file-transfer
// store, the skill overlay cache, and the sealed audit journal. They all talk
// to real AWS S3 in the hosted deployment and to an S3-compatible server
// (RustFS, MinIO, R2, …) in a self-hosted one, so the two settings that make
// the latter work — `endpoint` and path-style addressing — live here instead of
// being re-derived at each call site.
//
// BYOS clients do NOT belong here: those address the *customer's* provider with
// assumed-role credentials, never ours.

import { S3Client } from '@aws-sdk/client-s3'

export type S3StoreClientOptions = {
  region: string
  // Both or neither. Undefined ⇒ the SDK's default credential chain (env vars,
  // instance profile, IRSA), which is how the journal sealer runs when no
  // dedicated key pair is configured.
  accessKeyId: string | undefined
  secretAccessKey: string | undefined
  // Undefined ⇒ real AWS S3. Set ⇒ any S3-compatible server; path-style
  // addressing comes with it, because a self-hosted endpoint rarely has
  // per-bucket DNS.
  endpoint: string | undefined
  // 'WHEN_REQUIRED' for the two stores that hand out presigned URLs; undefined
  // (the SDK default, WHEN_SUPPORTED) for the journal sealer, which writes
  // through the SDK directly and wants its WORM objects checksummed.
  requestChecksumCalculation: 'WHEN_REQUIRED' | undefined
}

export function makeS3Client(opts: S3StoreClientOptions): S3Client {
  const { region, accessKeyId, secretAccessKey, endpoint, requestChecksumCalculation } = opts

  return new S3Client({
    region,
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    // AWS SDK v3.729+ defaults to injecting a CRC32 checksum into presigned
    // PUT URLs (x-amz-checksum-crc32 / x-amz-sdk-checksum-algorithm signed
    // query params). That forces every uploader (sandbox curl, Electron PUT)
    // to send a matching checksum header or the store rejects the signature.
    // A presigning store passes WHEN_REQUIRED to keep its URLs clean; leaving
    // this undefined keeps the SDK default for callers that do not presign.
    ...(requestChecksumCalculation ? { requestChecksumCalculation } : {}),
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  })
}
