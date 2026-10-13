import { randomUUID } from 'node:crypto'

import {
  getSessionBypass,
  initializeSessionBypass,
  setSessionBypass,
} from '@/lib/agent/auto-mode/store'
import { getTeamMembership } from '@/lib/identity'
import { logError } from '@/lib/observability'

import {
  getConversationBySessionId,
  recordAgentEvent,
  setConversationArchived,
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
): Promise<AgentConversation> {
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

  return target
}

function receipt(actor: ThreadActor, threadId: string, messageId: string) {
  return {
    status: 'queued',
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
  startThreadTurn({ ...actor, targetSessionId: threadId, messageId, prompt })

  return { ...receipt(actor, threadId, messageId), sourceThreadId: actor.sessionId }
}

export async function sendAgentThreadMessage(actor: ThreadActor, threadId: string, prompt: string) {
  const data = { ...actor, targetSessionId: threadId, messageId: randomUUID(), prompt }

  await authorizeThreadDelivery(data)
  startThreadTurn(data)

  return receipt(actor, threadId, data.messageId)
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
  const target = await authorizeThreadDelivery({ ...actor, targetSessionId: threadId })

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

export async function executeThreadTurn(data: ThreadTurn): Promise<void> {
  const target = await authorizeThreadDelivery(data)
  // Lazy so importing the tools does not pull in the route graph.
  const { executeConversationTurn } = await import('./conversation-turn')

  await executeConversationTurn(data, target, data.prompt, 'agent.thread', {
    version: 1,
    sender: { type: 'agent', id: data.sessionId, displayName: 'Nuphos agent' },
    source: 'agent.thread',
    sourceSessionId: data.sessionId,
    sentAt: new Date().toISOString(),
  })
}

// Same path as a message typed into a chat: the turn starts in this process and
// a busy target takes it through its pending-message queue.
function startThreadTurn(data: ThreadTurn): void {
  void executeThreadTurn(data).catch((error: unknown) => {
    logError('agent.thread.turn_failed', error, {
      session_id: data.targetSessionId,
      source_session_id: data.sessionId,
      message_id: data.messageId,
    })
  })
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
  if (!(await setConversationArchived(threadId, actor.userId, actor.teamId, archived))) {
    throw new Error('Target conversation was not found.')
  }

  return { threadId, archived, _links: { web: `/teams/${actor.teamId}/agent/${threadId}` } }
}
