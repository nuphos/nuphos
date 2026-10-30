import { ipcRenderer } from 'electron'

export const channelsApi = {
  agentCreateChannel: (teamId: string, title: string) =>
    ipcRenderer.invoke('agent:createChannel', teamId, title),
  agentListChannelAgents: (channelId: string, teamId: string) =>
    ipcRenderer.invoke('agent:listChannelAgents', channelId, teamId),
  agentAddChannelAgent: (channelId: string, teamId: string, agentSessionId: string) =>
    ipcRenderer.invoke('agent:addChannelAgent', channelId, teamId, agentSessionId),
  agentRemoveChannelAgent: (channelId: string, teamId: string, agentSessionId: string) =>
    ipcRenderer.invoke('agent:removeChannelAgent', channelId, teamId, agentSessionId),
  agentPostChannelMessage: (channelId: string, teamId: string, text: string, id: string) =>
    ipcRenderer.invoke('agent:postChannelMessage', channelId, teamId, text, id),
}
