import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// ---------------------------------------------------------------------------
// Object-level operations (R2 S3-compatible API — needs separate access keys)
// ---------------------------------------------------------------------------

export type R2S3Handle = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
}

export type CloudflareR2Object = {
  key: string
  size: number
  lastModified: string | null
  etag: string | null
}

export type CloudflareR2ObjectListing = {
  prefix: string
  prefixes: string[]
  objects: CloudflareR2Object[]
  isTruncated: boolean
  nextContinuationToken: string | null
}

function r2Client(handle: R2S3Handle): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${handle.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: handle.accessKeyId,
      secretAccessKey: handle.secretAccessKey,
    },
  })
}

/** Liveness probe used when binding R2 S3 credentials. */
export async function verifyR2S3Credentials(handle: R2S3Handle): Promise<void> {
  const s3 = r2Client(handle)

  await s3.send(new ListBucketsCommand({}))
}

const OBJECTS_PAGE_SIZE = 200

export async function listR2Objects(
  handle: R2S3Handle,
  bucket: string,
  prefix: string,
  continuationToken: string | null,
): Promise<CloudflareR2ObjectListing> {
  const s3 = r2Client(handle)
  const out = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      Delimiter: '/',
      MaxKeys: OBJECTS_PAGE_SIZE,
      ContinuationToken: continuationToken || undefined,
    }),
  )
  const prefixes = (out.CommonPrefixes ?? []).map((p) => p.Prefix).filter((p): p is string => !!p)
  const objects: CloudflareR2Object[] = (out.Contents ?? [])
    .filter((o) => !!o.Key && o.Key !== prefix)
    .map((o) => ({
      key: o.Key!,
      size: o.Size ?? 0,
      lastModified: o.LastModified ? o.LastModified.toISOString() : null,
      etag: o.ETag ? o.ETag.replace(/^"|"$/g, '') : null,
    }))

  return {
    prefix,
    prefixes,
    objects,
    isTruncated: !!out.IsTruncated,
    nextContinuationToken: out.NextContinuationToken ?? null,
  }
}

const PRESIGN_EXPIRES_SEC = 600

export async function getR2ObjectDownloadUrl(
  handle: R2S3Handle,
  bucket: string,
  key: string,
): Promise<string> {
  const s3 = r2Client(handle)

  return await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: PRESIGN_EXPIRES_SEC,
  })
}

const TEXT_PREVIEW_LIMIT = 256 * 1024

export type CloudflareR2ObjectPreview = {
  text: string
  truncated: boolean
  size: number
  contentType: string | null
}

export async function getR2ObjectTextPreview(
  handle: R2S3Handle,
  bucket: string,
  key: string,
): Promise<CloudflareR2ObjectPreview> {
  const s3 = r2Client(handle)
  const out = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=0-${String(TEXT_PREVIEW_LIMIT - 1)}`,
    }),
  )
  const body = out.Body

  if (!body) {
    return { text: '', truncated: false, size: 0, contentType: out.ContentType ?? null }
  }
  const bytes = await (
    body as { transformToByteArray: () => Promise<Uint8Array> }
  ).transformToByteArray()
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  let fullSize = out.ContentLength ?? bytes.length
  const range = out.ContentRange

  if (range) {
    const total = range.split('/')[1]
    const parsed = total && total !== '*' ? Number(total) : NaN

    if (Number.isFinite(parsed)) fullSize = parsed
  }

  return {
    text,
    truncated: bytes.length < fullSize,
    size: fullSize,
    contentType: out.ContentType ?? null,
  }
}

export async function putR2Object(
  handle: R2S3Handle,
  bucket: string,
  key: string,
  body: Uint8Array,
  contentType: string | null,
): Promise<void> {
  const s3 = r2Client(handle)

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ...(contentType ? { ContentType: contentType } : {}),
    }),
  )
}

export async function deleteR2Object(
  handle: R2S3Handle,
  bucket: string,
  key: string,
): Promise<void> {
  const s3 = r2Client(handle)

  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}
