import { agentConversations, agentMessages } from '@/lib/agent/db/shared'

import { recordSentence, settingsTimelineLines, withProviders } from './settings-lines'

import type { ConversationOwner } from './conversation-view'
import type { SettingsLookup as Lookup } from './settings-lines'
import type { SettingsChange } from '@/lib/agent/db/settings-history'
import type { AgentConversation } from '@/lib/agent/db/shared'

/**
 * When each message stored after the first settings change was, so lines know
 * which changes came between which messages, whatever page of them a client loaded.
 */
export async function settingsMessageTimes(
  conversation: Pick<AgentConversation, 'sessionId' | 'userId' | 'settingsHistory'>,
) {
  const first = conversation.settingsHistory?.find((change) => change.via !== 'placement')

  if (!first) return []
  const docs = await agentMessages()
    .find(
      {
        sessionId: conversation.sessionId,
        userId: conversation.userId,
        createdAt: { $gt: first.at },
      },
      { projection: { createdAt: 1 } },
    )
    .toArray()

  return docs.map((doc) => doc.createdAt)
}

/** The agents that made changes, by session id, with their current names and runtimes. */
export async function settingsAgents(changes: readonly SettingsChange[] = []) {
  const ids = [...new Set(changes.flatMap((change) => change.agentSessionId ?? []))]
  const docs = ids.length
    ? await agentConversations()
        .find(
          { sessionId: { $in: ids } },
          { projection: { sessionId: 1, title: 1, agentRuntime: 1 } },
        )
        .toArray()
    : []

  return new Map(
    docs.map((doc) => [
      doc.sessionId,
      {
        sessionId: doc.sessionId,
        title: doc.title,
        ...(doc.agentRuntime ? { provider: doc.agentRuntime } : {}),
      },
    ]),
  )
}

export const settingsUserIds = (changes: readonly SettingsChange[] = []) =>
  changes.flatMap((change) => (change.actorId === 'system' ? [] : [change.actorId]))

function actorOf(change: SettingsChange, { owners, agents }: Lookup) {
  if (change.actorId === 'system') return { type: 'system' as const }
  const owner = owners.get(change.actorId)
  const agent = change.agentSessionId ? agents.get(change.agentSessionId) : undefined

  return {
    type: change.agentSessionId ? ('agent' as const) : ('user' as const),
    userId: change.actorId,
    name: owner?.name ?? 'Someone',
    ...(change.agentSessionId
      ? { agentSessionId: change.agentSessionId, ...(agent ? { agentTitle: agent.title } : {}) }
      : {}),
  }
}

/** The API's records, oldest first: every settings change, and moves recorded before them. */
export function serializeSettingsHistory(
  conversation: Pick<AgentConversation, 'settingsHistory' | 'timelineEvents'>,
  lookup: Lookup,
) {
  const legacy = (conversation.timelineEvents ?? []).flatMap((event) =>
    event.kind === 'runtime_moved'
      ? [
          {
            at: event.at.toISOString(),
            actor: event.reason
              ? { type: 'system' as const }
              : {
                  type: 'user' as const,
                  userId: event.actorId,
                  name: lookup.owners.get(event.actorId)?.name ?? 'Someone',
                },
            via: event.reason ? ('runtime_fallback' as const) : ('runtime_move' as const),
            ...(event.reason ? { reason: event.reason } : {}),
            runtime: {
              ...(event.fromLabel
                ? { from: { label: event.fromLabel, provider: event.fromProvider } }
                : {}),
              to: { label: event.toLabel, provider: event.toProvider },
            },
          },
        ]
      : [],
  )
  const recorded = withProviders(conversation.settingsHistory ?? []).map(({ change, provider }) => {
    const { at, actorId: _actorId, agentSessionId: _agent, ...rest } = change
    const text = recordSentence(change, provider, lookup)

    return {
      ...rest,
      at: at.toISOString(),
      actor: actorOf(change, lookup),
      ...(text ? { text } : {}),
    }
  })

  return [...legacy, ...recorded].sort((a, b) => a.at.localeCompare(b.at))
}

/** A conversation's settings lines, placed among its messages. */
export async function conversationSettingsLines(
  conversation: Pick<AgentConversation, 'sessionId' | 'userId' | 'settingsHistory'>,
  owners: Map<string, ConversationOwner>,
) {
  return settingsTimelineLines(
    conversation.settingsHistory,
    { owners, agents: await settingsAgents(conversation.settingsHistory) },
    await settingsMessageTimes(conversation),
  )
}
