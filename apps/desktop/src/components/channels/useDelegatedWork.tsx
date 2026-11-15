import { useAgentSessions } from '../sidebar/agentSessions'

import { postedAt, senderOf } from './channelPosts'
import { delegatedRounds } from './delegatedWork'
import { DelegatedWorkCard } from './DelegatedWorkCard'

import type { TimelineRow } from './ChannelMessages'
import type { AgentPersistedMessage } from '../../api'

/**
 * The Tasks a Bot started, as cards in its chat: one for each turn that started
 * any, read from the listed chats as the Bot's working line reads them.
 */
export function useDelegatedWork(
  teamId: string,
  botId: string | undefined,
  messages: AgentPersistedMessage[],
  onOpenTask: (sessionId: string) => void,
  /** The viewer may open the Bot's own Task, the full record. */
  canOpenRecord: boolean,
): TimelineRow[] {
  const sessions = useAgentSessions(teamId).data

  if (!botId) return []

  return delegatedRounds(
    (sessions ?? []).filter((row) => row.parentSessionId === botId),
    // A turn starts at a post from anyone but the Bot.
    messages.filter((message) => senderOf(message) !== botId).map(postedAt),
  ).map(({ key, at, tasks }) => ({
    key,
    at,
    node: (
      <DelegatedWorkCard
        tasks={tasks}
        onOpenTask={onOpenTask}
        onOpenRecord={canOpenRecord ? () => onOpenTask(botId) : undefined}
      />
    ),
  }))
}
