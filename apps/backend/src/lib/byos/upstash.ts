import { decryptUpstashSecret } from '@/lib/byos/secrets'

import type { UpstashAccountBinding } from '@/models'

// Upstash Management API (upstash.com/docs/devops/developer-api). Auth is HTTP
// Basic with the account email as the username and a Management API key as the
// password — no OAuth, no token exchange:
//   curl https://api.upstash.com/v2/redis/databases -u EMAIL:API_KEY
const BASE_URL = 'https://api.upstash.com/v2'
const FETCH_TIMEOUT_MS = 30_000

export class UpstashApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'UpstashApiError'
  }
}

export type UpstashCredentials = {
  email: string
  apiKey: string
}

export function credentialsFromBinding(binding: UpstashAccountBinding): UpstashCredentials {
  return {
    email: binding.email,
    apiKey: decryptUpstashSecret(binding.encryptedApiKey),
  }
}

async function upstashGet<T>(creds: UpstashCredentials, path: string): Promise<T> {
  const basic = Buffer.from(`${creds.email}:${creds.apiKey}`).toString('base64')
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!res.ok) {
    // Upstash returns a bare text body (e.g. "Unauthorized") on auth failures
    // and JSON {"error": …} elsewhere; handle both.
    let detail = `HTTP ${String(res.status)}`
    const body = await res.text().catch(() => '')

    if (body) {
      try {
        const parsed = JSON.parse(body) as { error?: string; message?: string }

        detail = parsed.error || parsed.message || body
      } catch {
        detail = body
      }
    }
    throw new UpstashApiError(res.status, `Upstash API error: ${detail}`)
  }

  return res.json() as Promise<T>
}

export type UpstashRedisDatabase = {
  id: string
  name: string
  region: string | null
  type: string | null
  state: string | null
  endpoint: string | null
  port: number | null
  tls: boolean | null
  primaryRegion: string | null
  readRegions: string[]
  createdAt: string | null
}

type DatabaseResult = {
  database_id?: string
  database_name?: string
  region?: string
  database_type?: string
  type?: string
  state?: string
  endpoint?: string
  port?: number
  tls?: boolean
  primary_region?: string
  read_regions?: string[]
  creation_time?: number
}

function normalizeDatabase(db: DatabaseResult): UpstashRedisDatabase {
  return {
    id: db.database_id ?? '',
    name: db.database_name ?? db.database_id ?? '',
    region: db.region ?? null,
    type: db.database_type ?? db.type ?? null,
    state: db.state ?? null,
    endpoint: db.endpoint ?? null,
    port: typeof db.port === 'number' ? db.port : null,
    tls: typeof db.tls === 'boolean' ? db.tls : null,
    primaryRegion: db.primary_region ?? null,
    readRegions: db.read_regions ?? [],
    // `creation_time` is unix seconds; expose ISO like every other connector.
    createdAt:
      typeof db.creation_time === 'number' ? new Date(db.creation_time * 1000).toISOString() : null,
  }
}

export async function listUpstashRedisDatabases(
  creds: UpstashCredentials,
): Promise<UpstashRedisDatabase[]> {
  const body = await upstashGet<DatabaseResult[] | null>(creds, '/redis/databases')

  return (Array.isArray(body) ? body : []).map(normalizeDatabase)
}

/** Verify an email/API-key pair by issuing a cheap read; surfaces 401 distinctly. */
export async function verifyUpstashCredentials(creds: UpstashCredentials): Promise<void> {
  await listUpstashRedisDatabases(creds)
}
