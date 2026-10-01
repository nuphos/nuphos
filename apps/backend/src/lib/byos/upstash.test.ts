import { afterEach, describe, expect, test } from 'bun:test'

import { listUpstashRedisDatabases, UpstashApiError } from './upstash'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFetch(status: number, body: string, capture?: (req: Request) => void) {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    capture?.(new Request(input as string, init))

    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

const CREDS = { email: 'ops@acme.com', apiKey: 'key-123' }

describe('listUpstashRedisDatabases', () => {
  test('calls the v2 endpoint with HTTP Basic auth built from email:apiKey', async () => {
    let seen: Request | undefined

    stubFetch(200, '[]', (req) => {
      seen = req
    })

    await listUpstashRedisDatabases(CREDS)

    expect(seen?.url).toBe('https://api.upstash.com/v2/redis/databases')
    const expected = `Basic ${Buffer.from('ops@acme.com:key-123').toString('base64')}`

    expect(seen?.headers.get('authorization')).toBe(expected)
  })

  test('normalizes a database, converting unix creation_time to ISO', async () => {
    stubFetch(
      200,
      JSON.stringify([
        {
          database_id: 'db-1',
          database_name: 'prod-cache',
          region: 'global',
          state: 'active',
          endpoint: 'x.upstash.io',
          port: 6379,
          tls: true,
          primary_region: 'us-east-1',
          read_regions: ['eu-west-1'],
          database_type: 'Pay as You Go',
          creation_time: 1_700_000_000,
        },
      ]),
    )

    const [db] = await listUpstashRedisDatabases(CREDS)

    expect(db).toEqual({
      id: 'db-1',
      name: 'prod-cache',
      region: 'global',
      type: 'Pay as You Go',
      state: 'active',
      endpoint: 'x.upstash.io',
      port: 6379,
      tls: true,
      primaryRegion: 'us-east-1',
      readRegions: ['eu-west-1'],
      createdAt: new Date(1_700_000_000 * 1000).toISOString(),
    })
  })

  test('fills nullable fields when Upstash omits them', async () => {
    stubFetch(200, JSON.stringify([{ database_id: 'db-2' }]))

    const [db] = await listUpstashRedisDatabases(CREDS)

    // name falls back to the id so the UI never renders a blank row.
    expect(db!.name).toBe('db-2')
    expect(db!.region).toBeNull()
    expect(db!.port).toBeNull()
    expect(db!.createdAt).toBeNull()
    expect(db!.readRegions).toEqual([])
  })

  test('surfaces the JSON error field on 401 so the bind route can map it', async () => {
    // Verbatim body the live API returns for a bad key.
    stubFetch(401, '{"error":"Unauthorized"}')

    const err = (await listUpstashRedisDatabases(CREDS).catch((e: unknown) => e)) as UpstashApiError

    expect(err).toBeInstanceOf(UpstashApiError)
    expect(err.status).toBe(401)
    expect(err.message).toBe('Upstash API error: Unauthorized')
  })

  test('falls back to the raw body when the error is not JSON', async () => {
    stubFetch(500, 'upstream exploded')

    const err = (await listUpstashRedisDatabases(CREDS).catch((e: unknown) => e)) as UpstashApiError

    expect(err.status).toBe(500)
    expect(err.message).toBe('Upstash API error: upstream exploded')
  })

  test('tolerates a null body instead of an array', async () => {
    stubFetch(200, 'null')
    expect(await listUpstashRedisDatabases(CREDS)).toEqual([])
  })
})
