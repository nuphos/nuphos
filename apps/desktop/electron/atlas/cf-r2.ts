import { cfBase } from './cf-dns'
import { call } from './client'

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

export type CloudflareR2ObjectPreview = {
  text: string
  truncated: boolean
  size: number
  contentType: string | null
}

export type CloudflareR2CredentialsStatus = {
  bound: boolean
  accessKeyId: string | null
  createdAt: string | null
}

export type CloudflareR2BucketInput = {
  name: string
  locationHint?: string
  storageClass?: string
}

export async function getCloudflareR2Credentials(
  teamId: string,
  accountId: string,
): Promise<CloudflareR2CredentialsStatus> {
  return call<CloudflareR2CredentialsStatus>(
    'GET',
    `${cfBase(teamId, accountId)}/r2/s3-credentials`,
  )
}

export async function bindCloudflareR2Credentials(
  teamId: string,
  accountId: string,
  input: { accessKeyId: string; secretAccessKey: string },
): Promise<CloudflareR2CredentialsStatus> {
  return call<CloudflareR2CredentialsStatus>(
    'PUT',
    `${cfBase(teamId, accountId)}/r2/s3-credentials`,
    input,
  )
}

export async function unbindCloudflareR2Credentials(
  teamId: string,
  accountId: string,
): Promise<void> {
  await call<void>('DELETE', `${cfBase(teamId, accountId)}/r2/s3-credentials`)
}

export async function listCloudflareR2Buckets(
  teamId: string,
  accountId: string,
): Promise<CloudflareR2Bucket[]> {
  const data = await call<{ buckets: CloudflareR2Bucket[] }>(
    'GET',
    `${cfBase(teamId, accountId)}/r2/buckets`,
  )

  return data.buckets ?? []
}

export async function createCloudflareR2Bucket(
  teamId: string,
  accountId: string,
  input: CloudflareR2BucketInput,
): Promise<CloudflareR2Bucket> {
  return call<CloudflareR2Bucket>('POST', `${cfBase(teamId, accountId)}/r2/buckets`, input, {
    retry: false,
  })
}

export async function deleteCloudflareR2Bucket(
  teamId: string,
  accountId: string,
  bucketName: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `${cfBase(teamId, accountId)}/r2/buckets/${encodeURIComponent(bucketName)}`,
  )
}

export async function getCloudflareR2BucketUsage(
  teamId: string,
  accountId: string,
  bucketName: string,
): Promise<CloudflareR2BucketUsage> {
  return call<CloudflareR2BucketUsage>(
    'GET',
    `${cfBase(teamId, accountId)}/r2/buckets/${encodeURIComponent(bucketName)}/usage`,
  )
}

export async function getCloudflareR2ManagedDomain(
  teamId: string,
  accountId: string,
  bucketName: string,
): Promise<CloudflareR2ManagedDomain> {
  return call<CloudflareR2ManagedDomain>(
    'GET',
    `${cfBase(teamId, accountId)}/r2/buckets/${encodeURIComponent(bucketName)}/managed-domain`,
  )
}

export async function setCloudflareR2ManagedDomain(
  teamId: string,
  accountId: string,
  bucketName: string,
  enabled: boolean,
): Promise<CloudflareR2ManagedDomain> {
  return call<CloudflareR2ManagedDomain>(
    'PUT',
    `${cfBase(teamId, accountId)}/r2/buckets/${encodeURIComponent(bucketName)}/managed-domain`,
    { enabled },
  )
}
