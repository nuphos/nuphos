import { PostHog } from 'posthog-node'

import { config } from '@/config'
import { logError, sanitizeProperties } from '@/lib/observability'

import type { ObservabilityProperties } from '@/lib/observability'
import type { Context } from 'hono'

type CaptureExceptionOptions = {
  source: string
  distinctId?: string | null
  context?: Context
  properties?: ObservabilityProperties
}

let client: PostHog | null | undefined

function getClient(): PostHog | null {
  if (!config.posthog.apiKey) return null
  if (client === undefined) {
    client = new PostHog(config.posthog.apiKey, {
      host: config.posthog.host,
      flushAt: 1,
      flushInterval: 5_000,
      disableGeoip: true,
      privacyMode: true,
      enableExceptionAutocapture: false,
    })
  }

  return client
}

function contextValue(context: Context | undefined, key: string): string | undefined {
  if (!context) return undefined
  const value = (context as Context & { get(name: string): unknown }).get(key)

  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function captureException(error: unknown, options: CaptureExceptionOptions): void {
  try {
    const posthog = getClient()

    if (!posthog) return

    const requestId = contextValue(options.context, 'requestId')
    const userId = options.distinctId ?? contextValue(options.context, 'userId')
    const teamId = contextValue(options.context, 'teamId')

    posthog.captureException(error, userId ?? 'atlas-backend', {
      source: options.source,
      ...(options.context
        ? {
            method: options.context.req.method,
            path: options.context.req.path,
          }
        : {}),
      ...(requestId ? { request_id: requestId } : {}),
      ...(teamId ? { team_id: teamId } : {}),
      ...sanitizeProperties(options.properties),
    })
  } catch (posthogError) {
    logError('posthog.capture_exception_failed', posthogError, { source: options.source })
  }
}

type CaptureEventOptions = {
  /** distinctId for the event. Falls back to context userId, then 'atlas-backend'. */
  distinctId?: string | null
  context?: Context
  properties?: ObservabilityProperties
}

/**
 * Capture a product/usage event. No-op when PostHog is unconfigured. Context
 * (when provided) contributes request_id / team_id / method / path so events
 * correlate with the originating HTTP request.
 */
export function capture(event: string, options: CaptureEventOptions = {}): void {
  try {
    const posthog = getClient()

    if (!posthog) return

    const requestId = contextValue(options.context, 'requestId')
    const userId = options.distinctId ?? contextValue(options.context, 'userId')
    const teamId = contextValue(options.context, 'teamId')

    posthog.capture({
      event,
      distinctId: userId ?? 'atlas-backend',
      properties: {
        $process_person_profile: userId != null,
        ...(options.context
          ? {
              method: options.context.req.method,
              path: options.context.req.path,
            }
          : {}),
        ...(requestId ? { request_id: requestId } : {}),
        ...(teamId ? { team_id: teamId } : {}),
        ...sanitizeProperties(options.properties),
      },
    })
  } catch (posthogError) {
    logError('posthog.capture_event_failed', posthogError, { event })
  }
}

/**
 * Attach identifying properties (email, name, …) to a user's person profile.
 * Safe to call repeatedly; PostHog merges $set properties. No-op when
 * unconfigured.
 */
export function identify(distinctId: string, properties?: ObservabilityProperties): void {
  try {
    const posthog = getClient()

    if (!posthog || !distinctId) return
    posthog.identify({
      distinctId,
      properties: sanitizeProperties(properties),
    })
  } catch (posthogError) {
    logError('posthog.identify_failed', posthogError, { distinct_id: distinctId })
  }
}

export async function shutdownPostHog(timeoutMs = 2_000): Promise<void> {
  try {
    await client?.shutdown(timeoutMs)
  } catch (posthogError) {
    logError('posthog.shutdown_failed', posthogError)
  } finally {
    client = null
  }
}
