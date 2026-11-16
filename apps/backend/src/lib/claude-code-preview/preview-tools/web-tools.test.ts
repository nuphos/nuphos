import { describe, expect, test } from 'bun:test'

import { webToolModule } from './web-tools'

const ctx = { userId: 'user-1', teamId: 'team-1', sessionId: 'conv-1', locale: 'en' }

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
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, init: init ?? {} })
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
      expect(headers.get('X-Keenable-Session-Id')).toBe('conv-1')
    } finally {
      globalThis.fetch = previous
    }
  })

  test('web_fetch uses the keyed endpoint when KEENABLE_API_KEY is set', async () => {
    const previous = globalThis.fetch
    const calls: { url: string; init: RequestInit }[] = []

    globalThis.fetch = (async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, init: init ?? {} })
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
})
