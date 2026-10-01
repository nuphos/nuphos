import { describe, expect, test } from 'bun:test'

import { createDownloadHandoffRateLimitRoutes } from '@/routes/download-handoff-rate-limit'

import type { DownloadHandoffRateLimitResult } from '@/lib/download-handoff-rate-limit'

const SECRET = 'download-handoff-rate-limit-test-secret-123456'
const HASH = 'a'.repeat(64)

function request(
  result: DownloadHandoffRateLimitResult,
  init?: { secret?: string; body?: unknown },
) {
  const routes = createDownloadHandoffRateLimitRoutes({
    secret: SECRET,
    consume: () => Promise.resolve(result),
  })

  return routes.request('/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Download-Handoff-Secret': init?.secret ?? SECRET,
    },
    body: JSON.stringify(init?.body ?? { ipHash: HASH, recipientHash: HASH }),
  })
}

describe('download handoff rate-limit route', () => {
  test('accepts a valid server-to-server quota request', async () => {
    const response = await request('allowed')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ allowed: true })
  })

  test('rejects invalid credentials and raw identifiers', async () => {
    expect((await request('allowed', { secret: 'wrong' })).status).toBe(401)
    expect(
      (
        await request('allowed', {
          body: { ipHash: '203.0.113.5', recipientHash: 'person@example.com' },
        })
      ).status,
    ).toBe(400)
  })

  test('maps shared quota and Redis failures without sending permission', async () => {
    expect((await request('limited')).status).toBe(429)
    expect((await request('unavailable')).status).toBe(503)
  })
})
