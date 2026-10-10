import { inspect } from 'node:util'

import { initLogger } from 'braintrust'

import { config } from '@/config'
import { trimUnderscores } from '@/lib/agent/text-scan'
import { sanitizeProperties } from '@/lib/observability'
import { getTracer } from '@/otel/api'

import { vendorParent } from '../trace-store/span'

import type { Attributes, Context as OtelContext } from '@opentelemetry/api'

export const enabled =
  Boolean(config.agent.braintrustApiKey) && config.agent.braintrustTracingEnabled
// `aiTelemetry()` previously only flipped on for Braintrust. With OTel wired
// up as a peer pipeline we also want experimental_telemetry enabled whenever
// OTel is on so the AI SDK emits spans against the global tracer provider.
// Metrics-only mode also needs spans because GenAIMetricsSpanProcessor reads
// gen_ai.* attributes off the AI SDK's span onEnd to mint the metrics.
export const otelEnabled =
  config.otel.enabled && (config.otel.traces.enabled || config.otel.metrics.enabled)

if (enabled) {
  initLogger({
    projectName: config.agent.braintrustProjectName,
    apiKey: config.agent.braintrustApiKey,
    asyncFlush: true,
  })
}

// Lightweight span surface so callers do not have to know which tracing sinks
// are enabled. The implementation can write Braintrust, OTel, or both.
export type SpanLike = {
  export: () => Promise<string>
  end: () => number
  log: (event: {
    input?: unknown
    output?: unknown
    metadata?: Record<string, unknown>
    metrics?: Record<string, number>
    error?: unknown
  }) => void
  /**
   * A named point-in-time event on the OTel span. `log()` also reaches Tempo,
   * but every call lands under the same `agent.span.log` name with the real
   * event buried in an attribute — you cannot filter a trace by it. This keeps
   * the lifecycle event's own name, which is the difference between "find every
   * turn that hit the stall watchdog" being a query and being a grep.
   */
  event: (name: string, attrs?: Record<string, unknown>) => void
}

export const noopSpan: SpanLike = {
  export: async () => '',
  end: () => Date.now() / 1000,
  log: () => {},
  event: () => {},
}
export const agentTracer = getTracer('agent')
const exportedOtelParents = new Map<string, { context: OtelContext; createdAt: number }>()
const EXPORTED_OTEL_PARENT_MAX = 5_000
const EXPORTED_OTEL_PARENT_TTL_MS = 60 * 60 * 1000

export const OTEL_PARENT_PREFIX = 'otel:'

export type SpanType = 'llm' | 'score' | 'function' | 'eval' | 'task' | 'tool' | 'review'

function pruneExportedOtelParents(now = Date.now()) {
  if (exportedOtelParents.size <= EXPORTED_OTEL_PARENT_MAX) return
  for (const [key, value] of exportedOtelParents) {
    if (now - value.createdAt > EXPORTED_OTEL_PARENT_TTL_MS) exportedOtelParents.delete(key)
  }
  while (exportedOtelParents.size > EXPORTED_OTEL_PARENT_MAX) {
    const oldest = exportedOtelParents.keys().next().value

    if (!oldest) break
    exportedOtelParents.delete(oldest)
  }
}

export function rememberOtelParent(exported: string, parentContext: OtelContext | undefined) {
  if (!exported || !parentContext) return
  pruneExportedOtelParents()
  exportedOtelParents.set(exported, { context: parentContext, createdAt: Date.now() })
}

export function lookupOtelParent(exported: string | undefined): OtelContext | undefined {
  if (!exported) return undefined
  const found = exportedOtelParents.get(exported)

  if (!found) return undefined
  if (Date.now() - found.createdAt > EXPORTED_OTEL_PARENT_TTL_MS) {
    exportedOtelParents.delete(exported)

    return undefined
  }

  return found.context
}

export function braintrustParent(parent: string | undefined): string | undefined {
  const exported = vendorParent(parent)

  return exported && !exported.startsWith(OTEL_PARENT_PREFIX) ? exported : undefined
}

function attrKey(key: string): string {
  const collapsed = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9_.-]+/g, '_')

  return trimUnderscores(collapsed).toLowerCase()
}

export function prefixedAttrs(
  prefix: string,
  values: Record<string, unknown> | undefined,
): Attributes {
  const sanitized = sanitizeProperties(values)
  const out: Attributes = {}

  for (const [key, value] of Object.entries(sanitized)) {
    if (value === null) continue
    out[`${prefix}${attrKey(key)}`] = Array.isArray(value)
      ? (truncateText(JSON.stringify(value), 1_000) as string)
      : value
  }

  return out
}

export function payloadAttrs(prefix: string, value: unknown): Attributes {
  if (value === undefined) return {}
  if (typeof value === 'string') {
    return {
      [`${prefix}.size`]: value.length,
      [`${prefix}.preview`]: truncateText(value, 2_000) as string,
    }
  }
  try {
    const json = JSON.stringify(value)

    return {
      [`${prefix}.size`]: json.length,
      [`${prefix}.preview`]: truncateText(json, 2_000) as string,
    }
  } catch {
    const text = inspect(value, { depth: 3 })

    return {
      [`${prefix}.size`]: text.length,
      [`${prefix}.preview`]: truncateText(text, 2_000) as string,
    }
  }
}

export function errorForOtel(error: unknown): Error {
  if (error instanceof Error) return error
  const safe = safeError(error)
  const err = new Error(safe.message)

  err.name = safe.name ?? 'Error'
  if (safe.stack) err.stack = safe.stack

  return err
}

export function safeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  return { message: String(error) }
}

export function safeJsonSize(value: unknown): number {
  try {
    return JSON.stringify(value).length
  } catch {
    return 0
  }
}

export function truncateText(value: unknown, maxLength = 4000): unknown {
  if (typeof value !== 'string') return value

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}
