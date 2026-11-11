import { BrowserWindow } from 'electron'

import * as agent from '../agent'

import type { BotImportSelection, BotImportTarget } from '../../src/api/bot-import-types'
import type { IpcMainInvokeEvent } from 'electron'

// Channels: places where people and agents talk.
export const agentChannelChannels = {
  'agent:getBotImportStatus': (_e: unknown, target: BotImportTarget, id: string) =>
    agent.getBotImportStatus(target, id),
  'agent:chooseBotImport': (_e: unknown, target: BotImportTarget, newCopy?: boolean) =>
    agent.chooseBotImport(target, newCopy),
  'agent:applyBotImport': (
    _e: unknown,
    target: BotImportTarget,
    id: string,
    selection: BotImportSelection,
  ) => agent.applyBotImport(target, id, selection),
  'agent:saveGrokExportSkill': () => agent.saveGrokExportSkill(),
  'agent:createChannel': (_e: unknown, teamId: string) => agent.createChannel(teamId),
  'agent:createBot': (_e: unknown, teamId: string, bot?: agent.NewBot) =>
    agent.createBot(teamId, bot),
  'agent:makeBot': (_e: unknown, sessionId: string, teamId: string) =>
    agent.makeBot(sessionId, teamId),
  'agent:listChannelMentions': (_e: unknown, teamId: string) => agent.listChannelMentions(teamId),
  'agent:notifyMention': (
    e: IpcMainInvokeEvent,
    args: { messageId: string; title: string; body: string; sessionId: string; teamId?: string },
  ) => agent.notifyMention({ ...args, parentWindow: BrowserWindow.fromWebContents(e.sender) }),
  'agent:listChannelAgents': (_e: unknown, channelId: string, teamId: string) =>
    agent.listChannelAgents(channelId, teamId),
  'agent:addChannelAgent': (_e: unknown, channelId: string, teamId: string, agentId: string) =>
    agent.addChannelAgent(channelId, teamId, agentId),
  'agent:removeChannelAgent': (_e: unknown, channelId: string, teamId: string, agentId: string) =>
    agent.removeChannelAgent(channelId, teamId, agentId),
  'agent:wakeChannelAgent': (_e: unknown, channelId: string, teamId: string, agentId: string) =>
    agent.wakeChannelAgent(channelId, teamId, agentId),
  'agent:postChannelMessage': (
    _e: unknown,
    channelId: string,
    teamId: string,
    text: string,
    id: string,
    upload?: string,
    mentions?: string[],
    replyTo?: string,
    decisionReplyTo?: string,
  ) =>
    agent.postChannelMessage(
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
