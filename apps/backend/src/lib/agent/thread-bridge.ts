import { randomUUID } from 'node:crypto'

import {
  getSessionBypass,
  initializeSessionBypass,
  setSessionBypass,
} from '@/lib/agent/auto-mode/store'
import { sessionsByConversation } from '@/lib/claude-code-preview/agent-chat-registry'
import { getTeamMembership } from '@/lib/identity'
import { logError, logEvent } from '@/lib/observability'

import {
  getConversationBySessionId,
  recordAgentEvent,
  setConversationArchived,
  setConversationParent,
  upsertConversationShell,
} from './db'

import type { AgentConversation } from './db'

export type ThreadActor = { userId: string; teamId: string; sessionId: string; locale: string }
export type ThreadTurn = ThreadActor & {
  targetSessionId: string
  messageId: string
  prompt: string
}

export async function authorizeThreadActor(actor: ThreadActor): Promise<AgentConversation> {
  const source = await getConversationBySessionId(actor.sessionId)

  if (
    !source ||
    source.userId !== actor.userId ||
    source.teamId !== actor.teamId ||
    !(await getTeamMembership(actor.userId, actor.teamId))
  ) {
    throw new Error('Thread tools require your own conversation in a team you still belong to.')
  }
  if (!source.credentialAccess) throw new Error('Select credentials for this conversation first.')

  return source
}

export async function authorizeThreadDelivery(
  data: ThreadActor & { targetSessionId: string },
): Promise<{ source: AgentConversation; target: AgentConversation }> {
  const source = await authorizeThreadActor(data)
  const target = await getConversationBySessionId(data.targetSessionId)

  if (
    !target ||
    target.sessionId === source.sessionId ||
    target.userId !== data.userId ||
    target.teamId !== data.teamId ||
    target.archivedAt
  ) {
    throw new Error('Target must be another unarchived conversation you own in this team.')
  }

  return { source, target }
}

function receipt(
  actor: ThreadActor,
  threadId: string,
  messageId: string,
  status: 'started' | 'delivered',
) {
  return {
    status,
    threadId,
    messageId,
    _links: { web: `/teams/${actor.teamId}/agent/${threadId}` },
  }
}

export async function createAgentThread(actor: ThreadActor, prompt: string, title: string) {
  const source = await authorizeThreadActor(actor)
  const threadId = randomUUID()
  const messageId = randomUUID()

  await upsertConversationShell({
    sessionId: threadId,
    userId: actor.userId,
    teamId: actor.teamId,
    title,
    firstMessage: prompt,
    locale: actor.locale,
    source: 'agent.thread',
    credentialAccess: source.credentialAccess,
    agentRuntime: source.agentRuntime,
    runtimeId: source.runtimeId,
    runtimeLabel: source.runtimeLabel,
    parentSessionId: actor.sessionId,
  })
  // A thread runs in its parent's permission mode, as a chat opened by hand
  // starts in the mode the user picked.
  await initializeSessionBypass(
    threadId,
    actor.userId,
    await getSessionBypass(actor.sessionId, actor.userId),
  )
  const { status } = await startThreadTurn({
    ...actor,
    targetSessionId: threadId,
    messageId,
    prompt,
  })

  return { ...receipt(actor, threadId, messageId, status), sourceThreadId: actor.sessionId }
}

export async function sendAgentThreadMessage(actor: ThreadActor, threadId: string, prompt: string) {
  const data = { ...actor, targetSessionId: threadId, messageId: randomUUID(), prompt }

  return receipt(actor, threadId, data.messageId, (await startThreadTurn(data)).status)
}

/** The agents the owner can run a thread on, each with its readiness and usage. */
export async function listThreadRuntimes(actor: ThreadActor) {
  const source = await authorizeThreadActor(actor)
  const { listRuntimeInstances, listRuntimeQuotas, withRuntimeReadiness } =
    await import('@/lib/claude-code-preview/runtime-catalog')
  // The team's agents only. A local agent runs on the owner's own computer, which
  // only the owner can choose, with the consent the Desktop asks for.
  const instances = await withRuntimeReadiness(
    actor.teamId,
    await listRuntimeInstances(actor.teamId),
  )
  const quotas = await listRuntimeQuotas(actor.teamId, instances)

  return {
    runtimes: instances.map((instance, i) => ({
      runtimeId: instance.id,
      label: instance.label,
      provider: instance.provider,
      kind: instance.kind,
      status: instance.status,
      ready: !instance.notReady,
      current: instance.id === source.runtimeId,
      quota: quotas[i],
    })),
  }
}

/**
 * The parent's own controls for a thread it created: its permission mode, never
 * more access than the parent has, and the agent it runs on.
 */
export async function updateThread(
  actor: ThreadActor,
  threadId: string,
  change: { fullAccess?: boolean; runtimeId?: string },
) {
  const { target } = await authorizeThreadDelivery({ ...actor, targetSessionId: threadId })

  // Who opened it, not who it is nested under now: adopting a conversation must
  // not hand over control of it.
  if (target.createdBySessionId !== actor.sessionId) {
    throw new Error('Only a thread this conversation created can be changed.')
  }
  if (change.fullAccess && !(await getSessionBypass(actor.sessionId, actor.userId))) {
    throw new Error('Only a conversation in Full Access can give a thread Full Access.')
  }
  if (change.runtimeId) {
    const { listRuntimeInstances } = await import('@/lib/claude-code-preview/runtime-catalog')

    if (!(await listRuntimeInstances(actor.teamId)).some(({ id }) => id === change.runtimeId))
      throw new Error("A thread can only move to one of the team's agents, not to a computer.")
  }
  const { moveConversationRuntime } =
    await import('@/lib/claude-code-preview/conversation-runtime-move')
  const runtime = change.runtimeId
    ? await moveConversationRuntime(target, change.runtimeId, 'history', actor.userId)
    : undefined

  if (change.fullAccess !== undefined) {
    await setSessionBypass(threadId, actor.userId, change.fullAccess)
    recordAgentEvent({
      conversationId: threadId,
      userId: actor.userId,
      event: change.fullAccess ? 'auth.bypass_enabled' : 'auth.bypass_disabled',
      data: { sourceSessionId: actor.sessionId },
    })
  }

  return {
    threadId,
    ...(change.fullAccess === undefined
      ? {}
      : { mode: change.fullAccess ? 'full_access' : 'auto' }),
    ...(runtime ? { runtime } : {}),
  }
}

// Same path as a message typed into a chat: an idle target starts its turn in this
// process, a busy one takes the message into its active turn. Returns which
// happened; `run` settles with the turn, whose failure is logged here.
export async function startThreadTurn(data: ThreadTurn) {
  const { source, target } = await authorizeThreadDelivery(data)
  // Lazy so importing the tools does not pull in the route graph.
  const { startConversationTurn } = await import('./conversation-turn')
  const { status, run } = await startConversationTurn(data, target, data.prompt, 'agent.thread', {
    version: 1,
    sender: {
      type: 'agent',
      id: data.sessionId,
      displayName: source.title || 'Nuphos agent',
      ...(source.agentRuntime ? { agentRuntime: source.agentRuntime } : {}),
    },
    source: 'agent.thread',
    sourceSessionId: data.sessionId,
    sentAt: new Date().toISOString(),
  })

  run
    .then((finish) => (finish === 'connection-lost' ? reportLostThreadTurn(data) : undefined))
    .catch((error: unknown) => {
      logError('agent.thread.turn_failed', error, {
        session_id: data.targetSessionId,
        source_session_id: data.sessionId,
        message_id: data.messageId,
      })
    })

  return { status, run }
}

export const LOST_THREAD_TURN_NOTICE =
  '[Nuphos notice, not written by the agent] This thread lost its connection to the runtime during its last turn and came back with no agent process, for example because the runtime restarted. That turn may have stopped partway or may have finished just before; its result and any report may never arrive. Check this thread before repeating anything, since work may be partly done. If the restart came from heavy work such as builds or tests, avoid re-running several such tasks at once.'

/**
 * A turn whose runtime connection dropped is left to the runtime, which keeps
 * running it through a network blip and reports back as usual. When the runtime
 * itself restarted (an OOMKill), the session reattaches with no agent process
 * (`dormant`) and the turn is gone; nothing would ever tell the sender. A live
 * runtime that finished the turn while disconnected stays `idle` and says nothing.
 */
async function reportLostThreadTurn(data: ThreadTurn): Promise<void> {
  // A lost notice is not reported back, so two threads on a crash-looping runtime cannot ping-pong.
  if (data.prompt === LOST_THREAD_TURN_NOTICE) return
  const session = sessionsByConversation.get(`${data.teamId}:${data.targetSessionId}`)

  // False also means superseded or shutting down; only a session back on the air says anything.
  if (!session?.reattached || !(await session.reattached)) return
  const { state } = await session.client.getSessionExecutionState(session.openabSessionId)

  if (state !== 'dormant') return
  logEvent('info', 'agent.thread.lost_turn_reported', {
    session_id: data.targetSessionId,
    source_session_id: data.sessionId,
  })
  await sendAgentThreadMessage(
    { ...data, sessionId: data.targetSessionId },
    data.sessionId,
    LOST_THREAD_TURN_NOTICE,
  )
}

export async function setAgentThreadParent(
  actor: ThreadActor,
  threadId: string,
  parentThreadId: string | null,
) {
  await authorizeThreadActor(actor)
  const result = await setConversationParent(threadId, actor.userId, actor.teamId, parentThreadId)

  if (result === 'not_found') throw new Error('Thread must be a conversation you own in this team.')
  if (result === 'invalid_parent') {
    throw new Error(
      'Parent must be another conversation you own in this team, and not one nested below the thread.',
    )
  }

  return { threadId, parentThreadId }
}

/** Archive or restore an owned conversation in the actor's team, including this one. */
export async function setAgentThreadArchived(
  actor: ThreadActor,
  threadId: string,
  archived: boolean,
) {
  await authorizeThreadActor(actor)
  const target = await getConversationBySessionId(threadId)

  if (!target || target.userId !== actor.userId || target.teamId !== actor.teamId) {
    throw new Error('Target must be a conversation you own in this team.')
  }
  await setConversationArchived(threadId, archived)

  return { threadId, archived, _links: { web: `/teams/${actor.teamId}/agent/${threadId}` } }
}
