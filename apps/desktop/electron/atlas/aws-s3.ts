import { call, withAwsRole } from './client'

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

export type AwsS3ObjectPreview = {
  text: string
  truncated: boolean
  size: number
  contentType: string | null
}

export async function listAwsS3Buckets(
  teamId: string,
  accountId: string,
  roleId?: string,
): Promise<AwsS3Bucket[]> {
  const data = await call<{ buckets: AwsS3Bucket[] }>(
    'GET',
    withAwsRole(`/teams/${teamId}/aws-accounts/${accountId}/s3-buckets`, roleId),
  )

  return data.buckets ?? []
}

export async function listAwsS3BucketObjects(
  teamId: string,
  accountId: string,
  bucket: string,
  region: string,
  prefix: string,
  continuationToken: string | null,
  roleId?: string,
): Promise<AwsS3ObjectListing> {
  const params = new URLSearchParams()

  if (region) params.set('region', region)
  if (prefix) params.set('prefix', prefix)
  if (continuationToken) params.set('continuationToken', continuationToken)
  if (roleId) params.set('roleId', roleId)
  const qs = params.toString()
  const query = qs ? `?${qs}` : ''

  return await call<AwsS3ObjectListing>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/s3-buckets/${encodeURIComponent(bucket)}/objects${query}`,
  )
}

export async function getAwsS3ObjectDownloadUrl(
  teamId: string,
  accountId: string,
  bucket: string,
  region: string,
  key: string,
  roleId?: string,
): Promise<string> {
  const params = new URLSearchParams()

  if (region) params.set('region', region)
  params.set('key', key)
  if (roleId) params.set('roleId', roleId)
  const data = await call<{ url: string }>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/s3-buckets/${encodeURIComponent(bucket)}/object-url?${params.toString()}`,
  )

  return data.url
}

export async function getAwsS3ObjectPreview(
  teamId: string,
  accountId: string,
  bucket: string,
  region: string,
  key: string,
  roleId?: string,
): Promise<AwsS3ObjectPreview> {
  const params = new URLSearchParams()

  if (region) params.set('region', region)
  params.set('key', key)
  if (roleId) params.set('roleId', roleId)

  return await call<AwsS3ObjectPreview>(
    'GET',
    `/teams/${teamId}/aws-accounts/${accountId}/s3-buckets/${encodeURIComponent(bucket)}/object-preview?${params.toString()}`,
  )
}
