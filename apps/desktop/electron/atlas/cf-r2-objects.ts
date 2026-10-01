import { cfBase } from './cf-dns'
import { call } from './client'

import type {
  CloudflareR2CustomDomain,
  CloudflareR2ObjectListing,
  CloudflareR2ObjectPreview,
} from './cf-r2'

export async function listCloudflareR2CustomDomains(
  teamId: string,
  accountId: string,
  bucketName: string,
): Promise<CloudflareR2CustomDomain[]> {
  const data = await call<{ domains: CloudflareR2CustomDomain[] }>(
    'GET',
    `${cfBase(teamId, accountId)}/r2/buckets/${encodeURIComponent(bucketName)}/custom-domains`,
  )

  return data.domains ?? []
}

export async function addCloudflareR2CustomDomain(
  teamId: string,
  accountId: string,
  bucketName: string,
  input: { domain: string; zoneId: string; enabled?: boolean },
): Promise<void> {
  await call<void>(
    'POST',
    `${cfBase(teamId, accountId)}/r2/buckets/${encodeURIComponent(bucketName)}/custom-domains`,
    input,
    { retry: false },
  )
}

export async function deleteCloudflareR2CustomDomain(
  teamId: string,
  accountId: string,
  bucketName: string,
  domain: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `${cfBase(teamId, accountId)}/r2/buckets/${encodeURIComponent(
      bucketName,
    )}/custom-domains/${encodeURIComponent(domain)}`,
  )
}

export async function listCloudflareR2Objects(
  teamId: string,
  accountId: string,
  bucketName: string,
  prefix: string,
  cursor: string | null,
): Promise<CloudflareR2ObjectListing> {
  const params = new URLSearchParams()

  if (prefix) params.set('prefix', prefix)
  if (cursor) params.set('cursor', cursor)
  const query = params.toString()

  return call<CloudflareR2ObjectListing>(
    'GET',
    `${cfBase(teamId, accountId)}/r2/buckets/${encodeURIComponent(bucketName)}/objects${
      query ? `?${query}` : ''
    }`,
  )
}

export async function getCloudflareR2ObjectDownloadUrl(
  teamId: string,
  accountId: string,
  bucketName: string,
  key: string,
): Promise<string> {
  const data = await call<{ url: string }>(
    'GET',
    `${cfBase(teamId, accountId)}/r2/buckets/${encodeURIComponent(
      bucketName,
    )}/objects/download?key=${encodeURIComponent(key)}`,
  )

  return data.url
}

export async function getCloudflareR2ObjectPreview(
  teamId: string,
  accountId: string,
  bucketName: string,
  key: string,
): Promise<CloudflareR2ObjectPreview> {
  return call<CloudflareR2ObjectPreview>(
    'GET',
    `${cfBase(teamId, accountId)}/r2/buckets/${encodeURIComponent(
      bucketName,
    )}/objects/preview?key=${encodeURIComponent(key)}`,
  )
}

export async function putCloudflareR2Object(
  teamId: string,
  accountId: string,
  bucketName: string,
  input: { key: string; contentBase64: string; contentType?: string },
): Promise<void> {
  await call<void>(
    'POST',
    `${cfBase(teamId, accountId)}/r2/buckets/${encodeURIComponent(bucketName)}/objects`,
    input,
  )
}

export async function deleteCloudflareR2Object(
  teamId: string,
  accountId: string,
  bucketName: string,
  key: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `${cfBase(teamId, accountId)}/r2/buckets/${encodeURIComponent(
      bucketName,
    )}/objects?key=${encodeURIComponent(key)}`,
  )
}

// --- Pages -----------------------------------------------------------------
