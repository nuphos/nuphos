import { afterEach, describe, expect, test } from 'bun:test'

import { composioAuthConfigId } from './composio'

const realFetch = globalThis.fetch
let calls: { method: string; path: string; body: unknown }[]

afterEach(() => {
  globalThis.fetch = realFetch
})

/** Answers each request with the next response, recording it. */
function respond(...responses: { status?: number; body: unknown }[]) {
  calls = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(url instanceof Request ? url.url : url.toString())
    const next = responses[calls.length] ?? { status: 500, body: {} }

    calls.push({
      method: init?.method ?? 'GET',
      path: u.pathname.replace('/api/v3.1', '') + u.search,
      body: init?.body ? JSON.parse(init.body as string) : null,
    })

    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }) as typeof fetch
}

describe('composioAuthConfigId', () => {
  test('uses the oldest managed config, and asks Composio once per process', async () => {
    respond({
      body: {
        items: [
          { id: 'ac_new', created_at: '2026-10-02T00:00:00Z' },
          { id: 'ac_old', created_at: '2026-10-01T00:00:00Z' },
        ],
      },
    })

    expect(await composioAuthConfigId('gmail')).toBe('ac_old')
    expect(await composioAuthConfigId('gmail')).toBe('ac_old')
    expect(calls).toEqual([
      {
        method: 'GET',
        path: '/auth_configs?toolkit_slug=gmail&is_composio_managed=true&limit=200',
        body: null,
      },
    ])
  })

  test('creates one when there is none, then settles on the oldest after a concurrent create', async () => {
    respond(
      { body: { items: [] } },
      { status: 201, body: { auth_config: { id: 'ac_mine' } } },
      {
        body: {
          items: [
            { id: 'ac_mine', created_at: '2026-10-01T00:00:01Z' },
            { id: 'ac_theirs', created_at: '2026-10-01T00:00:00Z' },
          ],
        },
      },
    )

    expect(await composioAuthConfigId('trello')).toBe('ac_theirs')
    expect(calls[1]).toEqual({
      method: 'POST',
      path: '/auth_configs',
      body: { toolkit: { slug: 'trello' }, auth_config: { type: 'use_composio_managed_auth' } },
    })
  })

  test('does not remember a failure', async () => {
    respond({ status: 503, body: {} })
    await expect(composioAuthConfigId('googledrive')).rejects.toThrow('HTTP 503')

    respond({ body: { items: [{ id: 'ac_drive', created_at: '2026-10-01T00:00:00Z' }] } })
    expect(await composioAuthConfigId('googledrive')).toBe('ac_drive')
  })
})
