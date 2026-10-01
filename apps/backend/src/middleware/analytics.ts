import { identify } from '@/lib/posthog'

import type { MiddlewareHandler } from 'hono'

// Identify each user at most once per process lifetime so we attach email/name
// to their PostHog person profile without sending a $set on every request.
const identifiedUsers = new Set<string>()

function identifyOnce(c: Parameters<MiddlewareHandler>[0]): void {
  const userId = c.get('userId') as string | undefined

  if (!userId || identifiedUsers.has(userId)) return
  identifiedUsers.add(userId)
  identify(userId, {
    email: c.get('userEmail') as string | undefined,
    name: c.get('userName') as string | undefined,
  })
}

/**
 * Attaches PostHog person identity (email/name) for the requesting user.
 *
 * Deliberately emits NO per-request event: request telemetry (route, status,
 * latency) is OTel's job — otelHono ships it to the collector and Grafana —
 * and mirroring it into PostHog as `api_request` events was ~90% of our
 * billable event volume with zero insights built on it (NUPS-646).
 */
export const analyticsMiddleware: MiddlewareHandler = async (c, next) => {
  try {
    await next()
  } finally {
    // Runs after next() so route-level auth has populated userId.
    identifyOnce(c)
  }
}
