export const channelsApi = {
  agentCreateChannel: (teamId: string) => window.api.agentCreateChannel(teamId),
  agentCreateBot: (teamId: string, bot?: Parameters<typeof window.api.agentCreateBot>[1]) =>
    window.api.agentCreateBot(teamId, bot),
  agentMakeBot: (sessionId: string, teamId: string) => window.api.agentMakeBot(sessionId, teamId),
  agentListChannelMentions: (teamId: string) => window.api.agentListChannelMentions(teamId),
  agentNotifyMention: (args: Parameters<typeof window.api.agentNotifyMention>[0]) =>
    window.api.agentNotifyMention(args),
  agentListChannelAgents: (channelId: string, teamId: string) =>
    window.api.agentListChannelAgents(channelId, teamId),
  agentAddChannelAgent: (channelId: string, teamId: string, agentSessionId: string) =>
    window.api.agentAddChannelAgent(channelId, teamId, agentSessionId),
  agentRemoveChannelAgent: (channelId: string, teamId: string, agentSessionId: string) =>
    window.api.agentRemoveChannelAgent(channelId, teamId, agentSessionId),
  agentWakeChannelAgent: (channelId: string, teamId: string, agentSessionId: string) =>
    window.api.agentWakeChannelAgent(channelId, teamId, agentSessionId),
  agentPostChannelMessage: (
    channelId: string,
    teamId: string,
    text: string,
    id: string,
    upload?: string,
    mentions?: string[],
    replyTo?: string,
  ) => window.api.agentPostChannelMessage(channelId, teamId, text, id, upload, mentions, replyTo),
}
