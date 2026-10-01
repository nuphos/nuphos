import { cloudflarePaginatedRequest, cloudflareRequest } from './cloudflare-client'

import type { CloudflareAccountHandle } from './cloudflare-client'

export type { CloudflareAccountHandle } from './cloudflare-client'
export {
  cloudflarePaginatedRequest,
  cloudflareRawRequest,
  cloudflareRequest,
  verifyCloudflareAccount,
} from './cloudflare-client'

type CloudflareZoneResult = {
  id: string
  name: string
  status?: string
  paused?: boolean
  type?: string
  name_servers?: string[]
  original_name_servers?: string[]
  created_on?: string
  modified_on?: string
}

type CloudflareDnsRecordResult = {
  id: string
  type: string
  name: string
  content: string
  ttl: number
  proxied?: boolean
  proxiable?: boolean
  priority?: number
  comment?: string | null
  tags?: string[]
  created_on?: string
  modified_on?: string
}

export type CloudflareZone = {
  id: string
  name: string
  status: string | null
  paused: boolean
  type: string | null
  nameServers: string[]
  originalNameServers: string[]
  createdAt: string | null
  modifiedAt: string | null
}

export type CloudflareDnsRecord = {
  id: string
  type: string
  name: string
  content: string
  ttl: number
  proxied: boolean | null
  proxiable: boolean
  priority: number | null
  comment: string | null
  tags: string[]
  createdAt: string | null
  modifiedAt: string | null
}

export type CloudflareDnsRecordInput = {
  type: string
  name: string
  content: string
  ttl?: number
  proxied?: boolean
  priority?: number
  comment?: string
}

function mapZone(zone: CloudflareZoneResult): CloudflareZone {
  return {
    id: zone.id,
    name: zone.name,
    status: zone.status ?? null,
    paused: zone.paused ?? false,
    type: zone.type ?? null,
    nameServers: zone.name_servers ?? [],
    originalNameServers: zone.original_name_servers ?? [],
    createdAt: zone.created_on ?? null,
    modifiedAt: zone.modified_on ?? null,
  }
}

function mapDnsRecord(record: CloudflareDnsRecordResult): CloudflareDnsRecord {
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    content: record.content,
    ttl: record.ttl,
    proxied: record.proxied ?? null,
    proxiable: record.proxiable ?? false,
    priority: record.priority ?? null,
    comment: record.comment ?? null,
    tags: record.tags ?? [],
    createdAt: record.created_on ?? null,
    modifiedAt: record.modified_on ?? null,
  }
}

export async function listCloudflareZones(
  handle: CloudflareAccountHandle,
): Promise<CloudflareZone[]> {
  const params = new URLSearchParams({
    'account.id': handle.accountId,
    per_page: '100',
    order: 'name',
    direction: 'asc',
  })
  const zones = await cloudflarePaginatedRequest<CloudflareZoneResult>(handle, '/zones', params)

  return zones.map(mapZone)
}

export async function listCloudflareDnsRecords(
  handle: CloudflareAccountHandle,
  zoneId: string,
): Promise<CloudflareDnsRecord[]> {
  const params = new URLSearchParams({
    per_page: '100',
    order: 'type',
    direction: 'asc',
  })
  const records = await cloudflarePaginatedRequest<CloudflareDnsRecordResult>(
    handle,
    `/zones/${encodeURIComponent(zoneId)}/dns_records`,
    params,
  )

  return records.map(mapDnsRecord)
}

export async function createCloudflareDnsRecord(
  handle: CloudflareAccountHandle,
  zoneId: string,
  input: CloudflareDnsRecordInput,
): Promise<CloudflareDnsRecord> {
  const record = await cloudflareRequest<CloudflareDnsRecordResult>(
    handle,
    `/zones/${encodeURIComponent(zoneId)}/dns_records`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )

  return mapDnsRecord(record)
}

export async function updateCloudflareDnsRecord(
  handle: CloudflareAccountHandle,
  zoneId: string,
  recordId: string,
  input: CloudflareDnsRecordInput,
): Promise<CloudflareDnsRecord> {
  const record = await cloudflareRequest<CloudflareDnsRecordResult>(
    handle,
    `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )

  return mapDnsRecord(record)
}

export async function deleteCloudflareDnsRecord(
  handle: CloudflareAccountHandle,
  zoneId: string,
  recordId: string,
): Promise<void> {
  await cloudflareRequest<{ id: string }>(
    handle,
    `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
    { method: 'DELETE' },
  )
}
