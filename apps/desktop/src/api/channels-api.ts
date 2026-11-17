import { receiveAgentAvatars } from '../lib/agentAvatarChoices.ts'

export const channelsApi = {
  agentGetBotImportStatus: (...args: Parameters<typeof window.api.agentGetBotImportStatus>) =>
    window.api.agentGetBotImportStatus(...args),
  agentChooseBotImport: (...args: Parameters<typeof window.api.agentChooseBotImport>) =>
    window.api.agentChooseBotImport(...args),
  agentApplyBotImport: (...args: Parameters<typeof window.api.agentApplyBotImport>) =>
    window.api.agentApplyBotImport(...args),
  agentSaveGrokExportSkill: () => window.api.agentSaveGrokExportSkill(),
  agentCreateChannel: (teamId: string, group?: boolean) =>
    window.api.agentCreateChannel(teamId, group),
  agentCreateBot: (teamId: string, bot?: Parameters<typeof window.api.agentCreateBot>[1]) =>
    window.api.agentCreateBot(teamId, bot),
  agentStartBotOnboarding: (sessionId: string, teamId: string, channelId: string) =>
    window.api.agentStartBotOnboarding(sessionId, teamId, channelId),
  agentMakeBot: (sessionId: string, teamId: string) => window.api.agentMakeBot(sessionId, teamId),
  agentListChannelMentions: (teamId: string) => window.api.agentListChannelMentions(teamId),
  agentNotifyMention: (args: Parameters<typeof window.api.agentNotifyMention>[0]) =>
    window.api.agentNotifyMention(args),
  // A chat's agents carry their faces for every member, so a teammate's Bot posts with its own.
  agentListChannelAgents: async (channelId: string, teamId: string) => {
    const requestedAt = Date.now()
    const listed = await window.api.agentListChannelAgents(channelId, teamId)

    receiveAgentAvatars(listed.agents, requestedAt)

    return listed
  },
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
