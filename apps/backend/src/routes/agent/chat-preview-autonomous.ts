// Turns emitted by Claude Code itself after session/prompt has returned (for
// example a ScheduleWakeup firing) still belong to the attached conversation.
// Give them the same resumable run stream and durable assistant transcript as
// an interactive preview turn, without inventing a synthetic user message.
import { randomUUID } from 'node:crypto'

import { config } from '@/config'
import { appendAutonomousConversationTurn } from '@/lib/agent/db'
import { handleOpenAbPermissionRequest } from '@/lib/claude-code-preview/openab-permission-bridge'
import { createPreviewAssistantPartAccumulator } from '@/lib/claude-code-preview/preview-transcript'
import { logError } from '@/lib/observability'

import type {
  ClaudeCodeAutonomousContext,
  ClaudeCodeAutonomousPermission,
  ClaudeCodeAutonomousUpdate,
} from '@/lib/claude-code-preview/agent-chat-runtime'
import type { OpenAbPermissionOutcome } from '@/lib/claude-code-preview/openab-acp-session'
import type { PreviewAgentUpdate } from '@/lib/claude-code-preview/preview-agent-update'
import type { PreviewToolStep } from '@/lib/claude-code-preview/preview-transcript'

type AutonomousTurn = {
  messageId: string
  context: ClaudeCodeAutonomousContext
  emit: (frame: Record<string, unknown>) => void
  finish: () => void
  handleTool: (update: Extract<PreviewAgentUpdate, { kind: 'tool' }>) => void
  toolSteps: () => PreviewToolStep[]
  reportError: (error: unknown) => void
  text: string
  reasoning: string
  orderedParts: ReturnType<typeof createPreviewAssistantPartAccumulator>
}

type AutonomousTurnDeps = {
  begin: (
    context: ClaudeCodeAutonomousContext,
    messageId: string,
  ) => Omit<AutonomousTurn, 'messageId' | 'context' | 'text' | 'reasoning' | 'orderedParts'>
  authorize?: typeof handleOpenAbPermissionRequest
}

function keyOf(context: ClaudeCodeAutonomousContext): string {
  return `${context.teamId}:${context.conversationId}`
}

function beginTurn(context: ClaudeCodeAutonomousContext, deps: AutonomousTurnDeps): AutonomousTurn {
  const messageId = randomUUID()

  return {
    ...deps.begin(context, messageId),
    messageId,
    context: {
      teamId: context.teamId,
      conversationId: context.conversationId,
      userId: context.userId,
      conversationOwnerUserId: context.conversationOwnerUserId,
      locale: context.locale,
    },
    text: '',
    reasoning: '',
    orderedParts: createPreviewAssistantPartAccumulator(),
  }
}

async function finishTurn(turn: AutonomousTurn): Promise<void> {
  // The transcript belongs to the conversation owner, not to whoever happened
  // to run the last interactive turn.
  const { conversationId, teamId, conversationOwnerUserId: userId, locale } = turn.context
  const parts = turn.orderedParts.materialize(turn.toolSteps())

  // Runtime termination ends the stream and its lease immediately. Database
  // persistence must not keep an idle runtime displayed as Thinking.
  turn.finish()
  try {
    if (parts.length > 0) {
      await appendAutonomousConversationTurn({
        sessionId: conversationId,
        userId,
        teamId,
        message: {
          id: turn.messageId,
          parts,
        },
        locale,
        provider: config.agent.modelProvider,
      })
    }
  } catch (error) {
    logError('agent.chat.preview_autonomous_persist.error', error, {
      session_id: conversationId,
      team_id: teamId,
    })
  }
}

export function createClaudeCodeAutonomousUpdateHandler(deps: AutonomousTurnDeps) {
  const turns = new Map<string, AutonomousTurn>()
  const openTurn = (context: ClaudeCodeAutonomousContext): AutonomousTurn => {
    const key = keyOf(context)
    const existing = turns.get(key)

    if (existing) return existing
    const turn = beginTurn(context, deps)

    turns.set(key, turn)

    return turn
  }

  return {
    update: (update: ClaudeCodeAutonomousUpdate): void | Promise<void> => {
      if (update.update.kind === 'agent' && update.update.update.kind === 'runtime-state') return
      if (update.update.kind === 'async-task' || update.update.kind === 'prompt-suggestion') return
      if (update.update.kind === 'status') {
        if (update.update.status === 'active') {
          // Snapshots are broadcast to all observers, including connections
          // that do not own the executing prompt. Only output or permission
          // delivery may open a transcript; activity alone is not a new turn.
          const turn = turns.get(keyOf(update))

          if (turn && update.update.runtimeSnapshot)
            turn.emit({ type: 'runtime-state', snapshot: update.update.runtimeSnapshot })
        }

        return
      }
      if (update.update.kind === 'complete' || update.update.kind === 'interrupted') {
        const key = keyOf(update)
        const turn = turns.get(key)

        if (!turn) return
        if (update.update.runtimeSnapshot)
          turn.emit({ type: 'runtime-state', snapshot: update.update.runtimeSnapshot })
        turns.delete(key)
        if (update.update.kind === 'interrupted') {
          // The turn produced whatever it produced and then its runtime
          // vanished. Report it before finishing so the run ends on an error
          // frame and the partial text still lands in the transcript, instead
          // of the stream simply stopping and leaving the conversation looking
          // live forever.
          turn.reportError(
            new Error(
              `Agent session ended before this turn finished (${update.update.reason ?? 'connection_closed'})`,
            ),
          )
        }

        void finishTurn(turn)

        return
      }
      const turn = openTurn(update)

      if (update.update.kind === 'text') {
        turn.text += update.update.text
        turn.orderedParts.appendText(update.update.text)
        turn.emit({ type: 'text-delta', delta: update.update.text })
      } else if (update.update.update.kind === 'thought') {
        turn.reasoning += update.update.update.text
        turn.orderedParts.appendReasoning(update.update.update.text)
        turn.emit({ type: 'reasoning-delta', delta: update.update.update.text })
      } else if (update.update.update.kind === 'tool') {
        const toolUpdate = update.update.update

        turn.handleTool(toolUpdate)
        if (turn.toolSteps().some((step) => step.toolCallId === toolUpdate.toolCallId)) {
          turn.orderedParts.appendTool(toolUpdate.toolCallId)
        }
      }
    },
    // Governed tool calls in a runtime-started turn go through the very same
    // authorization path as an interactive turn: Full Access auto-allows, and
    // anything else raises an approval on this turn's own run stream. Both
    // identities are passed for the same reason an interactive turn passes
    // them — waits and grants are actor-scoped, the pending-message check that
    // supersedes them is owner-scoped.
    permission: (permission: ClaudeCodeAutonomousPermission): Promise<OpenAbPermissionOutcome> => {
      const turn = openTurn(permission)

      return (deps.authorize ?? handleOpenAbPermissionRequest)({
        userId: permission.userId,
        conversationOwnerUserId: permission.conversationOwnerUserId,
        conversationId: permission.conversationId,
        request: permission.request,
        emit: turn.emit,
        handleTool: turn.handleTool,
      })
    },
  }
}
