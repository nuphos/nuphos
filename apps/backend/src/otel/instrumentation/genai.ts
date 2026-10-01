// genai.ts — custom span processor that listens for AI SDK spans (the SDK
// emits spans named `ai.generateText`, `ai.streamText`, `ai.toolCall`, etc.)
// and forwards their `gen_ai.usage.*` attributes to histograms / counters so
// you can graph token consumption per model without aggregating spans.

import { metricsRegistry } from '@/otel/metrics'

import type { Attributes } from '@opentelemetry/api'
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base'

// AI SDK 6 span name prefixes we care about. Internal helper spans (e.g.
// `ai.toolCall.execute`) inherit the same attribute keys; we accept anything
// starting with `ai.`.
const AI_SPAN_PREFIX = 'ai.'

function num(attrs: Attributes | undefined, key: string): number | undefined {
  const v = attrs?.[key]

  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const parsed = Number(v)

    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

// OTel Counters require non-negative increments — anything else violates the
// spec and may be silently dropped or treated as undefined behaviour. We also
// want zero to round-trip (the AI SDK does emit `usage.input_tokens = 0` for
// cached calls), which the truthiness check `if (n)` would have eaten.
function nonNegative(attrs: Attributes | undefined, key: string): number | undefined {
  const v = num(attrs, key)

  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}

function str(attrs: Attributes | undefined, key: string): string | undefined {
  const v = attrs?.[key]

  return typeof v === 'string' ? v : undefined
}

// Implements only the methods we actually use; the rest are required by the
// SpanProcessor interface so we provide no-ops.
export class GenAIMetricsSpanProcessor implements SpanProcessor {
  onStart(): void {
    /* no-op */
  }

  onEnd(span: ReadableSpan): void {
    const name = span.name

    if (!name.startsWith(AI_SPAN_PREFIX)) return

    const attrs = span.attributes
    const provider = str(attrs, 'gen_ai.system') ?? str(attrs, 'ai.model.provider')
    const model = str(attrs, 'gen_ai.request.model') ?? str(attrs, 'ai.model.id')
    const operation = str(attrs, 'gen_ai.operation.name') ?? name

    const inputTokens =
      nonNegative(attrs, 'gen_ai.usage.input_tokens') ??
      nonNegative(attrs, 'ai.usage.promptTokens') ??
      nonNegative(attrs, 'ai.usage.inputTokens')
    const outputTokens =
      nonNegative(attrs, 'gen_ai.usage.output_tokens') ??
      nonNegative(attrs, 'ai.usage.completionTokens') ??
      nonNegative(attrs, 'ai.usage.outputTokens')
    const reasoningTokens =
      nonNegative(attrs, 'gen_ai.usage.reasoning_tokens') ??
      nonNegative(attrs, 'ai.usage.reasoningTokens')

    const labels = {
      'gen_ai.system': provider,
      'gen_ai.request.model': model,
      'gen_ai.operation.name': operation,
    }
    // Strip undefined — counters / histograms reject them.
    const tagged: Record<string, string> = {}

    for (const [k, v] of Object.entries(labels)) {
      if (typeof v === 'string') tagged[k] = v
    }

    const m = metricsRegistry()
    const durationNs = span.duration[0] * 1e9 + span.duration[1]
    const durationMs = durationNs / 1e6

    // Semconv: gen_ai.client.operation.duration is in seconds.
    m.aiGenerationDuration.record(durationMs / 1_000, tagged)
    // `!= undefined` so that a legitimate 0 (cache hits) still increments the
    // counter once with a zero — preserves call counts without distorting sums.
    if (inputTokens !== undefined) m.aiTokensInput.add(inputTokens, tagged)
    if (outputTokens !== undefined) m.aiTokensOutput.add(outputTokens, tagged)
    if (reasoningTokens !== undefined) m.aiTokensReasoning.add(reasoningTokens, tagged)
    if (name === 'ai.toolCall') m.aiToolCalls.add(1, tagged)
  }

  forceFlush(): Promise<void> {
    return Promise.resolve()
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}
