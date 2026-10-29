import { randomUUID } from 'node:crypto'

import {
  getSessionBypass,
  initializeSessionBypass,
  setSessionBypass,
} from '@/lib/agent/auto-mode/store'
import { wakeOfflineBox } from '@/lib/agent/devices/box-wake'
import { resolveConversationChatRuntime } from '@/lib/claude-code-preview/conversation-chat-route'
import { fallBackBeforeTurn } from '@/lib/claude-code-preview/runtime-fallback'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { logError } from '@/lib/observability'

import {
  getConversationBySessionId,
  recordAgentEvent,
  setConversationArchived,
  setConversationParent,
  upsertConversationShell,
} from './db'

import type { CredentialRef } from './thread-credentials'
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
    target.teamId !== data.teamId
  ) {
    throw new Error('Target must be another conversation you own in this team.')
  }

  return { source, target }
}

function receipt(
  actor: ThreadActor,
  threadId: string,
  messageId: string,
  status: 'started' | 'queued',
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
 * The parent's own controls for a thread nested under it: its permission mode and
 * credentials, never more access than the parent has, and the agent it runs on.
 */
export async function updateThread(
  actor: ThreadActor,
  threadId: string,
  change: { fullAccess?: boolean; runtimeId?: string; grant?: CredentialRef[] },
) {
  const { target } = await authorizeThreadDelivery({ ...actor, targetSessionId: threadId })

  // A thread is this conversation's to manage while nested under it, whether
  // create_thread opened it or set_thread_parent adopted one of the owner's own.
  if (target.parentSessionId !== actor.sessionId) {
    throw new Error('Only a thread nested under this conversation can be changed.')
  }
  if (change.fullAccess && !(await getSessionBypass(actor.sessionId, actor.userId))) {
    throw new Error('Only a conversation in Full Access can give a thread Full Access.')
  }
  if (change.runtimeId) {
    const { listRuntimeInstances } = await import('@/lib/claude-code-preview/runtime-catalog')

    if (!(await listRuntimeInstances(actor.teamId)).some(({ id }) => id === change.runtimeId))
      throw new Error("A thread can only move to one of the team's agents, not to a computer.")
  }
  const { grantThreadCredentials } = await import('./thread-credentials')
  const granted = await grantThreadCredentials(actor, threadId, change.grant)
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
    ...(granted ? { granted } : {}),
    ...(change.fullAccess === undefined
      ? {}
      : { mode: change.fullAccess ? 'full_access' : 'auto' }),
    ...(runtime ? { runtime } : {}),
  }
}

/**
 * Answered before any receipt: a target whose agent cannot run, removed, signed
 * out or offline, is the sender's error now rather than a "started" that never runs.
 */
async function assertTargetCanRun(target: AgentConversation): Promise<void> {
  try {
    await resolveConversationChatRuntime(target.teamId, target, { userId: target.userId })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const box =
      error instanceof AppError &&
      error.code === 'runtime_offline' &&
      (await wakeOfflineBox(target.runtimeId))

    throw new Error(
      box
        ? 'The target thread runs on a Box that is resuming now. Resend in about a minute.'
        : `The target thread cannot run: ${reason} Move it to a running agent with update_thread runtimeId, then resend.`,
      { cause: error },
    )
  }
}

// An idle target starts its turn in this process. A busy one queues the message,
// which runs once that turn releases the session. Returns which happened; a
// message that then does not run is reported to its sender by runTurn.
export async function startThreadTurn(data: ThreadTurn) {
  const { source, target: delivered } = await authorizeThreadDelivery(data)
  const target = await fallBackBeforeTurn(delivered)

  await assertTargetCanRun(target)
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

  run.catch((error: unknown) => {
    logError('agent.thread.turn_failed', error, {
      session_id: data.targetSessionId,
      source_session_id: data.sessionId,
      message_id: data.messageId,
    })
  })

  return { status, run }
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
