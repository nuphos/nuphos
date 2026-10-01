import { getConversationPreviewAttachment } from '@/lib/agent/db'
import { logError, logEvent } from '@/lib/observability'

import {
  clearCodexAsyncTaskState,
  isTrackedCodexAsyncTaskToolUpdate,
  observeCodexAsyncTask,
} from './codex-async-task-wakeup'

import type { OpenAbSessionUpdate } from './openab-acp-client'
import type { OpenAbPermissionOutcome, OpenAbPermissionRequest } from './openab-acp-session'
import type { PreviewAgentUpdate } from './preview-agent-update'
import type { TeamSession } from './team-openab-runtime'

export type ClaudeCodeAutonomousContext = {
  teamId: string
  conversationId: string
  /** Execution principal of the session — the latest interactive turn's actor. */
  userId: string
  /** Durable conversation owner; owner-scoped checks must use this. */
  conversationOwnerUserId: string
  locale: string
}

export type ClaudeCodeAutonomousUpdate = ClaudeCodeAutonomousContext & {
  update: OpenAbSessionUpdate
}

export type ClaudeCodeAutonomousPermission = ClaudeCodeAutonomousContext & {
  request: OpenAbPermissionRequest
}

let updateHandler: ((update: ClaudeCodeAutonomousUpdate) => void | Promise<void>) | undefined
let permissionHandler:
  ((permission: ClaudeCodeAutonomousPermission) => Promise<OpenAbPermissionOutcome>) | undefined

export function setClaudeCodeAutonomousUpdateHandler(
  handler: (update: ClaudeCodeAutonomousUpdate) => void | Promise<void>,
): void {
  updateHandler = handler
}

export function setClaudeCodeAutonomousPermissionHandler(
  handler:
    ((permission: ClaudeCodeAutonomousPermission) => Promise<OpenAbPermissionOutcome>) | undefined,
): void {
  permissionHandler = handler
}

type BackgroundToolHandler = (
  context: ClaudeCodeAutonomousContext,
  update: Extract<PreviewAgentUpdate, { kind: 'tool' }>,
) => Promise<void>
let backgroundToolHandler: BackgroundToolHandler | undefined

export function setClaudeCodeBackgroundToolHandler(handler: BackgroundToolHandler): void {
  backgroundToolHandler = handler
}

function autonomousContext(session: TeamSession): ClaudeCodeAutonomousContext {
  return {
    teamId: session.teamId,
    conversationId: session.conversationId,
    userId: session.userId,
    conversationOwnerUserId: session.conversationOwnerUserId ?? session.userId,
    locale: session.locale,
  }
}

function autonomousUpdate(session: TeamSession, update: OpenAbSessionUpdate) {
  return { ...autonomousContext(session), update }
}

const cancelled = (): OpenAbPermissionOutcome => ({ outcome: { outcome: 'cancelled' } })

/** The durable attachment still names this exact runtime and inner session. */
async function attachmentIsCurrent(session: TeamSession): Promise<boolean> {
  const attachment = await getConversationPreviewAttachment(session.conversationId, session.teamId)

  return Boolean(
    attachment &&
    attachment.runtimeUrl === session.endpoint.url &&
    attachment.openabSessionId === session.openabSessionId,
  )
}

function evictStaleSession(session: TeamSession): void {
  session.stopObserving?.()
  clearCodexAsyncTaskState(session)
  session.client.cancel(session.openabSessionId)
  session.runtimeThreadStatus = undefined
  session.autonomousTranscriptOpen = false
}

function logPermissionCancel(
  reason: string,
  session: TeamSession,
  request: OpenAbPermissionRequest,
): void {
  logEvent('warn', 'agent.openab_permission.cancelled', {
    reason,
    openab_session_id: request.sessionId,
    tool_call_id: request.toolCall.toolCallId,
    session_id: session.conversationId,
  })
}

async function invokePermissionHandler(
  session: TeamSession,
  request: OpenAbPermissionRequest,
): Promise<OpenAbPermissionOutcome> {
  if (!permissionHandler) {
    logPermissionCancel('no_autonomous_permission_handler', session, request)

    return cancelled()
  }
  // An authorization path must not outlive the attachment it belongs to. After
  // a runtime migration or a forceNew replacement this listener is stale, and
  // answering here — Full Access auto-allow included — would authorize a tool
  // call on behalf of a conversation that has already moved.
  if (!(await attachmentIsCurrent(session))) {
    evictStaleSession(session)
    logPermissionCancel('stale_session_attachment', session, request)

    return cancelled()
  }
  // The runtime-issued permission RPC is itself the pending request. A stale
  // transcript status must not deny it or invent a second execution state.
  session.autonomousTranscriptOpen = true
  const outcome = await permissionHandler({ ...autonomousContext(session), request })

  // A decision the user has to make can sit here for minutes, long enough for
  // the conversation to migrate or be replaced. Authority is only what holds
  // at the moment the allow is handed back, so check again before returning
  // one; a cancel is already fail-closed and needs no recheck.
  if (outcome.outcome.outcome !== 'selected' || (await attachmentIsCurrent(session))) {
    return outcome
  }
  evictStaleSession(session)
  logPermissionCancel('stale_session_attachment_after_decision', session, request)

  return cancelled()
}

function logHandlerError(error: unknown, session: TeamSession): void {
  logError('agent.chat.preview_autonomous_handler.error', error, {
    team_id: session.teamId,
    session_id: session.conversationId,
    user_id: session.userId,
  })
}

async function invokeUpdateHandler(
  session: TeamSession,
  update: OpenAbSessionUpdate,
): Promise<void> {
  if (!(await attachmentIsCurrent(session))) {
    evictStaleSession(session)

    return
  }
  await updateHandler?.(autonomousUpdate(session, update))
}

export function observeAutonomousUpdates(session: TeamSession): void {
  session.stopObserving?.()
  let updateChain = Promise.resolve()
  const stopPermissions = session.client.onSessionPermission(session.openabSessionId, (request) =>
    invokePermissionHandler(session, request),
  )
  const backgroundTool = (update: OpenAbSessionUpdate) => {
    if (update.kind !== 'agent' || update.update.kind !== 'tool') return
    const tool = update.update

    if (tool.status !== 'completed' && tool.status !== 'failed') return

    void attachmentIsCurrent(session)
      .then(async (current) => {
        if (current) await backgroundToolHandler?.(autonomousContext(session), tool)
      })
      .catch((error: unknown) => {
        logHandlerError(error, session)
      })
  }
  const deliver = (update: OpenAbSessionUpdate) => {
    if (update.kind === 'agent' && update.update.kind === 'runtime-state') {
      session.runtimeProjectionObserved = true
      const snapshot = update.update.snapshot

      update = {
        kind: 'status',
        runtimeSnapshot: snapshot,
        status: ['failed', 'resume_failed', 'interrupted'].includes(snapshot.phase ?? '')
          ? 'interrupted'
          : snapshot.state,
      }
    } else if (update.kind === 'status' && session.runtimeProjectionObserved) {
      // Native-provider idle may precede gateway completion and buffered text.
      return
    }
    // Legacy usage frames are accounting, never session lifecycle.
    if (
      update.kind === 'complete' &&
      (update.origin as { kind?: string } | undefined)?.kind !== 'async-task'
    )
      return
    if (update.kind === 'async-task') {
      observeCodexAsyncTask(session, update)

      return
    }
    if (isTrackedCodexAsyncTaskToolUpdate(session, update)) {
      // The command card was emitted in the turn that launched the task. Its
      // late completion is already in Codex's session history and must not open
      // a second assistant turn containing a duplicate card.
      backgroundTool(update)

      return
    }

    if (update.kind === 'status') {
      session.runtimeThreadStatus = update.status
    }
    // Runtime lifecycle is authoritative. In particular, tool output after
    // idle belongs to a background command, not a newly running model turn.
    // Never count tools or infer a turn boundary from their completion.
    if (update.kind === 'status') {
      if (session.activeTurn) return
      if (!['active', 'idle', 'notLoaded', 'systemError', 'interrupted'].includes(update.status))
        return
    }
    const observedUpdate: OpenAbSessionUpdate =
      update.kind === 'status' && update.status === 'idle'
        ? {
            kind: 'complete',
            ...(update.runtimeSnapshot ? { runtimeSnapshot: update.runtimeSnapshot } : {}),
          }
        : update.kind === 'status' &&
            (update.status === 'notLoaded' ||
              update.status === 'systemError' ||
              update.status === 'interrupted')
          ? {
              kind: 'interrupted',
              reason: `runtime_${update.status}`,
              ...(update.runtimeSnapshot ? { runtimeSnapshot: update.runtimeSnapshot } : {}),
            }
          : update
    const terminal = observedUpdate.kind === 'complete' || observedUpdate.kind === 'interrupted'

    if (!terminal && update.kind !== 'status' && session.runtimeThreadStatus !== 'active') {
      // A background result updates its existing card without opening a run.
      backgroundTool(update)

      return
    }
    if (!terminal) {
      // A broadcast snapshot is not evidence of output ownership.
      if (update.kind !== 'status') session.autonomousTranscriptOpen = true
    } else {
      if (!session.autonomousTranscriptOpen) return
      session.autonomousTranscriptOpen = false
      session.runtimeThreadStatus = observedUpdate.kind === 'complete' ? 'idle' : undefined
    }

    // attachmentIsCurrent is asynchronous. Preserve wire order across those
    // checks so a fast idle/complete frame cannot overtake the content that
    // opens its turn, and keep the chain usable after one handler failure.
    const delivery = updateChain.then(() => invokeUpdateHandler(session, observedUpdate))
    const settled = delivery.catch((error: unknown) => {
      logHandlerError(error, session)
      if (updateChain === settled) {
        session.autonomousTranscriptOpen = false
      }
    })

    updateChain = settled
  }
  const stopUpdates = session.client.onSessionUpdate(session.openabSessionId, deliver)

  session.stopObserving = () => {
    clearCodexAsyncTaskState(session)
    session.runtimeThreadStatus = undefined
    stopUpdates()
    stopPermissions()
  }
}
