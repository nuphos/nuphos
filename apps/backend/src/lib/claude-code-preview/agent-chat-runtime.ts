import { getConversationPreviewAttachment } from '@/lib/agent/db'
import { RunHandoff } from '@/lib/lifecycle'

import { registry } from './agent-chat-registry'
import {
  setClaudeCodeAutonomousPermissionHandler,
  setClaudeCodeAutonomousUpdateHandler,
} from './autonomous-session-observer'
import { backgroundWorkPrompt, markBackgroundWorkLost } from './background-work'
import { settledCodexStopReason } from './codex-turn-settle'
import { openConversationSession } from './open-conversation-session'
import { OpenAbRpcError } from './openab-acp-errors'
import { redactedPromptUpdates } from './redacted-prompt-updates'
import { retractedPrompt } from './retracted-notice'
import { materializeRuntimeAttachments } from './runtime-attachments'
import {
  assertConversationRuntimeAvailable,
  assertRuntimeNotDeleting,
} from './runtime-portability-store'
import { refusal } from './runtime-refusal'
import { previewSessionPrincipalChanged, sessionContextStale } from './session-context'
import { probeExecutionState } from './session-execution-state'
import { observeSession, resumeSessionOn } from './session-reattach'
import {
  MAX_PREVIEW_CONVERSATION_ID_LENGTH,
  cancelActiveTeamTurn,
  previewRuntimeCwd,
} from './team-openab-runtime'
import { RENEWED_TOKEN_TTL_SEC, renewTurnCredentials } from './turn-credential-renewal'
import { RuntimeStateProbeError } from './turn-diagnostics'

import type { previewSessionAccess } from './credentials-mcp'
import type { AcpHttpMcpServer, PreviewAgentUpdate } from './openab-acp-client'
import type { OpenAbPermissionHandler, OpenAbSessionRuntime } from './openab-acp-session'
import type { RuntimeAttachment } from './runtime-attachments'
import type { TeamRuntimeEndpoint, TeamSession } from './team-openab-runtime'

export {
  previewRuntimeObservability,
  cancelPreviewConversationSession,
} from './agent-chat-registry'

export { openConversationSession } from './open-conversation-session'

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
  /** What Nuphos adds to the turn, sent in the blocks before the user's own text. */
  message: string
  /** The user's own words, sent last so a leading slash command reaches the agent. */
  text: string
  attachments?: RuntimeAttachment[]
  endpoint: TeamRuntimeEndpoint
  mcpServers?: AcpHttpMcpServer[]
  /** Nuphos context appended to Claude Code's system prompt (session-scoped). */
  systemPrompt?: string
  /** Session-scoped environment and native skills materialized before discovery. */
  runtime?: OpenAbSessionRuntime
  /** History preamble, resolved lazily when creating a fresh inner session. */
  freshSessionMessage?: (uncertain?: boolean) => string
  signal: AbortSignal
  onTextDelta: (
    text: string,
    metadata?: import('./preview-agent-update').PreviewTextMetadata,
  ) => void
  onAgentUpdate?: (update: PreviewAgentUpdate) => void
  onPermissionRequest?: OpenAbPermissionHandler
  /** Re-mints this turn's MCP servers and runtime env with the given token lifetime. */
  renewAccess?: NonNullable<ReturnType<typeof previewSessionAccess>['renew']>
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
    args.conversationOwnerUserId ?? args.userId,
  )

  // Query runtime admission without attaching a replacement prompt socket.
  const observe = () =>
    probeExecutionState({
      teamId: session.teamId,
      sessionId: session.conversationId,
      userId: session.conversationOwnerUserId ?? session.userId,
      agentRuntime: session.endpoint.provider ?? 'claude-code',
      runtimeId: session.endpoint.runtimeId,
      claudeCodePreview: {
        runtimeUrl: session.endpoint.url,
        openabSessionId: session.openabSessionId,
      },
    }).catch((cause: unknown) => {
      throw new RuntimeStateProbeError(cause)
    })
  const observed = await observe()

  if (observed.schemaVersion === 2 && observed.phase === 'resume_disconnected') {
    await resumeSessionOn(session, await registry.acquire(session.teamId, session.endpoint))
    const reattached = await observe()

    // Still parked: the next prompt would only land here again. Fail this one.
    if (reattached.schemaVersion === 2 && reattached.phase === 'resume_disconnected')
      throw new Error('The agent could not be reattached to its background work. Try again later.')
    // The same refusal admission gives a busy runtime: the client keeps the
    // message queued and sends it once the continuation finishes.
    throw refusal(
      'Reconnected to the agent; it is continuing after a background task. Send again once it finishes.',
    )
  }
  if (observed.schemaVersion !== 2)
    throw new Error(
      typeof observed.label === 'string' ? observed.label : 'Agent is not accepting messages',
    )
  if (!observed.actions?.send)
    throw refusal(observed.label ?? 'The agent cannot accept a message yet')

  const principalChanged = previewSessionPrincipalChanged(session, args.userId, args.runtime)

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
  let renewal: ReturnType<typeof renewTurnCredentials> | undefined
  const onAbort = () => {
    if (args.signal.reason instanceof RunHandoff) void renewal?.handOff()
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
    // A runtime that takes credentials mid-turn gets short-lived tokens, renewed
    // for as long as this turn runs; older runtimes keep the long default. Desktop
    // shells do not re-read the token file yet, so local runtimes keep it too.
    const renew = client.credentialRefresh && !session.endpoint.local ? args.renewAccess : undefined
    const refresh = client.refreshCredentials?.bind(client)

    if (renew && refresh) {
      const access = renew(RENEWED_TOKEN_TTL_SEC)

      nextContext.mcpServers = access.mcpServers
      nextContext.runtime = { ...nextContext.runtime, env: access.runtimeEnv }
      renewal = renewTurnCredentials({
        installed: access.runtimeEnv,
        renew,
        refresh: (expected, next) => refresh(session.openabSessionId, expected, next),
      })
    }
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
    const attachments = await materializeRuntimeAttachments(
      args.teamId,
      args.conversationOwnerUserId ?? args.userId,
      args.endpoint,
      args.attachments ?? [],
    )

    if (activeTurn.cancelled) return { stopReason: 'cancelled' }
    // The lead ends with the current message's header, nearest its words.
    const lead = [
      attachments.length
        ? 'Attached files are already on this runtime. Use your native image/file reading tools to inspect them before answering.'
        : '',
      await retractedPrompt(session, fresh),
      await backgroundWorkPrompt(session, fresh, args),
    ]
      .filter(Boolean)
      .join('\n\n')
    const text = redactedPromptUpdates(args.onTextDelta, args.onAgentUpdate)
    // A refusal or transport failure does not grant authority to cancel or
    // replace the runtime session. Its snapshot remains the lifecycle source.
    const result = await client
      .prompt(
        session.openabSessionId,
        args.text,
        text.onTextDelta,
        text.onAgentUpdate,
        args.onPermissionRequest,
        () => {
          // Runtime admission, not a backend flag, selects the command whose
          // principal and cancellation route own subsequent output.
          Object.assign(session, nextContext)
          session.activeTurn = activeTurn
          if (activeTurn.cancelled) client.cancel(session.openabSessionId)
        },
        nextContext,
        attachments,
        lead,
      )
      .catch((error: unknown) => {
        // The runtime's own busy rejection: another turn won the race since the check above.
        throw error instanceof OpenAbRpcError && error.code === -32001
          ? refusal(error.message)
          : error
      })
      .finally(() => {
        text.flush()
      })

    return { stopReason: await settledCodexStopReason(session, result, text.last()) }
  } finally {
    renewal?.stop()
    args.signal.removeEventListener('abort', onAbort)
    if (session.activeTurn === activeTurn) {
      session.activeTurn = undefined
    }
  }
}
