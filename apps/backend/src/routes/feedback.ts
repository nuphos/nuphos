import { Hono } from 'hono'

import { feedbackRequestSchema } from '@/lib/api/feedback'
import { consumeFeedbackRateLimit, saveFeedbackReport } from '@/lib/feedback'
import { zv } from '@/lib/validate'

import type { FeedbackRateLimitResult, FeedbackReport } from '@/lib/feedback'

type Dependencies = {
  consume(clientIp: string): Promise<FeedbackRateLimitResult>
  save(report: FeedbackReport, ip: string): Promise<{ id: string }>
}

// Public, unauthenticated: any person or agent can report a Nuphos bug or
// request a feature. Contract lives in lib/api/feedback.ts (/openapi.json).
export function createFeedbackRoutes(dependencies: Dependencies) {
  const routes = new Hono()

  routes.post('/', zv('json', feedbackRequestSchema), async (c) => {
    const ip = clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For'))
    const result = await dependencies.consume(ip)

    if (result === 'limited') return c.json({ error: 'rate_limited' }, 429)
    if (result === 'unavailable') return c.json({ error: 'limiter_unavailable' }, 503)

    return c.json(await dependencies.save(c.req.valid('json'), ip))
  })

  return routes
}

export const feedbackRoutes = createFeedbackRoutes({
  consume: consumeFeedbackRateLimit,
  save: saveFeedbackReport,
})

// Hosted Nuphos sits behind Cloudflare, which sets CF-Connecting-IP. The origin
// is also reachable directly, so the value is advisory: a caller bypassing
// Cloudflare can forge it. Without Cloudflare (self-hosted) fall back to the
// right-most X-Forwarded-For hop. The global quota bounds either case.
function clientIp(cfConnectingIp: string | undefined, forwardedFor: string | undefined): string {
  const candidates = [cfConnectingIp, ...(forwardedFor?.split(',').toReversed() ?? [])]

  return candidates.map((value) => value?.trim()).find(Boolean) ?? 'unknown'
}
