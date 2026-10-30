export const channelsApi = {
  agentCreateChannel: (teamId: string, title: string) =>
    window.api.agentCreateChannel(teamId, title),
  agentListChannelAgents: (channelId: string, teamId: string) =>
    window.api.agentListChannelAgents(channelId, teamId),
  agentAddChannelAgent: (channelId: string, teamId: string, agentSessionId: string) =>
    window.api.agentAddChannelAgent(channelId, teamId, agentSessionId),
  agentRemoveChannelAgent: (channelId: string, teamId: string, agentSessionId: string) =>
    window.api.agentRemoveChannelAgent(channelId, teamId, agentSessionId),
  agentPostChannelMessage: (channelId: string, teamId: string, text: string, id: string) =>
    window.api.agentPostChannelMessage(channelId, teamId, text, id),
}
