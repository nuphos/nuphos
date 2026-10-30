import * as agent from '../agent'

// Channels: places where people and agents talk.
export const agentChannelChannels = {
  'agent:createChannel': (_e: unknown, teamId: string, title: string) =>
    agent.createChannel(teamId, title),
  'agent:listChannelAgents': (_e: unknown, channelId: string, teamId: string) =>
    agent.listChannelAgents(channelId, teamId),
  'agent:addChannelAgent': (_e: unknown, channelId: string, teamId: string, agentId: string) =>
    agent.addChannelAgent(channelId, teamId, agentId),
  'agent:removeChannelAgent': (_e: unknown, channelId: string, teamId: string, agentId: string) =>
    agent.removeChannelAgent(channelId, teamId, agentId),
  'agent:postChannelMessage': (
    _e: unknown,
    channelId: string,
    teamId: string,
    text: string,
    id: string,
  ) => agent.postChannelMessage(channelId, teamId, text, id),
}
