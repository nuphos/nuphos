import { randomUUID } from 'node:crypto'

import { getTeamMembership } from '@/lib/identity'

import { agentConversations, getConversationBySessionId, upsertConversationShell } from './db'
import { enqueueThreadTurn } from './thread-queue'

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
  })
  try {
    await enqueueThreadTurn({ ...actor, targetSessionId: threadId, messageId, prompt })
  } catch (error) {
    // This freshly minted shell never ran; do not leave a false queued task.
    await agentConversations().deleteOne({
      sessionId: threadId,
      userId: actor.userId,
      messageCount: 0,
    })
    throw error
  }

  return { ...receipt(actor, threadId, messageId), sourceThreadId: actor.sessionId }
}

export async function sendAgentThreadMessage(actor: ThreadActor, threadId: string, prompt: string) {
  const data = { ...actor, targetSessionId: threadId, messageId: randomUUID(), prompt }

  await authorizeThreadDelivery(data)
  await enqueueThreadTurn(data)

  return receipt(actor, threadId, data.messageId)
}
