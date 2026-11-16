const DEFAULT_BASE_URL = 'https://api.keenable.ai'
const DEFAULT_TITLE = 'nuphos'
const DEFAULT_MAX_RESULTS = 10
const MAX_RESULTS_CAP = 50
const MAX_FETCH_CHARS = 50_000
const REQUEST_TIMEOUT_MS = 30_000

export type KeenableRequestOptions = {
  apiKey?: string
  baseUrl?: string
  title?: string
  fetchImpl?: typeof fetch
}

export type KeenableSearchHit = {
  title: string
  url: string
  snippet: string
  published_at?: string
}

export type KeenableSearchResult = {
  query: string
  results: KeenableSearchHit[]
}

export type KeenableFetchResult = {
  url: string
  title?: string
  content: string
  truncated?: boolean
}

export type KeenableSearchArgs = {
  query: string
  max_results?: number
  site?: string
  published_after?: string
}

export type KeenableFetchArgs = {
  url: string
  live?: boolean
  prompt?: string
  max_chars?: number
}

export function clampMaxResults(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_MAX_RESULTS
  return Math.min(MAX_RESULTS_CAP, Math.max(1, Math.trunc(value)))
}

export function clampMaxChars(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return MAX_FETCH_CHARS
  return Math.min(MAX_FETCH_CHARS, Math.max(1, Math.trunc(value)))
}

function rootUrl(baseUrl?: string): string {
  return (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function headers(options: KeenableRequestOptions, jsonBody: boolean): Record<string, string> {
  const out: Record<string, string> = { Accept: 'application/json' }

  if (jsonBody) out['Content-Type'] = 'application/json'
  if (options.apiKey) {
    out['X-API-Key'] = options.apiKey
    return out
  }
  out['X-Keenable-Title'] = options.title ?? DEFAULT_TITLE
  return out
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text()

  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown; code?: unknown }
    const parts = [body.error, body.message, body.code].filter(
      (part): part is string => typeof part === 'string' && part.length > 0,
    )

    if (parts.length > 0) return `Keenable ${String(response.status)}: ${parts.join(': ')}`
  } catch {
    // Body was not JSON; fall through to the raw text.
  }

  const trimmed = text.trim().slice(0, 200)

  return `Keenable ${String(response.status)}: ${trimmed || response.statusText}`
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(await errorMessage(response))

  return response.json() as Promise<unknown>
}

function hitFrom(raw: unknown): KeenableSearchHit | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const url = typeof row.url === 'string' ? row.url : ''

  if (!url) return null
  const title = typeof row.title === 'string' && row.title ? row.title : url
  const snippet =
    (typeof row.snippet === 'string' && row.snippet) ||
    (typeof row.description === 'string' && row.description) ||
    ''
  const hit: KeenableSearchHit = { title, url, snippet }

  if (typeof row.published_at === 'string' && row.published_at) hit.published_at = row.published_at
  return hit
}

export async function keenableSearch(
  args: KeenableSearchArgs,
  options: KeenableRequestOptions = {},
): Promise<KeenableSearchResult> {
  const query = args.query.trim()

  if (!query) throw new Error('query is required')
  const url = options.apiKey
    ? `${rootUrl(options.baseUrl)}/v1/search`
    : `${rootUrl(options.baseUrl)}/v1/search/public`
  const body: Record<string, unknown> = {
    query,
    max_results: clampMaxResults(args.max_results),
  }

  if (args.site) body.site = args.site
  if (args.published_after) body.published_after = args.published_after
  const response = await (options.fetchImpl ?? fetch)(url, {
    method: 'POST',
    headers: headers(options, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = (await readJson(response)) as { query?: unknown; results?: unknown }
  const results = Array.isArray(payload.results)
    ? payload.results.map(hitFrom).filter((hit): hit is KeenableSearchHit => hit !== null)
    : []

  return {
    query: typeof payload.query === 'string' ? payload.query : query,
    results,
  }
}

export async function keenableFetch(
  args: KeenableFetchArgs,
  options: KeenableRequestOptions = {},
): Promise<KeenableFetchResult> {
  const page = args.url.trim()

  if (!page) throw new Error('url is required')
  const endpoint = options.apiKey
    ? `${rootUrl(options.baseUrl)}/v1/fetch`
    : `${rootUrl(options.baseUrl)}/v1/fetch/public`
  const target = new URL(endpoint)

  target.searchParams.set('url', page)
  const maxChars = clampMaxChars(args.max_chars)

  if (args.live) target.searchParams.set('live', 'true')
  if (args.prompt) target.searchParams.set('prompt', args.prompt)
  target.searchParams.set('max_chars', String(maxChars))
  const response = await (options.fetchImpl ?? fetch)(target, {
    method: 'GET',
    headers: headers(options, false),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = (await readJson(response)) as Record<string, unknown>
  const content =
    (typeof payload.content === 'string' && payload.content) ||
    (typeof payload.markdown === 'string' && payload.markdown) ||
    ''
  let truncated = typeof payload.truncated === 'boolean' ? payload.truncated : undefined
  let body = content

  if (body.length > maxChars) {
    body = body.slice(0, maxChars)
    truncated = true
  }
  const result: KeenableFetchResult = {
    url: typeof payload.url === 'string' ? payload.url : page,
    content: body,
  }

  if (typeof payload.title === 'string' && payload.title) result.title = payload.title
  if (typeof truncated === 'boolean') result.truncated = truncated
  return result
}
