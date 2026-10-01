import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { errorTelemetryProperties, logEvent } from '@/lib/observability'

import { assumeRoleAsConnector } from './aws'

export type AwsS3Bucket = {
  name: string
  region: string
  createdAt: string | null
}

export type AwsS3Object = {
  key: string
  size: number
  lastModified: string | null
  storageClass: string | null
  etag: string | null
}

export type AwsS3ObjectListing = {
  prefix: string
  delimiter: string
  prefixes: string[]
  objects: AwsS3Object[]
  isTruncated: boolean
  nextContinuationToken: string | null
}

const LOCATION_CONCURRENCY = 10

function normalizeBucketRegion(location: string | undefined): string {
  if (!location) return 'us-east-1'
  if (location === 'EU') return 'eu-west-1'

  return location
}

async function chunkMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []

  for (let i = 0; i < items.length; i += limit) {
    results.push(...(await Promise.all(items.slice(i, i + limit).map(fn))))
  }

  return results
}

export async function listS3Buckets(roleArn: string): Promise<AwsS3Bucket[]> {
  const temp = await assumeRoleAsConnector(roleArn)
  const s3 = new S3Client({ region: 'us-east-1', credentials: temp })

  const out = await s3.send(new ListBucketsCommand({}))
  const buckets = (out.Buckets ?? []).filter((b) => !!b.Name)

  const results = await chunkMap(buckets, LOCATION_CONCURRENCY, async (b): Promise<AwsS3Bucket> => {
    try {
      const loc = await s3.send(new GetBucketLocationCommand({ Bucket: b.Name! }))

      return {
        name: b.Name!,
        region: normalizeBucketRegion(loc.LocationConstraint),
        createdAt: b.CreationDate ? b.CreationDate.toISOString() : null,
      }
    } catch (err) {
      logEvent('warn', 'aws.s3.bucket_location_failed', {
        bucket_name: b.Name,
        ...errorTelemetryProperties(err),
      })

      return {
        name: b.Name!,
        region: 'unknown',
        createdAt: b.CreationDate ? b.CreationDate.toISOString() : null,
      }
    }
  })

  return results
}

const OBJECTS_PAGE_SIZE = 200

export async function listS3BucketObjects(
  roleArn: string,
  bucket: string,
  region: string,
  prefix: string,
  continuationToken: string | null,
): Promise<AwsS3ObjectListing> {
  const temp = await assumeRoleAsConnector(roleArn)
  const s3 = new S3Client({ region: region || 'us-east-1', credentials: temp })

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

  const objects: AwsS3Object[] = (out.Contents ?? [])
    .filter((o) => !!o.Key && o.Key !== prefix)
    .map((o) => ({
      key: o.Key!,
      size: o.Size ?? 0,
      lastModified: o.LastModified ? o.LastModified.toISOString() : null,
      storageClass: o.StorageClass ?? null,
      etag: o.ETag ? o.ETag.replace(/^"|"$/g, '') : null,
    }))

  return {
    prefix,
    delimiter: '/',
    prefixes,
    objects,
    isTruncated: !!out.IsTruncated,
    nextContinuationToken: out.NextContinuationToken ?? null,
  }
}

const PRESIGN_EXPIRES_SEC = 600

export async function getS3ObjectDownloadUrl(
  roleArn: string,
  bucket: string,
  region: string,
  key: string,
): Promise<string> {
  const temp = await assumeRoleAsConnector(roleArn)
  const s3 = new S3Client({ region: region || 'us-east-1', credentials: temp })

  return await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: PRESIGN_EXPIRES_SEC,
  })
}

const TEXT_PREVIEW_LIMIT = 256 * 1024

export type AwsS3ObjectPreview = {
  text: string
  truncated: boolean
  size: number
  contentType: string | null
}

export async function getS3ObjectTextPreview(
  roleArn: string,
  bucket: string,
  region: string,
  key: string,
): Promise<AwsS3ObjectPreview> {
  const temp = await assumeRoleAsConnector(roleArn)
  const s3 = new S3Client({ region: region || 'us-east-1', credentials: temp })
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

  // AWS SDK v3 returns a Body that supports transformToByteArray() in both
  // Node/Bun and browser runtimes. We use TextDecoder with fatal:false so
  // binary content yields replacement chars rather than throwing.
  const bytes = await (
    body as { transformToByteArray: () => Promise<Uint8Array> }
  ).transformToByteArray()
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)

  // ContentRange (when present from a 206 Partial Content) is "bytes 0-N/total".
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
