import { AppError } from '@/lib/errors'
import { canonicalize, sha256Hex } from '@/lib/journal'
import { normalizeComplianceTimestamp } from '@/lib/journal/compliance-export'

export const MAX_EVENTS = 5000
export const LIST_MAX_EVENTS = 100
export const LIST_MAX_CONVERSATIONS = 50
export const EXPORT_MAX_SESSIONS = 250
export const EXPORT_MAX_AGENT_EVENTS = 100_000
export const EXPORT_MAX_RESOURCE_EVENTS = 10_000

// contentHot is the hash-exempt display copy; the server recomputes its hash
// against payload.contentHash on every read so every surface that shows it can
// mark items verified/divergent without client-side crypto.
function stableSerialize(value: unknown, alg: 'jcs' | 'json'): string {
  if (alg === 'jcs') {
    try {
      return canonicalize(value)
    } catch {
      /* fall through */
    }
  }

  return JSON.stringify(value) ?? String(value)
}

export function normalizeRangeTimestamp(label: string, value: string | undefined): string | null {
  try {
    return normalizeComplianceTimestamp(value ?? null)
  } catch {
    throw new AppError(400, 'invalid_request', `${label} must be an ISO-8601 timestamp`)
  }
}

export function contentMatches(contentHot: unknown, payload: unknown): boolean | null {
  const p = payload as { contentHash?: string; hashAlg?: 'jcs' | 'json' } | null

  if (!p || typeof p !== 'object' || typeof p.contentHash !== 'string') return null

  return sha256Hex(stableSerialize(contentHot, p.hashAlg ?? 'jcs')) === p.contentHash
}
