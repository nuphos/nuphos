import { randomUUID } from 'node:crypto'

import { getSessionBypass, initializeSessionBypass } from '@/lib/agent/auto-mode/store'
import { getTeamMembership } from '@/lib/identity'
import { logError } from '@/lib/observability'

import { getConversationBySessionId, upsertConversationShell } from './db'

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

export async function authorizeThreadDelivery(data: ThreadTurn): Promise<AgentConversation> {
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
