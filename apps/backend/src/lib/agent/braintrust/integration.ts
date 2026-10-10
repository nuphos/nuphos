import {
  buildStepOutput,
  collectToolResultErrors,
  serializeStepInput,
  tokenMetrics,
} from './serialize'
import { safeJsonSize } from './shared'
import { startTraceSpan } from './spans'

import type { SpanLike } from './shared'
import type { TelemetrySettings } from 'ai'

async function childParent(span: SpanLike | undefined, fallbackParent: string) {
  if (!span) return fallbackParent
  try {
    return await span.export()
  } catch {
    return fallbackParent
  }
}

export function createAgentTelemetryIntegration(args: {
  parent?: string
  metadata?: Record<string, unknown>
}):
  | {
      integration: TelemetrySettings['integrations']
      drainOpenSpans: (status: 'finish' | 'abort' | 'error', error?: unknown) => void
    }
  | undefined {
  const parent = args.parent
  const baseMetadata = args.metadata ?? {}
  const stepSpans = new Map<
    number,
    { span: SpanLike; startedAt: number; firstToolStartedAt?: number }
  >()
  const toolSpans = new Map<string, { span: SpanLike; startedAt: number }>()

  const drainOpenSpans = (status: 'finish' | 'abort' | 'error', error?: unknown) => {
    const now = Date.now()

    for (const [id, entry] of toolSpans) {
      entry.span.log({
        ...(error ? { error } : {}),
        metadata: {
          ...baseMetadata,
          phase: 'tool',
          status,
          terminalReason: 'drained_without_onToolCallFinish',
          toolCallId: id,
        },
        metrics: {
          duration_ms: now - entry.startedAt,
          success: 0,
        },
      })
      entry.span.end()
    }
    toolSpans.clear()

    for (const [stepNumber, entry] of stepSpans) {
      entry.span.log({
        ...(error ? { error } : {}),
        metadata: {
          ...baseMetadata,
          phase: 'thinking',
          status,
          terminalReason: 'drained_without_onStepFinish',
          stepNumber,
        },
        metrics: {
          duration_ms: now - entry.startedAt,
          model_ms: (entry.firstToolStartedAt ?? now) - entry.startedAt,
        },
      })
      entry.span.end()
    }
    stepSpans.clear()
  }

  const integration = {
    onStepStart: async (event: any) => {
      const startedAt = Date.now()
      const span = startTraceSpan({
        name: `agent.thinking.step.${String(event.stepNumber)}`,
        type: 'llm',
        parent,
        // Log the messages sent to the model for this step so each thinking
        // span is self-contained in Braintrust and OTel.
        input: serializeStepInput(event.messages),
        metadata: {
          ...baseMetadata,
          phase: 'thinking',
          stepNumber: event.stepNumber,
          modelId: event.model?.modelId,
          provider: event.model?.provider,
          messageCount: event.messages?.length,
          activeTools: event.activeTools?.map(String),
          toolChoice: event.toolChoice ? JSON.stringify(event.toolChoice) : undefined,
        },
      })

      span.log({
        metrics: {
          input_message_count: event.messages?.length ?? 0,
          available_tool_count: event.tools ? Object.keys(event.tools).length : 0,
        },
      })
      stepSpans.set(event.stepNumber, { span, startedAt })
    },
    onStepFinish: async (event: any) => {
      const entry = stepSpans.get(event.stepNumber)

      if (!entry) return
      const durationMs = Date.now() - entry.startedAt
      const modelMs = (entry.firstToolStartedAt ?? Date.now()) - entry.startedAt
      const toolResultErrors = collectToolResultErrors(event)
      const toolResultError =
        toolResultErrors.length > 0
          ? {
              name: 'ToolResultError',
              message: toolResultErrors
                .map((err) => `${err.toolName ?? 'unknown'}: ${err.message}`)
                .join('\n'),
              errors: toolResultErrors,
            }
          : undefined

      // Build a structured output that surfaces both the assistant text AND
      // the reasoning/thinking content, plus any tool calls the model emitted
      // this step. Previously only `event.text` was logged, which meant
      // reasoning blocks (the model's thinking) and tool-call decisions were
      // invisible at the step level — you'd have to drill into child tool
      // spans or the turn-level output to see what the model actually did.
      entry.span.log({
        ...(toolResultError ? { error: toolResultError } : {}),
        output: buildStepOutput(event),
        metadata: {
          ...baseMetadata,
          phase: 'thinking',
          stepNumber: event.stepNumber,
          finishReason: event.finishReason,
          reasoningChars: event.reasoningText?.length ?? 0,
          toolCallCount: event.toolCalls?.length ?? 0,
          toolResultCount: event.toolResults?.length ?? 0,
          toolResultErrorCount: toolResultErrors.length,
          toolResultErrors,
          responseId: event.response?.id,
        },
        metrics: {
          duration_ms: durationMs,
          model_ms: modelMs,
          text_chars: event.text?.length ?? 0,
          reasoning_chars: event.reasoningText?.length ?? 0,
          tool_call_count: event.toolCalls?.length ?? 0,
          tool_result_count: event.toolResults?.length ?? 0,
          tool_result_error_count: toolResultErrors.length,
          ...tokenMetrics(event.usage),
        },
      })
      entry.span.end()
      stepSpans.delete(event.stepNumber)
    },
    onToolCallStart: async (event: any) => {
      const startedAt = Date.now()
      const toolCall = event.toolCall ?? {}
      const id = toolCall.toolCallId ?? `${String(event.stepNumber)}:${String(toolCall.toolName)}`
      const stepEntry = event.stepNumber == null ? undefined : stepSpans.get(event.stepNumber)

      if (stepEntry && stepEntry.firstToolStartedAt == null)
        stepEntry.firstToolStartedAt = startedAt
      const parentForTool = await childParent(stepEntry?.span, parent ?? '')
      const span = startTraceSpan({
        name: `agent.tool.${String(toolCall.toolName ?? 'unknown')}`,
        type: 'tool',
        parent: parentForTool,
        input: toolCall.input,
        metadata: {
          ...baseMetadata,
          phase: 'tool',
          stepNumber: event.stepNumber,
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          inputBytes: safeJsonSize(toolCall.input),
        },
      })

      toolSpans.set(id, { span, startedAt })
    },
    onToolCallFinish: async (event: any) => {
      const toolCall = event.toolCall ?? {}
      const id = toolCall.toolCallId ?? `${String(event.stepNumber)}:${String(toolCall.toolName)}`
      const entry = toolSpans.get(id)

      if (!entry) return
      const durationMs = event.durationMs ?? Date.now() - entry.startedAt

      if (event.success) {
        entry.span.log({
          output: event.output,
          metadata: {
            ...baseMetadata,
            phase: 'tool',
            status: 'success',
            stepNumber: event.stepNumber,
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            outputBytes: safeJsonSize(event.output),
          },
          metrics: { duration_ms: durationMs, success: 1 },
        })
      } else {
        entry.span.log({
          error: event.error,
          metadata: {
            ...baseMetadata,
            phase: 'tool',
            status: 'error',
            stepNumber: event.stepNumber,
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
          },
          metrics: { duration_ms: durationMs, success: 0 },
        })
      }
      entry.span.end()
      toolSpans.delete(id)
    },
    onFinish: async (event: any) => {
      const span = startTraceSpan({
        name: 'agent.chat.finish',
        type: 'function',
        parent,
        metadata: {
          ...baseMetadata,
          phase: 'chat:finish',
          finishReason: event.finishReason,
          stepCount: event.steps?.length ?? 0,
        },
      })

      span.log({
        metrics: {
          step_count: event.steps?.length ?? 0,
          ...tokenMetrics(event.totalUsage),
        },
      })
      span.end()
      drainOpenSpans('finish')
    },
    // AI SDK 6 does not currently expose this hook in its public integration
    // type, but keeping it here makes the drain path future-proof if/when the
    // runtime calls telemetry integration error handlers.
    onError: async (event: any) => {
      drainOpenSpans('error', event?.error ?? event)
    },
  } as TelemetrySettings['integrations']

  return { integration, drainOpenSpans }
}

export const createBraintrustTelemetryIntegration = createAgentTelemetryIntegration
