import { cfBase } from './cf-dns'
import { call } from './client'

import type { DatabaseConnection } from './database-types'

export type CloudflareD1Database = {
  uuid: string
  name: string
  version: string | null
  numTables: number | null
  fileSize: number | null
  createdAt: string | null
  runningInRegion: string | null
}

export type CloudflareD1QueryMeta = {
  durationMs: number | null
  rowsRead: number | null
  rowsWritten: number | null
  changes: number | null
  lastRowId: number | null
  sizeAfter: number | null
}

export type CloudflareD1QueryResult = {
  success: boolean
  results: Record<string, unknown>[]
  columns: string[]
  meta: CloudflareD1QueryMeta | null
}

export type CloudflareD1DatabaseInput = {
  name: string
  primaryLocationHint?: string
}

export async function listCloudflareD1Databases(
  teamId: string,
  accountId: string,
): Promise<CloudflareD1Database[]> {
  const data = await call<{ databases: CloudflareD1Database[] }>(
    'GET',
    `${cfBase(teamId, accountId)}/d1/databases`,
  )

  return data.databases ?? []
}

export async function createCloudflareD1Database(
  teamId: string,
  accountId: string,
  input: CloudflareD1DatabaseInput,
): Promise<CloudflareD1Database> {
  return call<CloudflareD1Database>('POST', `${cfBase(teamId, accountId)}/d1/databases`, input, {
    retry: false,
  })
}

export async function getCloudflareD1Database(
  teamId: string,
  accountId: string,
  databaseId: string,
): Promise<CloudflareD1Database> {
  return call<CloudflareD1Database>(
    'GET',
    `${cfBase(teamId, accountId)}/d1/databases/${encodeURIComponent(databaseId)}`,
  )
}

export async function openCloudflareD1InDatabases(
  teamId: string,
  accountId: string,
  databaseId: string,
): Promise<DatabaseConnection> {
  return call<DatabaseConnection>(
    'POST',
    `${cfBase(teamId, accountId)}/d1/databases/${encodeURIComponent(databaseId)}/open-in-databases`,
    undefined,
    { retry: false },
  )
}

export async function deleteCloudflareD1Database(
  teamId: string,
  accountId: string,
  databaseId: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `${cfBase(teamId, accountId)}/d1/databases/${encodeURIComponent(databaseId)}`,
  )
}

export async function listCloudflareD1Tables(
  teamId: string,
  accountId: string,
  databaseId: string,
): Promise<string[]> {
  const data = await call<{ tables: string[] }>(
    'GET',
    `${cfBase(teamId, accountId)}/d1/databases/${encodeURIComponent(databaseId)}/tables`,
  )

  return data.tables ?? []
}

export async function queryCloudflareD1(
  teamId: string,
  accountId: string,
  databaseId: string,
  sql: string,
  params?: string[],
): Promise<CloudflareD1QueryResult> {
  return call<CloudflareD1QueryResult>(
    'POST',
    `${cfBase(teamId, accountId)}/d1/databases/${encodeURIComponent(databaseId)}/query`,
    params && params.length > 0 ? { sql, params } : { sql },
    { retry: false },
  )
}

// --- KV --------------------------------------------------------------------

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
  isText: boolean
}

export async function listCloudflareKvNamespaces(
  teamId: string,
  accountId: string,
): Promise<CloudflareKvNamespace[]> {
  const data = await call<{ namespaces: CloudflareKvNamespace[] }>(
    'GET',
    `${cfBase(teamId, accountId)}/kv/namespaces`,
  )

  return data.namespaces ?? []
}

export async function createCloudflareKvNamespace(
  teamId: string,
  accountId: string,
  title: string,
): Promise<CloudflareKvNamespace> {
  return call<CloudflareKvNamespace>(
    'POST',
    `${cfBase(teamId, accountId)}/kv/namespaces`,
    { title },
    { retry: false },
  )
}

export async function renameCloudflareKvNamespace(
  teamId: string,
  accountId: string,
  namespaceId: string,
  title: string,
): Promise<void> {
  await call<void>(
    'PUT',
    `${cfBase(teamId, accountId)}/kv/namespaces/${encodeURIComponent(namespaceId)}`,
    { title },
  )
}

export async function deleteCloudflareKvNamespace(
  teamId: string,
  accountId: string,
  namespaceId: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `${cfBase(teamId, accountId)}/kv/namespaces/${encodeURIComponent(namespaceId)}`,
  )
}

export async function listCloudflareKvKeys(
  teamId: string,
  accountId: string,
  namespaceId: string,
  prefix?: string,
  cursor?: string | null,
): Promise<CloudflareKvKeyPage> {
  const params = new URLSearchParams()

  if (prefix) params.set('prefix', prefix)
  if (cursor) params.set('cursor', cursor)
  const query = params.toString()

  return call<CloudflareKvKeyPage>(
    'GET',
    `${cfBase(teamId, accountId)}/kv/namespaces/${encodeURIComponent(namespaceId)}/keys${
      query ? `?${query}` : ''
    }`,
  )
}

export async function readCloudflareKvValue(
  teamId: string,
  accountId: string,
  namespaceId: string,
  key: string,
): Promise<CloudflareKvValue> {
  return call<CloudflareKvValue>(
    'GET',
    `${cfBase(teamId, accountId)}/kv/namespaces/${encodeURIComponent(
      namespaceId,
    )}/values?key=${encodeURIComponent(key)}`,
  )
}

export async function writeCloudflareKvValue(
  teamId: string,
  accountId: string,
  namespaceId: string,
  input: { key: string; value: string; expirationTtl?: number },
): Promise<void> {
  await call<void>(
    'PUT',
    `${cfBase(teamId, accountId)}/kv/namespaces/${encodeURIComponent(namespaceId)}/values`,
    input,
  )
}

export async function deleteCloudflareKvValue(
  teamId: string,
  accountId: string,
  namespaceId: string,
  key: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `${cfBase(teamId, accountId)}/kv/namespaces/${encodeURIComponent(
      namespaceId,
    )}/values?key=${encodeURIComponent(key)}`,
  )
}
