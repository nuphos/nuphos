import { track, trackError } from '../../../lib/analytics'
import { withClientToolDeadline } from '../../../lib/clientToolDeadline'
import { pendingClientSideLocalTools } from '../../../lib/clientToolPhase'

import { INTERRUPTED_TOOL_MESSAGE, incompleteToolErrorText } from './stall'

import type { Message, Tab } from './model'
import type { Part, ToolPart } from './parts'

// When a stream is aborted or errors mid-flight, the last assistant message can be left with
// tool parts in `input-streaming`/`input-available` state — i.e. tool_use without tool_result.
// Bedrock rejects the next turn if the history contains those orphans. Finalize them to
// `output-error` so subsequent `toUiMessages` produces a valid tool_use+tool_result pair.
export function finalizeIncompleteTools(messages: Message[], errorText: string): Message[] {
  if (messages.length === 0) return messages
  const lastIdx = messages.length - 1
  const last = messages[lastIdx]

  if (last.role !== 'assistant') return messages
  const hasIncomplete = last.parts.some(
    (p) => p.type === 'tool' && (p.state === 'input-streaming' || p.state === 'input-available'),
  )

  if (!hasIncomplete) return messages
  const completedAt = Date.now()
  const nextParts: Part[] = last.parts.map((p) =>
    p.type === 'tool' && (p.state === 'input-streaming' || p.state === 'input-available')
      ? {
          ...p,
          state: 'output-error',
          completedAt: p.completedAt ?? completedAt,
          errorText: incompleteToolErrorText(p, errorText),
        }
      : p,
  )
  const next = messages.slice()

  next[lastIdx] = { ...last, parts: nextParts }

  return next
}

// Escalate errors that keep recurring. The banner alone reads as a one-off
// failure, so users retry into the same deterministic wall (session 3c2e03db:
// five identical failures in 16 seconds). Track the streak on the tab and,
// from the second consecutive identical error on, say plainly that retrying
// won't help.
export function latchTabError(
  t: Tab,
  err: string,
): Pick<Tab, 'error' | 'lastErrorKey' | 'errorStreak'> {
  const streak = t.lastErrorKey === err ? (t.errorStreak ?? 1) + 1 : 1

  return {
    error:
      streak >= 2
        ? `${err} (This has failed ${String(streak)} times in a row — retrying the same way won't help. If it persists, reopen this conversation or continue in a new one.)`
        : err,
    lastErrorKey: err,
    errorStreak: streak,
  }
}

// A turn can end with a tool still paused on approval-requested. If the user
// replies instead of deciding, no tool-approval-response can ever arrive for
// it, and the transcript would carry a tool-call with neither result nor
// response — the backend rejects that on every retry, permanently wedging the
// conversation. Sending a new message is an
// implicit "no": stamp the pending approval as declined, exactly like the Deny
// button, so the SDK records the denial and the new turn proceeds. Only the
// user-send path may call this — resume/reconnect flows must leave a live
// approval answerable.
export function supersedePendingApprovals(messages: Message[]): Message[] {
  return messages.map((m) =>
    m.parts.some((p) => p.type === 'tool' && p.state === 'approval-requested')
      ? {
          ...m,
          parts: m.parts.map((p) =>
            p.type === 'tool' && p.state === 'approval-requested' && p.approval
              ? {
                  ...p,
                  state: 'approval-responded' as const,
                  approval: { ...p.approval, approved: false },
                }
              : p,
          ),
        }
      : m,
  )
}

export function finalizeToolPartForDisplay(part: ToolPart): ToolPart {
  if (part.state !== 'input-streaming' && part.state !== 'input-available') return part

  return {
    ...part,
    state: 'output-error',
    errorText: incompleteToolErrorText(part, INTERRUPTED_TOOL_MESSAGE),
  }
}

export function findPendingClientSideLocalTools(messages: Message[]): ToolPart[] {
  return pendingClientSideLocalTools(messages).filter(
    (part): part is ToolPart => part.type === 'tool',
  )
}

export function localToolFallbackOutput(toolName: string, error: string): unknown {
  if (toolName === 'local_exec') {
    return { stdout: '', stderr: error, exitCode: 1 }
  }

  return { ok: false, error }
}

export async function executeClientToolWithDeadline(args: {
  sessionId: string
  toolCallId: string
  toolName: string
  input: unknown
}): Promise<unknown> {
  try {
    return await withClientToolDeadline(
      args.toolName,
      () => window.api.agentExecuteClientTool(args),
      {
        onDeadline: ({ toolName, deadlineMs }) => {
          track('agent_client_tool_deadline_exceeded', {
            tool_name: toolName,
            deadline_ms: deadlineMs,
            session_id: args.sessionId,
          })
          // Giving up on the promise must also stop the work: otherwise the turn
          // moves on with an error while the command keeps running in main, and
          // its side effects land after we've told the model it failed. Tools run
          // one at a time in this phase, so this only kills the one that overran.
          void window.api.agentAbortClientTools(args.sessionId).catch(() => {
            // Best-effort: the main-process deadline still caps the command.
          })
        },
      },
    )
  } catch (error) {
    trackError(
      {
        source: 'agent_client_tool',
        phase: 'execution_failed',
        message: error instanceof Error ? error.message : String(error),
        toolName: args.toolName,
        toolCallId: args.toolCallId,
        sessionId: args.sessionId,
      },
      error,
    )
    throw error
  }
}

export function applyClientToolOutput(
  messages: Message[],
  toolCallId: string,
  output: unknown,
): Message[] {
  const completedAt = Date.now()

  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === 'tool' && part.toolCallId === toolCallId
        ? {
            ...part,
            state: 'output-available',
            completedAt: part.completedAt ?? completedAt,
            output,
          }
        : part,
    ),
  }))
}
