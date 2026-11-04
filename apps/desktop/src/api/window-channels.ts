import type { ChannelAgent, ChannelMention } from './agent-types.ts'

/** Channels: places where people and agents talk. */
export type WindowChannelsApi = {
  agentCreateChannel(teamId: string, title: string): Promise<{ sessionId: string }>
  agentListChannelMentions(teamId: string): Promise<{ mentions: ChannelMention[] }>
  agentListChannelAgents(channelId: string, teamId: string): Promise<{ agents: ChannelAgent[] }>
  agentAddChannelAgent(
    channelId: string,
    teamId: string,
    agentSessionId: string,
  ): Promise<{ agents: ChannelAgent[] }>
  agentRemoveChannelAgent(channelId: string, teamId: string, agentSessionId: string): Promise<void>
  agentNotifyMention(args: {
    messageId: string
    title: string
    body: string
    sessionId: string
    teamId?: string
  }): Promise<void>
  agentPostChannelMessage(
    channelId: string,
    teamId: string,
    text: string,
    id: string,
    upload?: string,
    mentions?: string[],
  ): Promise<{ id: string }>
}
