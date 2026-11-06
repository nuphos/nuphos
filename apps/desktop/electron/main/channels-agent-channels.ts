import { BrowserWindow } from 'electron'

import * as agent from '../agent'

import type { IpcMainInvokeEvent } from 'electron'

// Channels: places where people and agents talk.
export const agentChannelChannels = {
  'agent:createChannel': (_e: unknown, teamId: string) => agent.createChannel(teamId),
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
  'agent:postChannelMessage': (
    _e: unknown,
    channelId: string,
    teamId: string,
    text: string,
    id: string,
    upload?: string,
    mentions?: string[],
  ) => agent.postChannelMessage(channelId, teamId, text, id, upload, mentions),
}
