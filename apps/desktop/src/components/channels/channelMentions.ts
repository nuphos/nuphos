import type { AgentMessageMention, ChannelAgent } from '../../api'

/** Agent mentions name members of this channel, not arbitrary team sessions. */
export function channelMentions(people: AgentMessageMention[] | undefined, agents: ChannelAgent[]) {
  const names = new Set((people ?? []).map((person) => person.displayName))

  return [
    ...(people ?? []),
    ...agents
      .filter((agent) => agent.title && !names.has(agent.title))
      .map((agent) => ({
        id: `agent:${agent.sessionId}`,
        displayName: agent.title,
      })),
  ]
}
