import { createHash, randomUUID } from 'node:crypto'

import { getSessionBypass, initializeSessionBypass } from './auto-mode/store'
import {
  agentConversations,
  getConversationBySessionId,
  setConversationArchived,
  upsertConversationShell,
} from './db'

import type { AgentConversation } from './db'
import type { ThreadActor } from './thread-bridge'
import type { ThreadModelPick } from './thread-runtime'

/** A request key identifies one delegation, never the next unrelated task. */
export function delegationThreadId(actor: ThreadActor, requestId: string): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([actor.userId, actor.teamId, actor.sessionId, requestId]))
    .digest('hex')

  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`
}

export async function prepareThread(
  actor: ThreadActor,
  source: AgentConversation,
  prompt: string,
  title: string,
  pick: ThreadModelPick & { runtimeId?: string; requestId?: string },
) {
  const { assertThreadRuntime } = await import('./thread-runtime')
  const runtime = await assertThreadRuntime(actor, pick.runtimeId)
  const threadId = pick.requestId ? delegationThreadId(actor, pick.requestId) : randomUUID()
  const messageId = pick.requestId ? `delegation-${threadId}` : randomUUID()
  const delegation = pick.requestId
    ? {
        requestId: pick.requestId,
        promptHash: createHash('sha256').update(prompt).digest('hex'),
      }
    : undefined
  const { getActiveAgentRunForSession, readRunChannels } = await import('./run-store')
  const active = await getActiveAgentRunForSession(actor.userId, actor.sessionId)
  const originChannelIds = active ? await readRunChannels(actor.userId, active.streamId) : []

  const { isNew } = await upsertConversationShell({
    sessionId: threadId,
    userId: actor.userId,
    teamId: actor.teamId,
    title,
    firstMessage: prompt,
    locale: actor.locale,
    source: 'agent.thread',
    agentRuntime: runtime?.provider ?? source.agentRuntime,
    runtimeId: runtime?.id ?? source.runtimeId,
    runtimeLabel: runtime?.label ?? source.runtimeLabel,
    parentSessionId: actor.sessionId,
    delegation,
    originChannelIds,
    parentGrants: source,
    workspace: source.workspace,
  })

  if (delegation && !isNew) {
    const existing = await getConversationBySessionId(threadId)

    if (
      !existing ||
      existing.userId !== actor.userId ||
      existing.teamId !== actor.teamId ||
      existing.parentSessionId !== actor.sessionId ||
      existing.archivedAt ||
      existing.delegation?.requestId !== delegation.requestId ||
      existing.delegation.promptHash !== delegation.promptHash
    )
      throw new Error(
        'This requestId already identifies different or archived work. Read the existing Task before delegating again.',
      )
    if (!existing.delegation.ready)
      throw new Error(
        'This Task is still preparing or its preparation was interrupted. Inspect the existing Task before retrying; do not create duplicate work.',
      )

    return { threadId, messageId }
  }
  // A thread runs in its parent's permission mode, as a hand-opened chat in the user's pick.
  await initializeSessionBypass(
    threadId,
    actor.userId,
    await getSessionBypass(actor.sessionId, actor.userId),
  )
  const { currentPick, setThreadModel } = await import('./thread-runtime')
  // With nothing picked, a thread on its parent's agent starts on the parent's model.
  const inherits =
    !pick.model && !pick.effort && !pick.fast && (!runtime || runtime.id === source.runtimeId)

  const by = {
    actorId: actor.userId,
    agentSessionId: actor.sessionId,
    via: 'create_thread' as const,
  }

  if (inherits) {
    // Each of the parent's settings carries over, the model first; one the thread's agent
    // does not offer (an effort its model has no levels for) is left to the agent's default.
    const parent = currentPick(source)

    for (const configId of ['model', 'effort', 'fast'] as const)
      await setThreadModel(threadId, actor.userId, { [configId]: parent[configId] }, by).catch(
        () => {},
      )
  } else {
    try {
      await setThreadModel(threadId, actor.userId, pick, by)
    } catch (error) {
      // Nothing ran yet; a refused pick hides the unused conversation.
      await setConversationArchived(threadId, true, {
        source: 'create_thread',
        userId: actor.userId,
        agentSessionId: actor.sessionId,
      })
      throw error
    }
  }
  if (delegation)
    await agentConversations().updateOne(
      { sessionId: threadId, userId: actor.userId, teamId: actor.teamId },
      { $set: { 'delegation.ready': true } },
    )

  return { threadId, messageId }
}
