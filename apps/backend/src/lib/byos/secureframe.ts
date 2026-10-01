import { decryptSecureframeSecret } from '@/lib/byos/secrets'

import type { SecureframeIntegrationBinding } from '@/models'

// Secureframe REST API (confirmed via the official secureframe-mcp-server and
// developer.secureframe.com). Auth is a static API key + secret pair passed as
// a single space-separated Authorization header — no OAuth, no token exchange.
// Responses follow the JSON:API spec.
const BASE_URL: Record<SecureframeIntegrationBinding['region'], string> = {
  us: 'https://api.secureframe.com',
  uk: 'https://api-uk.secureframe.com',
}
const FETCH_TIMEOUT_MS = 30_000

export class SecureframeApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SecureframeApiError'
  }
}

export type SecureframeCredentials = {
  region: SecureframeIntegrationBinding['region']
  apiKey: string
  apiSecret: string
}

export function credentialsFromBinding(
  binding: SecureframeIntegrationBinding,
): SecureframeCredentials {
  return {
    region: binding.region,
    apiKey: binding.apiKey,
    apiSecret: decryptSecureframeSecret(binding.encryptedApiSecret),
  }
}

async function secureframeGet(
  creds: SecureframeCredentials,
  path: string,
  query: Record<string, string | number>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL[creds.region]}${path}`)

  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
  const res = await fetch(url, {
    headers: {
      // Secureframe's two-token scheme: "<apiKey> <apiSecret>" (not Bearer).
      Authorization: `${creds.apiKey} ${creds.apiSecret}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!res.ok) {
    let detail = `HTTP ${String(res.status)}`

    try {
      const body = (await res.json()) as { error?: string; message?: string; errors?: unknown }

      detail = body.error || body.message || (body.errors ? JSON.stringify(body.errors) : detail)
    } catch {
      // ignore
    }
    throw new SecureframeApiError(res.status, `Secureframe API error: ${detail}`)
  }

  return res.json()
}

/** Verify a key/secret pair by issuing a cheap read; surfaces 401 distinctly. */
export async function verifySecureframeCredentials(creds: SecureframeCredentials): Promise<void> {
  await secureframeGet(creds, '/tests', { page: 1, per_page: 1 })
}

export type SecureframeTest = {
  id: string
  description: string | null
  healthStatus: string | null
  enabled: boolean | null
  /** Why the test is failing (Secureframe's `failure_message`). */
  failureMessage: string | null
  /** How to fix it (`detailed_remediation_steps`, falling back to
   *  `recommended_action`). */
  remediation: string | null
  /** Full attributes blob from the JSON:API record, for fields not normalized. */
  raw: Record<string, unknown>
}

// JSON:API responses wrap records as { data: [{ id, type, attributes }] }; some
// Secureframe list endpoints return a flat array. Handle both defensively.
function extractRecords(
  body: unknown,
): ({ id?: unknown; attributes?: unknown } & Record<string, unknown>)[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[]
  if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: Record<string, unknown>[] }).data
  }

  return []
}

function normalizeTest(
  record: { id?: unknown; attributes?: unknown } & Record<string, unknown>,
): SecureframeTest {
  const attrs = (
    record.attributes && typeof record.attributes === 'object'
      ? (record.attributes as Record<string, unknown>)
      : record
  ) as Record<string, unknown>
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

  return {
    id: typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : '',
    description: str(attrs.description) ?? str(attrs.title) ?? str(attrs.name),
    healthStatus: str(attrs.health_status) ?? str(attrs.status),
    enabled: typeof attrs.enabled === 'boolean' ? attrs.enabled : null,
    failureMessage: str(attrs.failure_message),
    remediation: str(attrs.detailed_remediation_steps) ?? str(attrs.recommended_action),
    raw: attrs,
  }
}

/**
 * List compliance tests, following pagination. `failingOnly` adds the Lucene
 * filter `health_status:fail` (the compliance issues to resolve); otherwise all
 * tests are returned.
 */
export async function listSecureframeTests(
  creds: SecureframeCredentials,
  opts: { failingOnly?: boolean; query?: string } = {},
): Promise<SecureframeTest[]> {
  const q = opts.query ?? (opts.failingOnly ? 'health_status:fail' : undefined)
  const out: SecureframeTest[] = []
  let page = 1

  // Hard page cap so a malformed paginator can't loop forever.
  for (; page <= 50; page++) {
    const query: Record<string, string | number> = { page, per_page: 100 }

    if (q) query.q = q
    const body = await secureframeGet(creds, '/tests', query)
    const records = extractRecords(body)

    out.push(...records.map(normalizeTest))
    if (records.length < 100) break
  }

  return out
}

/** List security controls, following pagination (used for framework coverage). */
export async function listSecureframeControls(
  creds: SecureframeCredentials,
  opts: { query?: string } = {},
): Promise<unknown[]> {
  const out: unknown[] = []
  let page = 1

  for (; page <= 50; page++) {
    const query: Record<string, string | number> = { page, per_page: 100 }

    if (opts.query) query.q = opts.query
    const body = await secureframeGet(creds, '/controls', query)
    const records = extractRecords(body)

    out.push(...records)
    if (records.length < 100) break
  }

  return out
}
