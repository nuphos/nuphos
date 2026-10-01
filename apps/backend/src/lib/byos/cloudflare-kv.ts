import { cloudflarePaginatedRequest, cloudflareRawRequest, cloudflareRequest } from './cloudflare'

import type { CloudflareAccountHandle } from './cloudflare'

export type CloudflareKvNamespace = {
  id: string
  title: string
  supportsUrlEncoding: boolean
}

export type CloudflareKvKey = {
  name: string
  expiration: number | null
  metadata: Record<string, unknown> | null
}

export type CloudflareKvKeyPage = {
  keys: CloudflareKvKey[]
  cursor: string | null
  listComplete: boolean
}

export type CloudflareKvValue = {
  value: string
  /** Whether the value decoded cleanly as UTF-8 text (binary => false). */
  isText: boolean
}

type KvNamespaceResult = {
  id: string
  title: string
  supports_url_encoding?: boolean
}

type KvKeyResult = {
  name: string
  expiration?: number
  metadata?: Record<string, unknown>
}

function acct(handle: CloudflareAccountHandle): string {
  return encodeURIComponent(handle.accountId)
}

function mapNamespace(ns: KvNamespaceResult): CloudflareKvNamespace {
  return {
    id: ns.id,
    title: ns.title,
    supportsUrlEncoding: ns.supports_url_encoding ?? false,
  }
}

export async function listKvNamespaces(
  handle: CloudflareAccountHandle,
): Promise<CloudflareKvNamespace[]> {
  const params = new URLSearchParams({ per_page: '100', order: 'title', direction: 'asc' })
  const namespaces = await cloudflarePaginatedRequest<KvNamespaceResult>(
    handle,
    `/accounts/${acct(handle)}/storage/kv/namespaces`,
    params,
  )

  return namespaces.map(mapNamespace)
}

export async function createKvNamespace(
  handle: CloudflareAccountHandle,
  title: string,
): Promise<CloudflareKvNamespace> {
  const ns = await cloudflareRequest<KvNamespaceResult>(
    handle,
    `/accounts/${acct(handle)}/storage/kv/namespaces`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    },
  )

  return mapNamespace(ns)
}

export async function renameKvNamespace(
  handle: CloudflareAccountHandle,
  namespaceId: string,
  title: string,
): Promise<void> {
  await cloudflareRequest<unknown>(
    handle,
    `/accounts/${acct(handle)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    },
  )
}

export async function deleteKvNamespace(
  handle: CloudflareAccountHandle,
  namespaceId: string,
): Promise<void> {
  await cloudflareRequest<unknown>(
    handle,
    `/accounts/${acct(handle)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}`,
    { method: 'DELETE' },
  )
}

const KV_KEYS_PAGE_SIZE = 1000

export async function listKvKeys(
  handle: CloudflareAccountHandle,
  namespaceId: string,
  options: { prefix?: string; cursor?: string | null } = {},
): Promise<CloudflareKvKeyPage> {
  const params = new URLSearchParams({ limit: String(KV_KEYS_PAGE_SIZE) })

  if (options.prefix) params.set('prefix', options.prefix)
  if (options.cursor) params.set('cursor', options.cursor)

  // KV key listing paginates via an opaque cursor (not page numbers), so we make
  // a single request per page and hand the cursor back to the caller.
  const res = await cloudflareRawRequest(
    handle,
    `/accounts/${acct(handle)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/keys?${String(params)}`,
  )
  const payload = (await res.json()) as {
    result?: KvKeyResult[]
    result_info?: { cursor?: string }
  }
  const cursor = payload.result_info?.cursor ?? ''

  return {
    keys: (payload.result ?? []).map((k) => ({
      name: k.name,
      expiration: k.expiration ?? null,
      metadata: k.metadata ?? null,
    })),
    cursor: cursor.length > 0 ? cursor : null,
    listComplete: cursor.length === 0,
  }
}

export async function readKvValue(
  handle: CloudflareAccountHandle,
  namespaceId: string,
  key: string,
): Promise<CloudflareKvValue> {
  const res = await cloudflareRawRequest(
    handle,
    `/accounts/${acct(handle)}/storage/kv/namespaces/${encodeURIComponent(
      namespaceId,
    )}/values/${encodeURIComponent(key)}`,
  )
  const bytes = new Uint8Array(await res.arrayBuffer())
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  // Heuristic: if decoding produced replacement chars, treat as binary so the UI
  // can warn instead of rendering garbage.
  const isText = !text.includes('�')

  return { value: text, isText }
}

export async function writeKvValue(
  handle: CloudflareAccountHandle,
  namespaceId: string,
  key: string,
  value: string,
  options: { expirationTtl?: number } = {},
): Promise<void> {
  const params = new URLSearchParams()

  if (options.expirationTtl && options.expirationTtl > 0) {
    params.set('expiration_ttl', String(options.expirationTtl))
  }
  const query = params.toString()
  const search = query ? `?${query}` : ''

  await cloudflareRequest<unknown>(
    handle,
    `/accounts/${acct(handle)}/storage/kv/namespaces/${encodeURIComponent(
      namespaceId,
    )}/values/${encodeURIComponent(key)}${search}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: value,
    },
  )
}

export async function deleteKvValue(
  handle: CloudflareAccountHandle,
  namespaceId: string,
  key: string,
): Promise<void> {
  await cloudflareRequest<unknown>(
    handle,
    `/accounts/${acct(handle)}/storage/kv/namespaces/${encodeURIComponent(
      namespaceId,
    )}/values/${encodeURIComponent(key)}`,
    { method: 'DELETE' },
  )
}
