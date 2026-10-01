import { registry, sessionsByConversation, sessionCreations } from './agent-chat-registry'

// Routes an ordinary /agent/chat turn through the Team's OpenAB Claude Code
// runtime when the team selected it, so the desktop app needs no dedicated
// preview surface. State is process-local: one shared ACP connection per
// (team, runtime), one OpenAB session per conversation.
import {
  setClaudeCodeAutonomousPermissionHandler,
  setClaudeCodeAutonomousUpdateHandler,
} from './autonomous-session-observer'
import { backgroundWorkPrompt, markBackgroundWorkLost } from './background-work'
import { lastTextChunkTracker, settledCodexStopReason } from './codex-turn-settle'
import { attachOpenAbSession } from './openab-session-attach'
import {
  assertConversationRuntimeAvailable,
  assertRuntimeNotDeleting,
} from './runtime-portability-store'
import { previewSessionPrincipalChanged, sessionContextStale } from './session-context'
import { conversationExecutionState } from './session-execution-state'
import { observeSession, resumeSessionOn } from './session-reattach'
import {
  MAX_PREVIEW_CONVERSATION_ID_LENGTH,
  MAX_TEAM_PREVIEW_CONVERSATIONS,
  cancelActiveTeamTurn,
  previewRuntimeCwd,
} from './team-openab-runtime'

import type { AcpHttpMcpServer, PreviewAgentUpdate } from './openab-acp-client'
import type { OpenAbPermissionHandler, OpenAbSessionRuntime } from './openab-acp-session'
import type { TeamRuntimeEndpoint, TeamSession } from './team-openab-runtime'

import { getConversationPreviewAttachment } from '@/lib/agent/db'
import { RunHandoff } from '@/lib/lifecycle'

export {
  previewRuntimeObservability,
  cancelPreviewConversationSession,
} from './agent-chat-registry'

export { setClaudeCodeAutonomousUpdateHandler, setClaudeCodeAutonomousPermissionHandler }
export type {
  ClaudeCodeAutonomousContext,
  ClaudeCodeAutonomousPermission,
  ClaudeCodeAutonomousUpdate,
} from './autonomous-session-observer'
export { resolveConversationChatRuntime } from './conversation-chat-route'
export type { ConversationChatRuntime } from './conversation-chat-route'

// A handoff lets go of the stream only; the runtime keeps running the turn.
const cancels = (signal: AbortSignal) => signal.aborted && !(signal.reason instanceof RunHandoff)

export {
  SESSION_CONTEXT_REFRESH_MS,
  previewSessionPrincipalChanged,
  sessionContextStale,
} from './session-context'

export async function openConversationSession(
  teamId: string,
  conversationId: string,
  userId: string,
  locale: string,
  endpoint: TeamRuntimeEndpoint,
  mcpServers: AcpHttpMcpServer[],
  systemPrompt: string | undefined,
  runtime: OpenAbSessionRuntime | undefined,
  onFreshSession?: () => void,
): Promise<TeamSession> {
  const key = `${teamId}:${conversationId}`
  const existing = sessionsByConversation.get(key)

  if (existing) {
    const attachment = await getConversationPreviewAttachment(conversationId, teamId)

    if (
      existing.endpoint.url === endpoint.url &&
      existing.openabSessionId === attachment?.openabSessionId
    )
      return existing
    existing.stopObserving?.()
    sessionsByConversation.delete(key)
  }
  let creation = sessionCreations.get(key)?.promise

  if (!creation) {
    const teamCount =
      [...sessionsByConversation.values()].filter((session) => session.teamId === teamId).length +
      [...sessionCreations.values()].filter((pending) => pending.teamId === teamId).length

    if (teamCount >= MAX_TEAM_PREVIEW_CONVERSATIONS) {
      throw new Error('The Team preview session limit was reached.')
    }
    creation = (async () => {
      const client = await registry.acquire(teamId, endpoint)
      const { openabSessionId, fresh, defaults } = await attachOpenAbSession(
        client,
        teamId,
        conversationId,
        endpoint,
        mcpServers,
        systemPrompt,
        runtime,
      )

      if (fresh) onFreshSession?.()
      const session: TeamSession = {
        teamId,
        conversationId,
        userId,
        locale,
        openabSessionId,
        client,
        endpoint,
        mcpServers,
        ...(systemPrompt ? { systemPrompt } : {}),
        runtime: { ...runtime, defaults },
        contextDeliveredAt: Date.now(),
      }

      observeSession(session)

      sessionsByConversation.set(key, session)

      return session
    })().finally(() => sessionCreations.delete(key))
    sessionCreations.set(key, { teamId, promise: creation })
  }

  return creation
}

/**
 * Runs one prompt on the conversation's OpenAB session, streaming text deltas.
 * Reuses the shared Team connection, reattaches with `session/load` after a
 * transport loss, and keeps one active turn per conversation.
 */
export async function runClaudeCodePreviewPrompt(args: {
  teamId: string
  conversationId: string
  userId: string
  /** Durable conversation owner, when it differs from the turn's actor. */
  conversationOwnerUserId?: string
  locale: string
  message: string
  endpoint: TeamRuntimeEndpoint
  mcpServers?: AcpHttpMcpServer[]
  /** Nuphos context appended to Claude Code's system prompt (session-scoped). */
  systemPrompt?: string
  /** Session-scoped environment and native skills materialized before discovery. */
  runtime?: OpenAbSessionRuntime
  /**
   * Text to send instead of `message` when this turn had to create a brand-new
   * inner session for an existing conversation (history preamble). Resolved
   * lazily so the caller only renders it when it is actually needed.
   */
  freshSessionMessage?: (uncertain?: boolean) => string
  signal: AbortSignal
  onTextDelta: (text: string) => void
  onAgentUpdate?: (update: PreviewAgentUpdate) => void
  onPermissionRequest?: OpenAbPermissionHandler
}): Promise<{ stopReason: string }> {
  if (args.conversationId.length > MAX_PREVIEW_CONVERSATION_ID_LENGTH) {
    throw new Error('Conversation id is invalid.')
  }
  await assertConversationRuntimeAvailable(args.conversationId)
  await assertRuntimeNotDeleting(args.teamId, args.endpoint.runtimeId, args.endpoint.url)
  const currentAttachment = await getConversationPreviewAttachment(args.conversationId, args.teamId)

  if (currentAttachment && currentAttachment.runtimeUrl !== args.endpoint.url)
    throw new Error('Conversation runtime changed. Retry this message.')
  let fresh = false
  const session = await openConversationSession(
    args.teamId,
    args.conversationId,
    args.userId,
    args.locale,
    args.endpoint,
    args.mcpServers ?? [],
    args.systemPrompt,
    args.runtime,
    () => {
      fresh = true
    },
  )

  // Local stream bookkeeping is not session admission. OpenAB atomically
  // accepts/rejects the prompt across replicas and exposes that same decision.
  // A replacement prompt socket has not loaded this session yet. Query the
  // operator channel, which can observe it without attaching or taking output.
  const observed = await conversationExecutionState({
    teamId: session.teamId,
    sessionId: session.conversationId,
    userId: session.conversationOwnerUserId ?? session.userId,
    agentRuntime: session.endpoint.provider ?? 'claude-code',
    runtimeId: session.endpoint.runtimeId,
    claudeCodePreview: {
      runtimeUrl: session.endpoint.url,
      openabSessionId: session.openabSessionId,
    },
  })

  if (observed.schemaVersion === 2 && observed.phase === 'resume_disconnected') {
    await resumeSessionOn(session, await registry.acquire(session.teamId, session.endpoint))
    throw new Error(
      'Reconnected to the agent; it is continuing after a background task. Send again once it finishes.',
    )
  }
  if (observed.schemaVersion !== 2 || !(observed.actions as { send?: boolean } | undefined)?.send)
    throw new Error(
      typeof observed.label === 'string' ? observed.label : 'Agent is not accepting messages',
    )

  const principalChanged = previewSessionPrincipalChanged(session, args.userId)

  const nextContext = {
    mcpServers: args.mcpServers ?? session.mcpServers,
    systemPrompt: args.systemPrompt ?? (principalChanged ? undefined : session.systemPrompt),
    runtime:
      args.runtime || principalChanged
        ? { ...args.runtime, defaults: session.runtime?.defaults }
        : session.runtime,
    userId: args.userId,
    conversationOwnerUserId: args.conversationOwnerUserId ?? args.userId,
    locale: args.locale,
  }
  const activeTurn = { cancelled: cancels(args.signal) } as NonNullable<TeamSession['activeTurn']>
  const onAbort = () => {
    if (!cancels(args.signal)) return
    activeTurn.cancelled = true
    if (session.activeTurn === activeTurn) cancelActiveTeamTurn(session)
  }

  args.signal.addEventListener('abort', onAbort, { once: true })
  try {
    // Later turns stay on the runtime the conversation was placed on, even if
    // the team's resolved runtime set has changed since.
    const client = await registry.acquire(session.teamId, session.endpoint)

    activeTurn.client = client
    if (activeTurn.cancelled) return { stopReason: 'cancelled' }
    // MCP tokens, runtime environment, and the personal portion of the system
    // prompt are execution-principal scoped. A shared Slack conversation can
    // legitimately switch actors between serialized turns; re-load even on
    // the same transport so the next actor never inherits the previous one's
    // credentials or personal context.
    const rebind = session.client !== client || principalChanged

    if (
      rebind ||
      nextContext.systemPrompt !== session.systemPrompt ||
      sessionContextStale(session, Date.now())
    ) {
      const { alive } = await client.loadSession(
        session.openabSessionId,
        previewRuntimeCwd(session.conversationId),
        nextContext.mcpServers,
        nextContext.systemPrompt,
        nextContext.runtime,
      )

      session.contextDeliveredAt = Date.now()
      if (!alive) fresh = await markBackgroundWorkLost(session, 'session_lost')
      if (activeTurn.cancelled) return { stopReason: 'cancelled' }
      // Transport routing only; runtime admission owns execution.
      if (rebind) {
        session.client = client
        observeSession(session)
      }
    }
    const message = await backgroundWorkPrompt(session, fresh, args)
    const text = lastTextChunkTracker(args.onTextDelta)
    // A refusal or transport failure does not grant authority to cancel or
    // replace the runtime session. Its snapshot remains the lifecycle source.
    const result = await client.prompt(
      session.openabSessionId,
      message,
      text.onTextDelta,
      args.onAgentUpdate,
      args.onPermissionRequest,
      () => {
        // Runtime admission, not a backend flag, selects the command whose
        // principal and cancellation route own subsequent output.
        Object.assign(session, nextContext)
        session.activeTurn = activeTurn
        if (activeTurn.cancelled) client.cancel(session.openabSessionId)
      },
      nextContext,
    )

    return { stopReason: await settledCodexStopReason(session, result, text.last()) }
  } finally {
    args.signal.removeEventListener('abort', onAbort)
    if (session.activeTurn === activeTurn) {
      session.activeTurn = undefined
    }
  }
}
