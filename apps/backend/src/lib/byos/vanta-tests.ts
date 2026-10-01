import { API_BASE, FETCH_TIMEOUT_MS, VantaApiError } from '@/lib/byos/vanta-core'

// ── Vanta REST reads ───────────────────────────────────────────────────────

export type VantaTest = {
  id: string
  name: string
  category: string
  status: string
  failureDescription: string | null
  remediationDescription: string | null
  lastTestRunDate: string | null
}

// Human-readable categories (the `category` field is returned as display text,
// not the enum) that map to infrastructure-facing compliance posture.
export const VANTA_INFRA_CATEGORIES = new Set([
  'Infrastructure',
  'Vulnerability management',
  'Logging',
  'Monitoring & alerts',
  'Data storage',
])

async function vantaGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!res.ok) {
    let detail = `HTTP ${String(res.status)}`

    try {
      const body = (await res.json()) as { message?: string; error?: string }

      detail = body.message || body.error || detail
    } catch {
      // ignore
    }
    throw new VantaApiError(res.status, `Vanta API error: ${detail}`)
  }

  return res.json() as Promise<T>
}

type RawTestPage = {
  results: {
    data: {
      id: string
      name: string
      category: string
      status: string
      failureDescription?: string | null
      remediationDescription?: string | null
      lastTestRunDate?: string | null
    }[]
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}

/**
 * List tests for the org, following pagination. `statusFilter` (e.g.
 * 'NEEDS_ATTENTION') is passed through to the API; category filtering is done
 * client-side on the human-readable category (the API's categoryFilter enum is
 * separate from the returned display string, so we don't rely on it).
 */
export async function listVantaTests(
  token: string,
  opts: { statusFilter?: string; infraOnly?: boolean } = {},
): Promise<VantaTest[]> {
  const out: VantaTest[] = []
  let cursor: string | null = null

  do {
    const params = new URLSearchParams({ pageSize: '100' })

    if (opts.statusFilter) params.set('statusFilter', opts.statusFilter)
    if (cursor) params.set('pageCursor', cursor)
    const page: RawTestPage = await vantaGet<RawTestPage>(token, `/v1/tests?${params.toString()}`)

    for (const t of page.results.data) {
      out.push({
        id: t.id,
        name: t.name,
        category: t.category,
        status: t.status,
        failureDescription: t.failureDescription ?? null,
        remediationDescription: t.remediationDescription ?? null,
        lastTestRunDate: t.lastTestRunDate ?? null,
      })
    }
    cursor = page.results.pageInfo.hasNextPage ? page.results.pageInfo.endCursor : null
  } while (cursor)

  return opts.infraOnly ? out.filter((t) => VANTA_INFRA_CATEGORIES.has(t.category)) : out
}
