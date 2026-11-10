// Durable-transcript helpers for Claude Code preview turns: assistant messages
// that carry their tool steps. The history preamble lives in
// preview-history-preamble.ts (this file sits at the max-lines limit).

import { getCompactionSummary } from '@/lib/agent/db'

import { CodexTurnFailedError } from './codex-turn-failure'
import {
  OpenAbConnectionLostError,
  claudeNotice,
  runtimeProductStateMessage,
} from './openab-acp-errors'
import { RuntimeStateProbeError } from './turn-diagnostics'

import type { PreviewTextMetadata } from './preview-agent-update'
import type { SteeringEntry, SteeringReceipt } from './steering-receipt'
import type { UIMessage } from 'ai'

/** How a tool step sits inside a Claude Code sub-agent run. */
export type PreviewToolAttribution = {
  /** The Agent/Task call this step ran inside, when the runtime says so. */
  parentToolUseId?: string
  /** This call spawned a sub-agent (Claude Code's Agent/Task tool). */
  subagent?: true
}

export type PreviewToolStep = {
  toolCallId: string
  toolName: string
  input: unknown
  startedAt?: number
  completedAt?: number
  output?: unknown
  errorText?: string
} & PreviewToolAttribution

export type PreviewTurnInterruption = {
  reason: 'cancelled' | 'timeout' | 'error'
  message: string
}

export const INTERRUPTED_TOOL_ERROR = 'Interrupted before the tool finished.'

// User-facing summary; interruption diagnostics also retain a best-effort secret-masked error.
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
  // A signed-out or out-of-usage runtime is a product state: the transcript names the action.
  const productState = aborted ? undefined : runtimeProductStateMessage(error)

  if (productState) return { reason: 'error', message: productState }
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

  return {
    reason,
    message:
      !aborted && error instanceof RuntimeStateProbeError
        ? error.message
        : // The runtime's own reason, the same line the stream error carries.
          ((reason === 'error' && !aborted ? claudeNotice(error) : undefined) ??
          INTERRUPTION_MESSAGES[reason]),
  }
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
} & PreviewToolAttribution

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
    ...(step.parentToolUseId ? { parentToolUseId: step.parentToolUseId } : {}),
    ...(step.subagent ? { subagent: true } : {}),
  }
}

type PreviewPartOrderEntry =
  | ({ type: 'text'; text: string } & PreviewTextMetadata)
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; toolCallId: string }
  | SteeringEntry

/**
 * Records the native runtime's assistant output in arrival order while tool
 * payloads continue to be updated in the separate tool log. Materializing at
 * turn completion resolves each tool id to its final state without moving it
 * past the commentary that followed it.
 */
export function createPreviewAssistantPartAccumulator() {
  const entries: PreviewPartOrderEntry[] = []
  const toolIds = new Set<string>()
  const appendTextLike = (
    type: 'text' | 'reasoning',
    text: string,
    metadata?: PreviewTextMetadata,
  ) => {
    if (!text) return false
    const previous = entries.at(-1)

    if (
      previous?.type === type &&
      (previous.type === 'reasoning' ||
        (previous.messageId === metadata?.messageId && previous.phase === metadata?.phase))
    ) {
      previous.text += text

      return false
    }
    entries.push({
      type,
      text,
      ...(metadata?.messageId ? { messageId: metadata.messageId } : {}),
      ...(metadata?.phase ? { phase: metadata.phase } : {}),
    })

    return (
      type === 'text' &&
      Boolean(
        metadata?.messageId ||
        metadata?.phase ||
        (previous?.type === 'text' && (previous.messageId || previous.phase)),
      )
    )
  }

  return {
    /** A receipt seen again, now with its sender, keeps its place and takes the sender. */
    appendSteering: (receipt: SteeringReceipt) => {
      const placed = entries.find(
        (entry): entry is SteeringEntry =>
          entry.type === 'data-steering' && entry.data.id === receipt.id,
      )

      if (!placed) entries.push({ type: 'data-steering', data: { ...receipt } })
      else if (receipt.metadata) placed.data.metadata ??= receipt.metadata
    },
    appendText: (text: string, metadata?: PreviewTextMetadata) => {
      return appendTextLike('text', text, metadata)
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
        if (entry.type === 'data-steering')
          return [{ type: 'data-steering', data: { ...entry.data } }]
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
