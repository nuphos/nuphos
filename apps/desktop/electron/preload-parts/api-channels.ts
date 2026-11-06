import { ipcRenderer } from 'electron'

export const channelsApi = {
  agentCreateChannel: (teamId: string) => ipcRenderer.invoke('agent:createChannel', teamId),
  agentCreateBot: (teamId: string) => ipcRenderer.invoke('agent:createBot', teamId),
  agentMakeBot: (sessionId: string, teamId: string) =>
    ipcRenderer.invoke('agent:makeBot', sessionId, teamId),
  agentListChannelMentions: (teamId: string) =>
    ipcRenderer.invoke('agent:listChannelMentions', teamId),
  agentListChannelAgents: (channelId: string, teamId: string) =>
    ipcRenderer.invoke('agent:listChannelAgents', channelId, teamId),
  agentAddChannelAgent: (channelId: string, teamId: string, agentSessionId: string) =>
    ipcRenderer.invoke('agent:addChannelAgent', channelId, teamId, agentSessionId),
  agentRemoveChannelAgent: (channelId: string, teamId: string, agentSessionId: string) =>
    ipcRenderer.invoke('agent:removeChannelAgent', channelId, teamId, agentSessionId),
  agentNotifyMention: (args: {
    messageId: string
    title: string
    body: string
    sessionId: string
    teamId?: string
  }) => ipcRenderer.invoke('agent:notifyMention', args),
  agentPostChannelMessage: (
    channelId: string,
    teamId: string,
    text: string,
    id: string,
    upload?: string,
    mentions?: string[],
  ) =>
    ipcRenderer.invoke('agent:postChannelMessage', channelId, teamId, text, id, upload, mentions),
}
