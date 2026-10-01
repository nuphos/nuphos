import { inspect } from 'node:util'

import {
  dedupeToolResultErrors,
  parseToolResultError,
  toolResultOutputFromSdkResult,
} from '@/lib/agent/tool-result-errors'

import { truncateText } from './shared'

import type { ToolResultError } from '@/lib/agent/tool-result-errors'

// Larger cap for "content" fields (input/output/reasoning) where we want the
// Braintrust trace to actually be readable. 4000 chars clips real assistant
// turns and reasoning blocks; 32k keeps spans bounded while preserving almost
// every real-world message intact.
const CONTENT_TRUNCATE_LIMIT = 32_000
const truncateContent = (v: unknown) => truncateText(v, CONTENT_TRUNCATE_LIMIT)

// Bound non-string structured payloads (e.g. tool input/output JSON, which can
// be a multi-MB bash dump or file contents). Strings go through the regular
// content truncator; everything else is JSON-sized, and if it exceeds the
// limit we replace it with a marker object carrying a preview so the span
// stays readable but doesn't blow out Braintrust's per-row size cap.
function truncateStructured(value: unknown): unknown {
  if (value === undefined || value === null) return value
  if (typeof value === 'string') return truncateContent(value)
  try {
    const json = JSON.stringify(value)

    if (json.length <= CONTENT_TRUNCATE_LIMIT) return value

    return {
      truncated: true,
      originalSize: json.length,
      preview: `${json.slice(0, CONTENT_TRUNCATE_LIMIT)}...`,
    }
  } catch {
    return truncateContent(inspect(value, { depth: 3 }))
  }
}

export function collectToolResultErrors(event: any): ToolResultError[] {
  const out: ToolResultError[] = []
  const results = Array.isArray(event?.toolResults) ? event.toolResults : []

  for (const result of results) {
    const parsed = parseToolResultError(toolResultOutputFromSdkResult(result))

    if (!parsed) continue
    out.push({
      toolName: result?.toolName ?? result?.toolCall?.toolName,
      toolCallId: result?.toolCallId ?? result?.toolCall?.toolCallId,
      message: parsed.message,
      kind: parsed.kind,
      source: 'step',
    })
  }

  return dedupeToolResultErrors(out)
}

export function tokenMetrics(usage: any): Record<string, number> {
  if (!usage) return {}

  return {
    ...(usage.inputTokens != null ? { input_tokens: usage.inputTokens } : {}),
    ...(usage.outputTokens != null ? { output_tokens: usage.outputTokens } : {}),
    ...(usage.totalTokens != null ? { total_tokens: usage.totalTokens } : {}),
    ...(usage.reasoningTokens != null ? { reasoning_tokens: usage.reasoningTokens } : {}),
    ...(usage.cachedInputTokens != null ? { cached_input_tokens: usage.cachedInputTokens } : {}),
    // Cache writes cost 1.25x input, so the trace shows them separately. The
    // AI SDK reports them nested; our own rollup shape carries them flat.
    ...(usage.inputTokenDetails?.cacheWriteTokens != null
      ? { cache_write_tokens: usage.inputTokenDetails.cacheWriteTokens }
      : usage.cacheWriteTokens != null
        ? { cache_write_tokens: usage.cacheWriteTokens }
        : {}),
  }
}

// Project an AI SDK ModelMessage into a plain shape suitable for span input,
// trimming oversize text parts so a single huge tool result doesn't blow out
// the span. We keep enough structure (role + per-part type/snippet) that the
// trace is readable when inspecting a thinking step.
export function serializeStepInput(messages: unknown): unknown {
  if (!Array.isArray(messages)) return undefined
  const out = messages.map((m: any) => {
    const role = m?.role
    const content = m?.content

    if (typeof content === 'string') {
      return { role, content: truncateContent(content) }
    }
    if (Array.isArray(content)) {
      return {
        role,
        content: content.map((p: any) => {
          const type = p?.type

          if (type === 'text') return { type, text: truncateContent(p?.text) }
          if (type === 'reasoning') return { type, text: truncateContent(p?.text) }
          if (type === 'tool-call') {
            return {
              type,
              toolCallId: p?.toolCallId,
              toolName: p?.toolName,
              input: truncateStructured(p?.input),
            }
          }
          if (type === 'tool-result') {
            return {
              type,
              toolCallId: p?.toolCallId,
              toolName: p?.toolName,
              output: truncateStructured(p?.output),
            }
          }

          return { type, ...(p && typeof p === 'object' ? p : {}) }
        }),
      }
    }

    return { role, content }
  })

  return out
}

// Step output combines the text the model produced, its reasoning blocks, and
// any tool calls it decided to make. If only `text` is present we keep the
// output as a plain string for compactness; otherwise we emit a structured
// object so all three are visible in one place.
export function buildStepOutput(event: any): unknown {
  const text = typeof event?.text === 'string' ? truncateContent(event.text) : undefined
  const reasoning =
    typeof event?.reasoningText === 'string' ? truncateContent(event.reasoningText) : undefined
  const toolCalls =
    Array.isArray(event?.toolCalls) && event.toolCalls.length > 0
      ? event.toolCalls.map((tc: any) => ({
          toolCallId: tc?.toolCallId,
          toolName: tc?.toolName,
          input: truncateStructured(tc?.input),
        }))
      : undefined

  if (!reasoning && !toolCalls) return text

  return {
    ...(text ? { text } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(toolCalls ? { toolCalls } : {}),
  }
}
