import { call } from './client'

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

export async function listCloudflareZones(
  teamId: string,
  accountId: string,
): Promise<CloudflareZone[]> {
  const data = await call<{ zones: CloudflareZone[] }>(
    'GET',
    `/teams/${teamId}/cloudflare-accounts/${accountId}/zones`,
  )

  return data.zones ?? []
}

export async function listCloudflareDnsRecords(
  teamId: string,
  accountId: string,
  zoneId: string,
): Promise<CloudflareDnsRecord[]> {
  const data = await call<{ records: CloudflareDnsRecord[] }>(
    'GET',
    `/teams/${teamId}/cloudflare-accounts/${accountId}/zones/${zoneId}/dns-records`,
  )

  return data.records ?? []
}

export async function createCloudflareDnsRecord(
  teamId: string,
  accountId: string,
  zoneId: string,
  input: CloudflareDnsRecordInput,
): Promise<CloudflareDnsRecord> {
  return call<CloudflareDnsRecord>(
    'POST',
    `/teams/${teamId}/cloudflare-accounts/${accountId}/zones/${zoneId}/dns-records`,
    input,
  )
}

export async function updateCloudflareDnsRecord(
  teamId: string,
  accountId: string,
  zoneId: string,
  recordId: string,
  input: CloudflareDnsRecordInput,
): Promise<CloudflareDnsRecord> {
  return call<CloudflareDnsRecord>(
    'PUT',
    `/teams/${teamId}/cloudflare-accounts/${accountId}/zones/${zoneId}/dns-records/${recordId}`,
    input,
  )
}

export async function deleteCloudflareDnsRecord(
  teamId: string,
  accountId: string,
  zoneId: string,
  recordId: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/cloudflare-accounts/${accountId}/zones/${zoneId}/dns-records/${recordId}`,
  )
}

// ===========================================================================
// Cloudflare Workers / R2 / Pages / D1 / KV
// ===========================================================================

export function cfBase(teamId: string, accountId: string): string {
  return `/teams/${teamId}/cloudflare-accounts/${accountId}`
}

// --- Workers ---------------------------------------------------------------

export type CloudflareOAuthStart = {
  authorizeUrl: string
  state: string
  expiresAt: string
}

export async function startCloudflareOAuth(
  teamId: string,
  scopes?: string[],
): Promise<CloudflareOAuthStart> {
  return call<CloudflareOAuthStart>(
    'POST',
    `/teams/${teamId}/cloudflare-accounts/start-oauth`,
    scopes && scopes.length > 0 ? { scopes } : {},
    { retry: false },
  )
}

export async function cancelCloudflareOAuth(teamId: string, state: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/cloudflare-accounts/start-oauth/${encodeURIComponent(state)}`,
    undefined,
    { retry: false },
  )
}

export type CloudflareOAuthResult =
  | { ready: false }
  | {
      ready: true
      bindingId: string
      teamId: string
      accountId: string
      accountName: string | null
    }

// Polling fallback for the OAuth bind: returns the result keyed by `state` once
// the backend callback has completed, even if the nuphos:// deep link was
// captured by another app instance. One-shot on the server, so never retry.
export async function pollCloudflareOAuthResult(state: string): Promise<CloudflareOAuthResult> {
  return call<CloudflareOAuthResult>(
    'GET',
    `/cloudflare-app/result/${encodeURIComponent(state)}`,
    undefined,
    { retry: false },
  )
}
