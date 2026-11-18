import type { ChannelAgent } from '../../api/agent-types'

/** A group chat's first member Bot whose computer is offline, by name (#3308). */
export function offlineMember(agents: ChannelAgent[]): string | undefined {
  return agents.find(
    ({ presence }) => presence?.state === 'offline' && presence.reason === 'computer_offline',
  )?.title
}
