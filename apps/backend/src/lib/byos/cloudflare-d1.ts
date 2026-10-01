import { cloudflarePaginatedRequest, cloudflareRequest } from './cloudflare'

import type { CloudflareAccountHandle } from './cloudflare'

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

type D1DatabaseResult = {
  uuid: string
  name: string
  version?: string
  num_tables?: number
  file_size?: number
  created_at?: string
  running_in_region?: string
}

type D1QueryResultRaw = {
  success?: boolean
  results?: unknown
  meta?: {
    duration?: number
    rows_read?: number
    rows_written?: number
    changes?: number
    last_row_id?: number
    size_after?: number
  }
}

function acct(handle: CloudflareAccountHandle): string {
  return encodeURIComponent(handle.accountId)
}

function mapDatabase(db: D1DatabaseResult): CloudflareD1Database {
  return {
    uuid: db.uuid,
    name: db.name,
    version: db.version ?? null,
    numTables: db.num_tables ?? null,
    fileSize: db.file_size ?? null,
    createdAt: db.created_at ?? null,
    runningInRegion: db.running_in_region ?? null,
  }
}

export async function listD1Databases(
  handle: CloudflareAccountHandle,
): Promise<CloudflareD1Database[]> {
  const params = new URLSearchParams({ per_page: '100' })
  const databases = await cloudflarePaginatedRequest<D1DatabaseResult>(
    handle,
    `/accounts/${acct(handle)}/d1/database`,
    params,
  )

  return databases.map(mapDatabase)
}

export async function getD1Database(
  handle: CloudflareAccountHandle,
  databaseId: string,
): Promise<CloudflareD1Database> {
  const db = await cloudflareRequest<D1DatabaseResult>(
    handle,
    `/accounts/${acct(handle)}/d1/database/${encodeURIComponent(databaseId)}`,
  )

  return mapDatabase(db)
}

export async function createD1Database(
  handle: CloudflareAccountHandle,
  input: { name: string; primaryLocationHint?: string },
): Promise<CloudflareD1Database> {
  const db = await cloudflareRequest<D1DatabaseResult>(
    handle,
    `/accounts/${acct(handle)}/d1/database`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name,
        ...(input.primaryLocationHint ? { primary_location_hint: input.primaryLocationHint } : {}),
      }),
    },
  )

  return mapDatabase(db)
}

export async function deleteD1Database(
  handle: CloudflareAccountHandle,
  databaseId: string,
): Promise<void> {
  await cloudflareRequest<unknown>(
    handle,
    `/accounts/${acct(handle)}/d1/database/${encodeURIComponent(databaseId)}`,
    { method: 'DELETE' },
  )
}

/**
 * Run a SQL statement against a D1 database. Cloudflare returns one entry per
 * statement; we run a single statement and surface the first entry. Columns are
 * derived from the first result row (D1 does not return a separate schema).
 */
export async function queryD1(
  handle: CloudflareAccountHandle,
  databaseId: string,
  sql: string,
  params: string[] = [],
): Promise<CloudflareD1QueryResult> {
  const entries = await cloudflareRequest<D1QueryResultRaw[]>(
    handle,
    `/accounts/${acct(handle)}/d1/database/${encodeURIComponent(databaseId)}/query`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    },
  )
  const entry = entries[0]
  const rawResults = Array.isArray(entry?.results) ? entry.results : []
  const results = rawResults.filter(
    (r): r is Record<string, unknown> => typeof r === 'object' && r !== null,
  )
  const columns = results[0] ? Object.keys(results[0]) : []
  const meta = entry?.meta
    ? {
        durationMs: entry.meta.duration ?? null,
        rowsRead: entry.meta.rows_read ?? null,
        rowsWritten: entry.meta.rows_written ?? null,
        changes: entry.meta.changes ?? null,
        lastRowId: entry.meta.last_row_id ?? null,
        sizeAfter: entry.meta.size_after ?? null,
      }
    : null

  return {
    success: entry?.success ?? true,
    results,
    columns,
    meta,
  }
}

/** Convenience: list user tables via sqlite_master. */
export async function listD1Tables(
  handle: CloudflareAccountHandle,
  databaseId: string,
): Promise<string[]> {
  const result = await queryD1(
    handle,
    databaseId,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name",
  )

  return result.results.map((r) => r.name).filter((n): n is string => typeof n === 'string')
}
