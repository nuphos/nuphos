import type { ChannelAgent, ChannelMention } from './agent-types.ts'
import type { BotImportPreview, BotImportSelection, BotImportTarget } from './bot-import-types'

/** Channels: places where people and agents talk. */
export type WindowChannelsApi = {
  agentGetBotImportStatus(target: BotImportTarget, id: string): Promise<BotImportPreview>
  agentChooseBotImport(target: BotImportTarget, newCopy?: boolean): Promise<BotImportPreview | null>
  agentApplyBotImport(
    target: BotImportTarget,
    id: string,
    selection: BotImportSelection,
  ): Promise<BotImportPreview>
  agentSaveGrokExportSkill(): Promise<void>
  agentCreateChannel(teamId: string): Promise<{ sessionId: string }>
  agentCreateBot(
    teamId: string,
    bot?: {
      title?: string
      avatar?: string
      runtimeId?: string
      agentRuntime?: string
      runtimeLabel?: string
    },
  ): Promise<{ sessionId: string; title: string; avatar: string }>
  agentMakeBot(sessionId: string, teamId: string): Promise<{ avatar: string }>
  agentListChannelMentions(teamId: string): Promise<{ mentions: ChannelMention[] }>
  agentListChannelAgents(channelId: string, teamId: string): Promise<{ agents: ChannelAgent[] }>
  agentAddChannelAgent(
    channelId: string,
    teamId: string,
    agentSessionId: string,
  ): Promise<{ agents: ChannelAgent[] }>
  agentRemoveChannelAgent(channelId: string, teamId: string, agentSessionId: string): Promise<void>
  agentWakeChannelAgent(channelId: string, teamId: string, agentSessionId: string): Promise<void>
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
    replyTo?: string,
    decisionReplyTo?: string,
  ): Promise<{ id: string }>
}
