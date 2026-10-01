import { timingSafeEqual } from 'node:crypto'

import { Hono } from 'hono'

import { config } from '@/config'
import { consumeDownloadHandoffRateLimit } from '@/lib/download-handoff-rate-limit'

import type { DownloadHandoffRateLimitResult } from '@/lib/download-handoff-rate-limit'

const SHA256_HEX = /^[a-f0-9]{64}$/

type Dependencies = {
  secret?: string
  consume(input: { ipHash: string; recipientHash: string }): Promise<DownloadHandoffRateLimitResult>
}

export function createDownloadHandoffRateLimitRoutes(dependencies: Dependencies) {
  const routes = new Hono()

  routes.post('/', async (c) => {
    if (!dependencies.secret) return c.json({ error: 'not_configured' }, 503)

    const supplied = c.req.header('X-Download-Handoff-Secret') ?? ''

    if (!secretMatches(supplied, dependencies.secret)) {
      return c.json({ error: 'unauthorized' }, 401)
    }

    let body: unknown

    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_request' }, 400)
    }

    const input = parseInput(body)

    if (!input) return c.json({ error: 'invalid_request' }, 400)

    const result = await dependencies.consume(input)

    if (result === 'limited') return c.json({ error: 'rate_limited' }, 429)
    if (result === 'unavailable') return c.json({ error: 'limiter_unavailable' }, 503)

    return c.json({ allowed: true })
  })

  return routes
}

export const downloadHandoffRateLimitRoutes = createDownloadHandoffRateLimitRoutes({
  secret: config.downloadHandoff.rateLimitSecret,
  consume: consumeDownloadHandoffRateLimit,
})

function parseInput(value: unknown): { ipHash: string; recipientHash: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>

  if (typeof input.ipHash !== 'string' || !SHA256_HEX.test(input.ipHash)) return undefined
  if (typeof input.recipientHash !== 'string' || !SHA256_HEX.test(input.recipientHash)) {
    return undefined
  }

  return { ipHash: input.ipHash, recipientHash: input.recipientHash }
}

function secretMatches(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)

  return left.length === right.length && timingSafeEqual(left, right)
}
