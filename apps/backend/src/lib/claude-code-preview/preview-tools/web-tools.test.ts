import { describe, expect, test } from 'bun:test'

import { webToolModule } from './web-tools'

const ctx = { userId: 'user-1', teamId: 'team-1', sessionId: 'conv-1', locale: 'en' }

function requestUrl(input: string | URL | { url: string }): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href

  return input.url
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('webToolModule', () => {
  test('advertises no tools until a provider is opted in', () => {
    const module = webToolModule({})

    expect(module.definitions).toEqual([])
    expect(Object.keys(module.handlers(ctx))).toEqual([])
  })

  test('registers only the opted-in Keenable tools', () => {
    const searchOnly = webToolModule({ webSearchProvider: 'keenable' })
    const both = webToolModule({ webSearchProvider: 'keenable', webFetchProvider: 'keenable' })

    expect(searchOnly.definitions.map((tool) => (tool as { name: string }).name)).toEqual([
      'web_search',
    ])
    expect(Object.keys(searchOnly.handlers(ctx))).toEqual(['web_search'])
    expect(both.definitions.map((tool) => (tool as { name: string }).name)).toEqual([
      'web_search',
      'web_fetch',
    ])
  })

  test('ignores an unimplemented provider value', () => {
    const module = webToolModule({ webSearchProvider: 'tavily', webFetchProvider: 'firecrawl' })

    expect(module.definitions).toEqual([])
  })

  test('web_search rejects bad input and returns Keenable results', async () => {
    const previous = globalThis.fetch
    const calls: { url: string; init: RequestInit }[] = []

    globalThis.fetch = (async (input, init) => {
      calls.push({ url: requestUrl(input), init: init ?? {} })

      return jsonResponse({
        query: 'nuphos',
        results: [
          {
            title: 'Nuphos',
            url: 'https://github.com/nuphos/nuphos',
            snippet: 'Grok Bot alternative',
          },
        ],
      })
    }) as typeof fetch
    const handlers = webToolModule({ webSearchProvider: 'keenable' }).handlers(ctx)

    try {
      const invalid = await handlers.web_search!({})

      expect(invalid.isError).toBe(true)
      const result = await handlers.web_search!({ query: 'nuphos', max_results: 3 })
      const headers = new Headers(calls[0]!.init.headers)

      expect(result.isError).toBeUndefined()
      expect(result.structuredContent).toMatchObject({
        results: [{ title: 'Nuphos', url: 'https://github.com/nuphos/nuphos' }],
      })
      expect(calls[0]!.url).toBe('https://api.keenable.ai/v1/search/public')
      expect(headers.get('X-Keenable-Title')).toBe('nuphos')
      expect(headers.get('X-Keenable-Session-Id')).toBeNull()
    } finally {
      globalThis.fetch = previous
    }
  })

  test('web_fetch uses the keyed endpoint when KEENABLE_API_KEY is set', async () => {
    const previous = globalThis.fetch
    const calls: { url: string; init: RequestInit }[] = []

    globalThis.fetch = (async (input, init) => {
      calls.push({ url: requestUrl(input), init: init ?? {} })

      return jsonResponse({ url: 'https://keenable.ai/', title: 'Keenable', content: 'ok' })
    }) as typeof fetch
    const handlers = webToolModule({
      webFetchProvider: 'keenable',
      keenableApiKey: 'k_test',
    }).handlers(ctx)

    try {
      const result = await handlers.web_fetch!({ url: 'https://keenable.ai' })
      const headers = new Headers(calls[0]!.init.headers)

      expect(result.structuredContent).toMatchObject({ title: 'Keenable', content: 'ok' })
      expect(new URL(calls[0]!.url).pathname).toBe('/v1/fetch')
      expect(headers.get('X-API-Key')).toBe('k_test')
      expect(headers.get('X-Keenable-Title')).toBeNull()
    } finally {
      globalThis.fetch = previous
    }
  })

  test('registered handlers run web_search then web_fetch together', async () => {
    const previous = globalThis.fetch
    const calls: { url: string; init: RequestInit }[] = []

    globalThis.fetch = (async (input, init) => {
      const url = requestUrl(input)

      calls.push({ url, init: init ?? {} })
      if (url.includes('/v1/search')) {
        return jsonResponse({
          query: 'nuphos',
          results: [
            {
              title: 'Nuphos',
              url: 'https://github.com/nuphos/nuphos',
              snippet: 'Grok Bot alternative',
            },
          ],
        })
      }

      return jsonResponse({
        url: 'https://github.com/nuphos/nuphos',
        title: 'nuphos/nuphos',
        content: 'readme text',
        truncated: false,
      })
    }) as typeof fetch
    const module = webToolModule({ webSearchProvider: 'keenable', webFetchProvider: 'keenable' })
    const handlers = module.handlers(ctx)

    try {
      expect(module.definitions.map((tool) => (tool as { name: string }).name)).toEqual([
        'web_search',
        'web_fetch',
      ])
      const search = await handlers.web_search!({ query: 'nuphos', max_results: 1 })
      const hit = (search.structuredContent as { results: { url: string }[] }).results[0]!
      const page = await handlers.web_fetch!({ url: hit.url, max_chars: 2000 })

      expect(search.isError).toBeUndefined()
      expect(page.isError).toBeUndefined()
      expect(calls[0]!.url).toBe('https://api.keenable.ai/v1/search/public')
      expect(new URL(calls[1]!.url).pathname).toBe('/v1/fetch/public')
      expect(page.structuredContent).toMatchObject({
        title: 'nuphos/nuphos',
        content: 'readme text',
      })
    } finally {
      globalThis.fetch = previous
    }
  })

  test('web_search returns a tool error when Keenable rejects published_after', async () => {
    const previous = globalThis.fetch

    globalThis.fetch = (async () =>
      jsonResponse(
        {
          error: 'invalid_parameter',
          message: 'published_after must be a date, timestamp, or relative offset',
        },
        400,
      )) as typeof fetch
    const handlers = webToolModule({ webSearchProvider: 'keenable' }).handlers(ctx)

    try {
      const result = await handlers.web_search!({ query: 'nuphos', published_after: 'bogus' })

      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('published_after must be a date')
      expect(JSON.stringify(result)).not.toContain('invalid_parameter')
    } finally {
      globalThis.fetch = previous
    }
  })

  test('web_fetch rejects non-http(s) URLs before calling the provider', async () => {
    const handlers = webToolModule({ webFetchProvider: 'keenable' }).handlers(ctx)
    const result = await handlers.web_fetch!({ url: 'ftp://example.com/readme' })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('http or https')
  })
})

const live = process.env.KEENABLE_LIVE === '1'

describe.skipIf(!live)('web tools live through the MCP handlers', () => {
  test(
    'web_search then web_fetch return real pages',
    async () => {
      const module = webToolModule({ webSearchProvider: 'keenable', webFetchProvider: 'keenable' })
      const handlers = module.handlers(ctx)
      const search = await handlers.web_search!({
        query: 'Open-source Grok Bot alternative',
        max_results: 2,
      })

      expect(search.isError).toBeUndefined()
      const hits = (search.structuredContent as { results: { url: string; title: string }[] })
        .results

      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0]?.url).toMatch(/^https?:\/\//)
      const page = await handlers.web_fetch!({ url: hits[0]!.url, max_chars: 2000 })

      expect(page.isError).toBeUndefined()
      const content = (page.structuredContent as { content: string; truncated?: boolean }).content

      expect(content.length).toBeGreaterThan(0)
    },
    { timeout: 30_000 },
  )
})
