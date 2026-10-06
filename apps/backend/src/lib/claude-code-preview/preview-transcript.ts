// Durable-transcript helpers for Claude Code preview turns: assistant messages
// that carry their tool steps, and the conversation title the classic turn
// would have generated. The history preamble lives in
// preview-history-preamble.ts (this file sits at the max-lines limit).

import { getCompactionSummary, getConversation, updateConversationTitle } from '@/lib/agent/db'
import { fallbackTitle } from '@/lib/agent/title-fallback'
import { generateConversationTitle } from '@/lib/agent/title-generator'
import { logError } from '@/lib/observability'

import { CodexTurnFailedError } from './codex-turn-failure'
import { OpenAbConnectionLostError, runtimeUsageExhaustedMessage } from './openab-acp-errors'
import { attributeReceipt } from './steering-receipt'

import type { SteeringAttribution, SteeringEntry, SteeringReceipt } from './steering-receipt'
import type { UIMessage } from 'ai'

export type PreviewToolStep = {
  toolCallId: string
  toolName: string
  input: unknown
  startedAt?: number
  completedAt?: number
  output?: unknown
  errorText?: string
}

export type PreviewTurnInterruption = {
  reason: 'cancelled' | 'timeout' | 'error'
  message: string
}

export const INTERRUPTED_TOOL_ERROR = 'Interrupted before the tool finished.'

// User-facing wording only; the raw error stays in telemetry.
const INTERRUPTION_MESSAGES: Record<PreviewTurnInterruption['reason'], string> = {
  cancelled: 'The turn was stopped before the agent finished.',
  timeout: 'The agent did not respond in time.',
  error: 'The agent failed before it could answer.',
}

export function classifyPreviewInterruption(
  error: unknown,
  aborted: boolean,
): PreviewTurnInterruption {
  if (
    !aborted &&
    (error instanceof CodexTurnFailedError || error instanceof OpenAbConnectionLostError)
  )
    return { reason: 'error', message: error.userMessage }
  const usageExhausted = aborted ? undefined : runtimeUsageExhaustedMessage(error)

  if (usageExhausted) return { reason: 'error', message: usageExhausted }
  const lower = (error instanceof Error ? error.message : String(error)).toLowerCase()

  if (!aborted && (lower.includes('enospc') || lower.includes('no space left on device'))) {
    return {
      reason: 'error',
      message: 'The agent ran out of disk space. Free space before retrying.',
    }
  }
  if (!aborted && lower.includes('no turn progress')) {
    return {
      reason: 'timeout',
      message: 'The agent stopped making progress, so the turn was stopped.',
    }
  }
  const reason =
    aborted || lower.includes('cancelled')
      ? 'cancelled'
      : lower.includes('timed out') || lower.includes('timeout')
        ? 'timeout'
        : 'error'

  return { reason, message: INTERRUPTION_MESSAGES[reason] }
}

/** Steps still waiting on output when the turn died, marked as failed. */
export function interruptToolSteps(
  steps: PreviewToolStep[],
  errorText = INTERRUPTED_TOOL_ERROR,
): PreviewToolStep[] {
  return steps.map((step) =>
    step.output === undefined && step.errorText === undefined ? { ...step, errorText } : step,
  )
}

export function turnInterruptedPart(id: string, interruption: PreviewTurnInterruption) {
  return {
    type: 'turn-interrupted' as const,
    id,
    reason: interruption.reason,
    message: interruption.message,
    createdAt: new Date().toISOString(),
  }
}

type ToolPart = {
  type: `tool-${string}`
  toolCallId: string
  state: 'input-available' | 'output-available' | 'output-error'
  input: unknown
  startedAt?: number
  completedAt?: number
  output?: unknown
  errorText?: string
}

function previewToolPart(step: PreviewToolStep): ToolPart {
  return {
    type: `tool-${step.toolName}`,
    toolCallId: step.toolCallId,
    state:
      step.errorText !== undefined
        ? 'output-error'
        : step.output !== undefined
          ? 'output-available'
          : 'input-available',
    input: step.input,
    ...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}),
    ...(step.completedAt !== undefined ? { completedAt: step.completedAt } : {}),
    ...(step.output !== undefined ? { output: step.output } : {}),
    ...(step.errorText !== undefined ? { errorText: step.errorText } : {}),
  }
}

type PreviewPartOrderEntry =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; toolCallId: string }
  | SteeringEntry

/**
 * Records the native runtime's assistant output in arrival order while tool
 * payloads continue to be updated in the separate tool log. Materializing at
 * turn completion resolves each tool id to its final state without moving it
 * past the commentary that followed it.
 */
export function createPreviewAssistantPartAccumulator(attribute?: SteeringAttribution) {
  const entries: PreviewPartOrderEntry[] = []
  const toolIds = new Set<string>()
  const appendTextLike = (type: 'text' | 'reasoning', text: string) => {
    if (!text) return
    const previous = entries.at(-1)

    if (previous?.type === type) {
      previous.text += text

      return
    }
    entries.push({ type, text })
  }

  return {
    appendSteering: (receipt: SteeringReceipt) => {
      if (entries.some((entry) => entry.type === 'data-steering' && entry.data.id === receipt.id))
        return
      const receivedAt = new Date().toISOString()

      entries.push({ type: 'data-steering', data: { ...receipt }, receivedAt })
    },
    appendText: (text: string) => {
      appendTextLike('text', text)
    },
    appendReasoning: (text: string) => {
      appendTextLike('reasoning', text)
    },
    appendTool: (toolCallId: string) => {
      if (!toolCallId || toolIds.has(toolCallId)) return
      toolIds.add(toolCallId)
      entries.push({ type: 'tool', toolCallId })
    },
    materialize: (toolSteps: PreviewToolStep[]): UIMessage['parts'] => {
      const tools = new Map(toolSteps.map((step) => [step.toolCallId, step]))

      return entries.flatMap((entry) => {
        if (entry.type === 'data-steering') return [attributeReceipt(entry, attribute)]
        if (entry.type !== 'tool') return [{ ...entry }]
        const step = tools.get(entry.toolCallId)

        return step ? [previewToolPart(step) as unknown as UIMessage['parts'][number]] : []
      })
    },
  }
}

/**
 * The assistant message persisted for one preview turn, in the UIMessage
 * shape the classic transcript stores (`tool-<name>` parts normalize to the
 * durable `tool` part on write), so tool steps survive reloads and replay.
 */
export function previewAssistantMessageParts(args: {
  reasoning: string
  text: string
  toolSteps: PreviewToolStep[]
}): UIMessage['parts'] {
  const tools = args.toolSteps.map(previewToolPart)

  return [
    ...(args.reasoning ? [{ type: 'reasoning' as const, text: args.reasoning }] : []),
    ...(tools as unknown as UIMessage['parts']),
    ...(args.text ? [{ type: 'text' as const, text: args.text }] : []),
  ]
}

/** Loads the conversation's compaction summary text, if one was stored. */
export async function previewCompactionSummary(
  sessionId: string,
  userId: string,
): Promise<string | null> {
  try {
    return (await getCompactionSummary(sessionId, userId))?.summary ?? null
  } catch {
    return null
  }
}

/**
 * Gives a preview conversation the AI-generated title the classic first round
 * would have produced; a no-op once a real title exists.
 */
export async function ensurePreviewTitle(args: {
  sessionId: string
  userId: string
  teamId: string
  firstMessage: string
  assistantResponse: string
  locale: string
}): Promise<void> {
  if (!args.firstMessage) return
  try {
    const conversation = await getConversation(args.sessionId, args.userId, args.teamId)

    if (!conversation || conversation.titleManuallySet) return
    const current = conversation.title.trim()

    if (current && current !== fallbackTitle(args.firstMessage)) return
    const title = await generateConversationTitle(
      args.firstMessage,
      args.assistantResponse,
      args.locale,
      { userId: args.userId, sessionId: args.sessionId, teamId: args.teamId },
    )

    await updateConversationTitle(args.sessionId, args.userId, title)
  } catch (err) {
    logError('agent.chat.title_generation.error', err, { teamId: args.teamId })
  }
}
