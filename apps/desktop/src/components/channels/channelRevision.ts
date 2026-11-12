import type { AgentConversation, AgentConversationDetail } from '../../api'

/**
 * What an open channel shows, as a probe reports it: a change refetches it.
 * Its name and faces belong here too: an untitled Bot chat is named after the
 * Bot, so renaming the Bot changes them without a new post.
 */
export function channelRevision(
  probe: Pick<
    AgentConversation,
    'transcriptUpdatedAt' | 'messageCount' | 'agentSessionIds' | 'title' | 'faces'
  > &
    Pick<AgentConversationDetail, 'timelineEvents'>,
): string {
  return JSON.stringify([
    probe.transcriptUpdatedAt ?? '',
    probe.messageCount,
    probe.agentSessionIds ?? [],
    probe.title,
    probe.faces ?? [],
    probe.timelineEvents ?? [],
  ])
}
