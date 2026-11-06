import { afterEach, describe, expect, mock, test } from 'bun:test'

import TELEMETRY_EVENTS from './events.json'
import { REPORT_FIELDS, buildHealthReport, sendHealthReport, setTelemetryEnabled } from './report'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

type Fields = { readonly [key: string]: string | Fields }

// Throws on any key or value type the allowlist does not name.
function assertAllowlisted(value: Record<string, unknown>, fields: Fields, path = ''): void {
  for (const [key, child] of Object.entries(value)) {
    const spec = fields[key]
    const at = `${path}${key}`

    if (spec === undefined) throw new Error(`${at} is not allowlisted`)
    if (spec === 'counts') {
      for (const [name, count] of Object.entries(child as Record<string, unknown>)) {
        if (!TELEMETRY_EVENTS.includes(name)) throw new Error(`${at}.${name} is not allowlisted`)
        expect(typeof count).toBe('number')
      }
    } else if (typeof spec === 'string') expect(`${at}: ${typeof child}`).toBe(`${at}: ${spec}`)
    else assertAllowlisted(child as Record<string, unknown>, spec, `${at}.`)
  }
}

describe('health report', () => {
  test('carries only allowlisted fields, and every one of them', async () => {
    const report = await buildHealthReport({ instanceId: 'instance-id', persisted: false }, 300, {
      events: { 'agent.local_runtime.tunnel_opened': 3 },
      activeUsers: 2,
      api: {
        requests: 10,
        errors4xx: 1,
        errors5xx: 0,
        latencyP50Ms: 5,
        latencyP95Ms: 9,
        latencyP99Ms: 12,
      },
    })

    assertAllowlisted(report, REPORT_FIELDS)
    expect(new Set(Object.keys(report))).toEqual(new Set(Object.keys(REPORT_FIELDS)))
    // No database in unit tests: the report still goes out, saying so.
    expect(report.dependencies.mongoOk).toBe(0)
    expect(report.instanceIdPersisted).toBe(0)
  })

  test('cannot be switched on without a key', async () => {
    await expect(setTelemetryEnabled(true)).rejects.toThrow('NUPHOS_TELEMETRY_KEY is not set')
  })

  test('the allowlist rejects a field it does not name', () => {
    expect(() => assertAllowlisted({ userId: 'u1' }, REPORT_FIELDS)).toThrow('not allowlisted')
    expect(() => assertAllowlisted({ events: { 'user@example.com': 1 } }, REPORT_FIELDS)).toThrow(
      'not allowlisted',
    )
  })

  test('retries a server error a bounded number of times, then gives up quietly', async () => {
    const fetchMock = mock(() => Promise.resolve(new Response('', { status: 503 })))
    const waits: number[] = []

    globalThis.fetch = fetchMock as unknown as typeof fetch

    expect(
      await sendHealthReport('{}', (ms) => {
        waits.push(ms)

        return Promise.resolve()
      }),
    ).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([5_000, 30_000])
  })

  test('does not retry a rejected key, and survives a network error', async () => {
    const rejected = mock(() => Promise.resolve(new Response('', { status: 401 })))

    globalThis.fetch = rejected as unknown as typeof fetch
    expect(await sendHealthReport('{}', () => Promise.resolve())).toBe(false)
    expect(rejected).toHaveBeenCalledTimes(1)

    globalThis.fetch = mock(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
    expect(await sendHealthReport('{}', () => Promise.resolve())).toBe(false)
  })

  test('reports delivery', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('', { status: 202 })),
    ) as unknown as typeof fetch

    expect(await sendHealthReport('{}')).toBe(true)
  })
})
