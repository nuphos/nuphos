// otel/index.ts — single public entrypoint.
//
// `setupTelemetry()` MUST be called before any other module imports
// `globalThis.fetch`, `mongo`, or `getRedis()` in a way that triggers their
// creation — the fetch patch only takes effect for callers resolved after the
// patch, so importing this module first from `src/index.ts` is essential.

import { instrumentGlobalFetch } from '@/otel/instrumentation/fetch'
import { instrumentRuntime } from '@/otel/instrumentation/runtime'
import { startTelemetry } from '@/otel/sdk'

import type { TelemetryShutdown } from '@/otel/sdk'

export async function setupTelemetry(): Promise<{
  shutdown: TelemetryShutdown
}> {
  const { shutdown } = startTelemetry()

  instrumentGlobalFetch()
  await instrumentRuntime()

  return { shutdown }
}

export { log } from '@/otel/log'
export { getTracer, getMeter, getLogger } from '@/otel/api'
export { metricsRegistry } from '@/otel/metrics'
export { otelHono } from '@/otel/hono'
