import {
  runtimeBackgroundRunning,
  runtimeSnapshotFresh,
  runtimeTurnActive,
} from '../../../lib/runtimeExecution.ts'

import type { AgentConversation, AgentConversationPerson } from '../../../api'

/** Most urgent first: an agent waiting on its person outranks one that is busy. */
export type ActivityStatus = 'waiting' | 'running' | 'background' | 'idle'

const RANK: Record<ActivityStatus, number> = { waiting: 0, running: 1, background: 2, idle: 3 }

export type MemberActivity = {
  owner: AgentConversationPerson
  status: ActivityStatus
  /** The conversation that explains the status: the most urgent, then the most recent. */
  conversation: AgentConversation
  /** Conversations of this person that are not idle. */
  busy: number
}

export function conversationStatus(c: AgentConversation): ActivityStatus {
  const s = c.runtimeState

  if (runtimeSnapshotFresh(s) && (s?.requestPending || (s?.requests?.length ?? 0) > 0))
    return 'waiting'
  if (runtimeTurnActive(s)) return 'running'
  if (runtimeBackgroundRunning(s)) return 'background'

  return 'idle'
}

/** One row per person, most urgent first, then most recently active. */
export function summarizeTeamActivity(conversations: AgentConversation[]): MemberActivity[] {
  const byOwner = new Map<string, MemberActivity>()

  for (const conversation of conversations) {
    if (!conversation.owner) continue
    const status = conversationStatus(conversation)
    const seen = byOwner.get(conversation.owner.id)
    const busy = (seen?.busy ?? 0) + (status === 'idle' ? 0 : 1)
    const better =
      !seen ||
      RANK[status] < RANK[seen.status] ||
      (status === seen.status && conversation.lastActiveAt > seen.conversation.lastActiveAt)

    byOwner.set(
      conversation.owner.id,
      better ? { owner: conversation.owner, status, conversation, busy } : { ...seen, busy },
    )
  }

  return [...byOwner.values()].sort(
    (a, b) =>
      RANK[a.status] - RANK[b.status] ||
      b.conversation.lastActiveAt.localeCompare(a.conversation.lastActiveAt),
  )
}
