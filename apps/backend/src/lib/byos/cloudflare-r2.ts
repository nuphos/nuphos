import { cloudflareRequest } from './cloudflare'

import type { CloudflareAccountHandle } from './cloudflare'

export type {
  CloudflareR2Object,
  CloudflareR2ObjectListing,
  CloudflareR2ObjectPreview,
  R2S3Handle,
} from './cloudflare-r2-objects'
export {
  deleteR2Object,
  getR2ObjectDownloadUrl,
  getR2ObjectTextPreview,
  listR2Objects,
  putR2Object,
  verifyR2S3Credentials,
} from './cloudflare-r2-objects'

// ---------------------------------------------------------------------------
// Bucket-level operations (account API token — no S3 credentials needed)
// ---------------------------------------------------------------------------

export type CloudflareR2Bucket = {
  name: string
  creationDate: string | null
  location: string | null
  storageClass: string | null
}

export type CloudflareR2BucketUsage = {
  payloadSize: number | null
  metadataSize: number | null
  objectCount: number | null
}

export type CloudflareR2ManagedDomain = {
  domain: string | null
  enabled: boolean
}

export type CloudflareR2CustomDomain = {
  domain: string
  enabled: boolean
  status: string | null
}

type R2BucketResult = {
  name: string
  creation_date?: string
  location?: string
  storage_class?: string
}

function acct(handle: CloudflareAccountHandle): string {
  return encodeURIComponent(handle.accountId)
}

function mapBucket(b: R2BucketResult): CloudflareR2Bucket {
  return {
    name: b.name,
    creationDate: b.creation_date ?? null,
    location: b.location ?? null,
    storageClass: b.storage_class ?? null,
  }
}

export async function listR2Buckets(
  handle: CloudflareAccountHandle,
): Promise<CloudflareR2Bucket[]> {
  const result = await cloudflareRequest<{ buckets?: R2BucketResult[] }>(
    handle,
    `/accounts/${acct(handle)}/r2/buckets`,
  )

  return (result.buckets ?? []).map(mapBucket)
}

export async function createR2Bucket(
  handle: CloudflareAccountHandle,
  input: { name: string; locationHint?: string; storageClass?: string },
): Promise<CloudflareR2Bucket> {
  const bucket = await cloudflareRequest<R2BucketResult>(
    handle,
    `/accounts/${acct(handle)}/r2/buckets`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name,
        ...(input.locationHint ? { locationHint: input.locationHint } : {}),
        ...(input.storageClass ? { storageClass: input.storageClass } : {}),
      }),
    },
  )

  return mapBucket(bucket)
}

export async function deleteR2Bucket(
  handle: CloudflareAccountHandle,
  bucketName: string,
): Promise<void> {
  await cloudflareRequest<unknown>(
    handle,
    `/accounts/${acct(handle)}/r2/buckets/${encodeURIComponent(bucketName)}`,
    { method: 'DELETE' },
  )
}

export async function getR2BucketUsage(
  handle: CloudflareAccountHandle,
  bucketName: string,
): Promise<CloudflareR2BucketUsage> {
  const usage = await cloudflareRequest<{
    payloadSize?: number | string
    metadataSize?: number | string
    objectCount?: number | string
  }>(handle, `/accounts/${acct(handle)}/r2/buckets/${encodeURIComponent(bucketName)}/usage`)
  const num = (v: number | string | undefined): number | null => {
    if (v === undefined) return null
    const parsed = typeof v === 'number' ? v : Number(v)

    return Number.isFinite(parsed) ? parsed : null
  }

  return {
    payloadSize: num(usage.payloadSize),
    metadataSize: num(usage.metadataSize),
    objectCount: num(usage.objectCount),
  }
}

export async function getR2ManagedDomain(
  handle: CloudflareAccountHandle,
  bucketName: string,
): Promise<CloudflareR2ManagedDomain> {
  const result = await cloudflareRequest<{ domain?: string; enabled?: boolean }>(
    handle,
    `/accounts/${acct(handle)}/r2/buckets/${encodeURIComponent(bucketName)}/domains/managed`,
  )

  return { domain: result.domain ?? null, enabled: result.enabled ?? false }
}

export async function setR2ManagedDomain(
  handle: CloudflareAccountHandle,
  bucketName: string,
  enabled: boolean,
): Promise<CloudflareR2ManagedDomain> {
  const result = await cloudflareRequest<{ domain?: string; enabled?: boolean }>(
    handle,
    `/accounts/${acct(handle)}/r2/buckets/${encodeURIComponent(bucketName)}/domains/managed`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    },
  )

  return { domain: result.domain ?? null, enabled: result.enabled ?? enabled }
}

export async function listR2CustomDomains(
  handle: CloudflareAccountHandle,
  bucketName: string,
): Promise<CloudflareR2CustomDomain[]> {
  const result = await cloudflareRequest<{
    domains?: {
      domain: string
      enabled?: boolean
      status?: { ownership?: string; ssl?: string }
    }[]
  }>(
    handle,
    `/accounts/${acct(handle)}/r2/buckets/${encodeURIComponent(bucketName)}/custom_domains`,
  )

  return (result.domains ?? []).map((d) => ({
    domain: d.domain,
    enabled: d.enabled ?? false,
    status: d.status?.ssl ?? d.status?.ownership ?? null,
  }))
}

export async function addR2CustomDomain(
  handle: CloudflareAccountHandle,
  bucketName: string,
  input: { domain: string; zoneId: string; enabled?: boolean },
): Promise<void> {
  await cloudflareRequest<unknown>(
    handle,
    `/accounts/${acct(handle)}/r2/buckets/${encodeURIComponent(bucketName)}/custom_domains`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: input.domain,
        zoneId: input.zoneId,
        enabled: input.enabled ?? true,
      }),
    },
  )
}

export async function deleteR2CustomDomain(
  handle: CloudflareAccountHandle,
  bucketName: string,
  domain: string,
): Promise<void> {
  await cloudflareRequest<unknown>(
    handle,
    `/accounts/${acct(handle)}/r2/buckets/${encodeURIComponent(
      bucketName,
    )}/custom_domains/${encodeURIComponent(domain)}`,
    { method: 'DELETE' },
  )
}
