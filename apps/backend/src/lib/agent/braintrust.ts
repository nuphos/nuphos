// Agent tracing. Braintrust remains an optional LLM debugging sink, but OTel is
// the durable backend tracing path: agent lifecycle spans should remain useful
// even when BRAINTRUST_API_KEY is absent.
import { wrapAISDK } from 'braintrust'

import { enabled, otelEnabled } from './braintrust/shared'

import type { TelemetrySettings } from 'ai'

// Wrap a partial of the AI SDK module (streamText / generateText / etc.) so
// each call lands in Braintrust as a span with prompt, output, tools, usage,
// and any metadata passed via `experimental_telemetry`.
export function wrapAI<T extends Record<string, unknown>>(sdk: T): T {
  if (!enabled) return sdk

  return wrapAISDK(sdk as Parameters<typeof wrapAISDK>[0]) as unknown as T
}

// Back-compat alias: existing call sites import `wrapStreamText`.
export const wrapStreamText = wrapAI

// AI SDK's experimental_telemetry.metadata accepts OpenTelemetry attribute
// values: primitives or arrays of primitives. We allow undefined/null so call
// sites can pass optional fields without conditional assembly; we strip them
// before handing off to the SDK.
type AttrPrimitive = string | number | boolean
export type AgentTelemetryMetadata = Record<string, AttrPrimitive | undefined | null>

export function aiTelemetry(metadata: AgentTelemetryMetadata):
  | {
      isEnabled: true
      metadata: Record<string, AttrPrimitive>
      functionId?: string
      integrations?: NonNullable<TelemetrySettings['integrations']>
    }
  | undefined {
  // Enable when either tracing destination is active. Braintrust uses the
  // `integrations` hook the AI SDK exposes; the OTel pipeline picks up spans
  // automatically through the global tracer provider registered at boot.
  if (!enabled && !otelEnabled) return undefined
  const cleaned: Record<string, AttrPrimitive> = {}

  for (const [k, v] of Object.entries(metadata)) {
    if (v === undefined || v === null) continue
    cleaned[k] = v
  }

  return { isEnabled: true, metadata: cleaned }
}

export {
  createAgentTelemetryIntegration,
  createBraintrustTelemetryIntegration,
} from './braintrust/integration'
export { startTraceSpan } from './braintrust/spans'
export {
  createConversationParent,
  logConversationEvent,
  logSpanError,
  traced,
  updateConversationParent,
  withTraceParent,
} from './braintrust/traced'

export type { SpanLike } from './braintrust/shared'

export const braintrustEnabled = enabled
