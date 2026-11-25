import { getConversationPreviewAttachment } from '@/lib/agent/db'
import { sameRuntimeUrl } from '@/lib/agent/devices/local-runtime/address'
import { instructionsUpdate } from '@/lib/instructions/prompt'
import { RunHandoff } from '@/lib/lifecycle'

import { registry } from './agent-chat-registry'
import {
  setClaudeCodeAutonomousPermissionHandler,
  setClaudeCodeAutonomousUpdateHandler,
} from './autonomous-session-observer'
import { backgroundWorkPrompt, markBackgroundWorkLost } from './background-work'
import { openConversationSession } from './open-conversation-session'
import { pendingTurnDefaults } from './own-session-config'
import { promptFailure } from './prompt-failure'
import { redactedPromptUpdates } from './redacted-prompt-updates'
import { retractedPrompt } from './retracted-notice'
import { materializeRuntimeAttachments } from './runtime-attachments'
import { noteTurnSignIn } from './runtime-auth-refusal'
import { assertConversationRuntimeAvailable } from './runtime-portability-store'
import { refusal } from './runtime-refusal'
import { settledTurn } from './session-config-record'
import {
  previewSessionPrincipalChanged,
  sessionContextStale,
  turnDefaults,
} from './session-context'
import { pushSessionCredentials } from './session-credential-push'
import { probeExecutionState } from './session-execution-state'
import { observeSession, resumeSessionOn } from './session-reattach'
import {
  MAX_PREVIEW_CONVERSATION_ID_LENGTH,
  cancelActiveTeamTurn,
  RUNTIME_CWD,
} from './team-openab-runtime'
import { renewTurnCredentials } from './turn-credential-renewal'
import { probeFailure } from './turn-diagnostics'

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
 * Reuses the shared Team connection, reattaches with `session/load` after a transport loss, and
 * keeps one active turn per conversation. `unsent`: stopped before the agent received the prompt.
 * How it ends also notes whether the agent's provider refused its sign-in (runtime-auth-refusal).
 */
export const runClaudeCodePreviewPrompt = (args: Parameters<typeof promptTurn>[0]) =>
  noteTurnSignIn(args.teamId, args.endpoint.runtimeId, promptTurn(args))

async function promptTurn(args: {
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
  /** Mints this turn's runtime env again; the running session gets it every 10 minutes. */
  renewRuntimeEnv?: Parameters<typeof renewTurnCredentials>[0]['mint']
}): Promise<{ stopReason: string; unsent?: true }> {
  if (args.conversationId.length > MAX_PREVIEW_CONVERSATION_ID_LENGTH) {
    throw new Error('Conversation id is invalid.')
  }
  await assertConversationRuntimeAvailable(args.conversationId)
  const currentAttachment = await getConversationPreviewAttachment(args.conversationId, args.teamId)

  if (currentAttachment && !sameRuntimeUrl(currentAttachment.runtimeUrl, args.endpoint.url))
    throw new Error('Conversation runtime changed. Retry this message.')
  let fresh = false
  const open = () =>
    openConversationSession(
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
  // Ask admission before resuming the session here: its output goes to the last replica
  // to resume it, so a refused message must not take a running turn away (#4540).
  const observe = () =>
    probeExecutionState({
      teamId: args.teamId,
      sessionId: args.conversationId,
      userId: args.conversationOwnerUserId ?? args.userId,
      agentRuntime: args.endpoint.provider ?? 'claude-code',
      runtimeId: args.endpoint.runtimeId,
      claudeCodePreview: { runtimeUrl: args.endpoint.url, openabSessionId },
    }).catch(async (cause: unknown) => {
      throw await probeFailure(cause, args.conversationId, args.endpoint)
    })
  const openabSessionId = currentAttachment?.openabSessionId ?? (await open()).openabSessionId
  const observed = await observe()

  if (observed.schemaVersion === 2 && observed.phase === 'resume_disconnected') {
    await resumeSessionOn(await open(), await registry.acquire(args.teamId, args.endpoint))
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

  const session = await open()
  const principalChanged = previewSessionPrincipalChanged(session, args.userId, args.runtime)

  const nextContext = {
    mcpServers: args.mcpServers ?? session.mcpServers,
    systemPrompt: args.systemPrompt ?? (principalChanged ? undefined : session.systemPrompt),
    runtime: {
      ...(args.runtime || principalChanged ? args.runtime : session.runtime),
      defaults: turnDefaults(session, currentAttachment),
      // Fixed when the session opened; a turn's own runtime context never carries it.
      workingDirectory: session.runtime?.workingDirectory,
    },
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

  let renewal: ReturnType<typeof renewTurnCredentials> | undefined

  args.signal.addEventListener('abort', onAbort, { once: true })
  try {
    // Later turns stay on the runtime the conversation was placed on, even if
    // the team's resolved runtime set has changed since.
    const client = await registry.acquire(session.teamId, session.endpoint)

    activeTurn.client = client
    if (activeTurn.cancelled) return { stopReason: 'cancelled', unsent: true }
    nextContext.runtime.defaults = await pendingTurnDefaults(client, session, currentAttachment)
    if (activeTurn.cancelled) return { stopReason: 'cancelled', unsent: true }
    // MCP tokens, runtime environment, and the personal portion of the system
    // prompt are execution-principal scoped. A shared Slack conversation can
    // legitimately switch actors between serialized turns; re-load even on
    // the same transport so the next actor never inherits the previous one's
    // credentials or personal context.
    const rebind = session.client !== client || principalChanged

    // A changed system prompt is no reason to load: agents keep the one their session started with.
    if (rebind || sessionContextStale(session, Date.now())) {
      const { alive } = await client.loadSession(
        session.openabSessionId,
        RUNTIME_CWD,
        nextContext.mcpServers,
        nextContext.systemPrompt,
        nextContext.runtime,
      )

      session.contextDeliveredAt = Date.now()
      if (!alive) fresh = await markBackgroundWorkLost(session, 'session_lost')
      if (activeTurn.cancelled) return { stopReason: 'cancelled', unsent: true }
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

    if (activeTurn.cancelled) return { stopReason: 'cancelled', unsent: true }
    const update = await instructionsUpdate(args.teamId, args.userId, args.conversationId, fresh)
    // The lead ends with the current message's header, nearest its words.
    const lead = [
      attachments.length
        ? 'Attached files are already on this runtime. Use your native image/file reading tools to inspect them before answering.'
        : '',
      await retractedPrompt(session, fresh),
      session.endpoint.provider === 'codex' ? '' : update,
      await backgroundWorkPrompt(session, fresh, args),
    ]
      .filter(Boolean)
      .join('\n\n')
    const target = {
      teamId: session.teamId,
      conversationId: session.conversationId,
      userId: session.conversationOwnerUserId ?? session.userId,
      provider: session.endpoint.provider ?? 'claude-code',
      runtimeId: session.endpoint.runtimeId,
      runtimeUrl: session.endpoint.url,
      openabSessionId: session.openabSessionId,
    }
    const text = redactedPromptUpdates(args.onTextDelta, args.onAgentUpdate, target)

    if (args.renewRuntimeEnv)
      renewal = renewTurnCredentials({
        installed: nextContext.runtime.env,
        mint: args.renewRuntimeEnv,
        push: (expected, next) => pushSessionCredentials(target, expected, next),
      })
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
        { ...nextContext, instructionsUpdate: session.endpoint.provider === 'codex' ? update : '' },
        attachments,
        lead,
      )
      .catch(async (error: unknown) => {
        throw await promptFailure(error, session, nextContext.runtime.defaults)
      })
      .finally(() => {
        text.flush()
      })

    return { stopReason: await settledTurn(client, session, result, text.last()) }
  } finally {
    renewal?.stop()
    args.signal.removeEventListener('abort', onAbort)
    if (session.activeTurn === activeTurn) {
      session.activeTurn = undefined
    }
  }
}
