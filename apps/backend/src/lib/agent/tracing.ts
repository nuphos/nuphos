// Agent tracing: full-content Mongo storage and OpenTelemetry instrumentation.
import { wrapMongoGenerateText } from './trace-store/ai-sdk'
import { otelEnabled } from './tracing/shared'

import type { generateText, TelemetrySettings } from 'ai'

// Instrument the current generateText callers for full-content Mongo traces.
export function wrapAI<T extends Record<string, unknown>>(sdk: T): T {
  if (typeof sdk.generateText !== 'function') return sdk

  return {
    ...sdk,
    generateText: wrapMongoGenerateText(sdk.generateText as typeof generateText),
  }
}

// AI SDK's experimental_telemetry.metadata accepts OpenTelemetry attribute
// values: primitives or arrays of primitives. We allow undefined/null so call
// sites can pass optional fields without conditional assembly; we strip them
// before handing off to the SDK.
type AttrPrimitive = string | number | boolean
export type AgentTelemetryMetadata = Record<string, AttrPrimitive | undefined | null>

export function aiTelemetry(metadata: AgentTelemetryMetadata):
  | {
      isEnabled: boolean
      metadata: Record<string, AttrPrimitive>
      functionId?: string
      integrations?: NonNullable<TelemetrySettings['integrations']>
    }
  | undefined {
  // Preserve ownership even when OTel is off; Mongo reads this metadata.
  const cleaned: Record<string, AttrPrimitive> = {}

  for (const [k, v] of Object.entries(metadata)) {
    if (v === undefined || v === null) continue
    cleaned[k] = v
  }

  return { isEnabled: otelEnabled, metadata: cleaned }
}

export { startTraceSpan } from './tracing/spans'
export {
  createConversationParent,
  logSpanError,
  traced,
  updateConversationParent,
} from './tracing/traced'

export type { SpanLike } from './tracing/shared'
