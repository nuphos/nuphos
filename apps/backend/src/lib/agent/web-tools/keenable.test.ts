import { describe, expect, test } from 'bun:test'

import {
  clampMaxResults,
  keenableFetch,
  keenableSearch,
  type KeenableRequestOptions,
} from './keenable'

type MockRequest = { url: string; init: RequestInit }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockFetch(handler: (request: MockRequest) => Response | Promise<Response>) {
  const calls: MockRequest[] = []
  const fetchImpl: typeof fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const request = { url, init: init ?? {} }

    calls.push(request)
    return handler(request)
  }) as typeof fetch

  return { fetchImpl, calls }
}

const searchHits = {
  query: 'nuphos',
  results: [
    {
      title: 'Nuphos',
      url: 'https://github.com/nuphos/nuphos',
      snippet: 'Open-source Grok Bot alternative',
      published_at: '2026-01-01T00:00:00Z',
    },
    { url: 'https://example.com/empty-title', description: 'fallback text' },
  ],
}

describe('clampMaxResults', () => {
  test('defaults and clamps to the documented 1-50 range', () => {
    expect(clampMaxResults(undefined)).toBe(10)
    expect(clampMaxResults(0)).toBe(1)
    expect(clampMaxResults(3.9)).toBe(3)
    expect(clampMaxResults(50)).toBe(50)
    expect(clampMaxResults(99)).toBe(50)
  })
})

describe('keenableSearch', () => {
  test('calls the public endpoint with X-Keenable-Title and no API key', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(searchHits))
    const result = await keenableSearch(
      { query: 'nuphos', max_results: 2, site: 'github.com', published_after: '7d' },
      { fetchImpl, sessionId: 'conv-1' },
    )
    const request = calls[0]!
    const headers = new Headers(request.init.headers)
    const body = JSON.parse(String(request.init.body)) as Record<string, unknown>

    expect(request.url).toBe('https://api.keenable.ai/v1/search/public')
    expect(request.init.method).toBe('POST')
    expect(headers.get('X-Keenable-Title')).toBe('nuphos')
    expect(headers.get('X-API-Key')).toBeNull()
    expect(headers.get('X-Keenable-Session-Id')).toBe('conv-1')
    expect(body).toEqual({
      query: 'nuphos',
      max_results: 2,
      site: 'github.com',
      published_after: '7d',
    })
    expect(result.results).toEqual([
      {
        title: 'Nuphos',
        url: 'https://github.com/nuphos/nuphos',
        snippet: 'Open-source Grok Bot alternative',
        published_at: '2026-01-01T00:00:00Z',
      },
      {
        title: 'https://example.com/empty-title',
        url: 'https://example.com/empty-title',
        snippet: 'fallback text',
      },
    ])
  })

  test('keyed calls use /v1/search with X-API-Key and omit the title header', async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse({ results: [] }))
    await keenableSearch({ query: 'nuphos' }, { apiKey: 'k_test', fetchImpl, title: 'ignored' })
    const headers = new Headers(calls[0]!.init.headers)

    expect(calls[0]!.url).toBe('https://api.keenable.ai/v1/search')
    expect(headers.get('X-API-Key')).toBe('k_test')
    expect(headers.get('X-Keenable-Title')).toBeNull()
  })

  test('rejects an empty query and surfaces API errors', async () => {
    await expect(keenableSearch({ query: '  ' })).rejects.toThrow('query is required')
    const { fetchImpl } = mockFetch(() =>
      jsonResponse({ error: 'missing_app_title', message: 'X-Keenable-Title is required' }, 400),
    )

    await expect(keenableSearch({ query: 'nuphos' }, { fetchImpl })).rejects.toThrow(
      'Keenable 400: missing_app_title: X-Keenable-Title is required',
    )
  })
})

describe('keenableFetch', () => {
  test('calls the public fetch endpoint with the title header', async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      jsonResponse({
        url: 'https://keenable.ai/',
        title: 'Keenable',
        content: 'Independent web search API',
        truncated: false,
      }),
    )
    const result = await keenableFetch(
      { url: 'https://keenable.ai', live: true, prompt: 'Summarize', max_chars: 1000 },
      { fetchImpl },
    )
    const target = new URL(calls[0]!.url)
    const headers = new Headers(calls[0]!.init.headers)

    expect(target.origin + target.pathname).toBe('https://api.keenable.ai/v1/fetch/public')
    expect(target.searchParams.get('url')).toBe('https://keenable.ai')
    expect(target.searchParams.get('live')).toBe('true')
    expect(target.searchParams.get('prompt')).toBe('Summarize')
    expect(target.searchParams.get('max_chars')).toBe('1000')
    expect(headers.get('X-Keenable-Title')).toBe('nuphos')
    expect(headers.get('X-API-Key')).toBeNull()
    expect(result).toEqual({
      url: 'https://keenable.ai/',
      title: 'Keenable',
      content: 'Independent web search API',
      truncated: false,
    })
  })

  test('keyed fetch uses /v1/fetch and X-API-Key only', async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      jsonResponse({ url: 'https://example.com', content: 'ok' }),
    )
    await keenableFetch({ url: 'https://example.com' }, { apiKey: 'k_test', fetchImpl })
    const headers = new Headers(calls[0]!.init.headers)

    expect(new URL(calls[0]!.url).pathname).toBe('/v1/fetch')
    expect(headers.get('X-API-Key')).toBe('k_test')
    expect(headers.get('X-Keenable-Title')).toBeNull()
  })

  test('rejects a missing url and maps a 404', async () => {
    await expect(keenableFetch({ url: '' })).rejects.toThrow('url is required')
    const { fetchImpl } = mockFetch(() => jsonResponse({ message: 'Not Found' }, 404))

    await expect(
      keenableFetch({ url: 'https://example.com/missing' }, { fetchImpl }),
    ).rejects.toThrow(
      'Keenable 404: Not Found',
    )
  })
})

const live = process.env.KEENABLE_LIVE === '1'

describe.skipIf(!live)('keenable live keyless', () => {
  const options: KeenableRequestOptions = { title: 'nuphos' }

  test(
    'search/public returns results',
    async () => {
      const result = await keenableSearch(
        { query: 'Open-source Grok Bot alternative', max_results: 2 },
        options,
      )

      expect(result.results.length).toBeGreaterThan(0)
      expect(result.results[0]?.url).toMatch(/^https?:\/\//)
      expect(result.results[0]?.snippet.length).toBeGreaterThan(0)
    },
    { timeout: 20_000 },
  )

  test(
    'fetch/public returns page content',
    async () => {
      const page = await keenableFetch({ url: 'https://keenable.ai' }, options)

      expect(page.content.length).toBeGreaterThan(0)
      expect(page.url).toContain('keenable.ai')
    },
    { timeout: 20_000 },
  )
})
