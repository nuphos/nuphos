import { ipcRenderer } from 'electron'

import type { BotImportSelection, BotImportTarget } from '../../src/api/bot-import-types'

export const channelsApi = {
  agentGetBotImportStatus: (target: BotImportTarget, id: string) =>
    ipcRenderer.invoke('agent:getBotImportStatus', target, id),
  agentChooseBotImport: (target: BotImportTarget, newCopy?: boolean) =>
    ipcRenderer.invoke('agent:chooseBotImport', target, newCopy),
  agentApplyBotImport: (target: BotImportTarget, id: string, selection: BotImportSelection) =>
    ipcRenderer.invoke('agent:applyBotImport', target, id, selection),
  agentSaveGrokExportSkill: () => ipcRenderer.invoke('agent:saveGrokExportSkill'),
  agentCreateChannel: (teamId: string, group?: boolean) =>
    ipcRenderer.invoke('agent:createChannel', teamId, group),
  agentCreateBot: (
    teamId: string,
    bot?: {
      title?: string
      avatar?: string
      runtimeId?: string
      agentRuntime?: string
      runtimeLabel?: string
    },
  ) => ipcRenderer.invoke('agent:createBot', teamId, bot),
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
  agentWakeChannelAgent: (channelId: string, teamId: string, agentSessionId: string) =>
    ipcRenderer.invoke('agent:wakeChannelAgent', channelId, teamId, agentSessionId),
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
    replyTo?: string,
    decisionReplyTo?: string,
  ) =>
    ipcRenderer.invoke(
      'agent:postChannelMessage',
      channelId,
      teamId,
      text,
      id,
      upload,
      mentions,
      replyTo,
      decisionReplyTo,
    ),
}
