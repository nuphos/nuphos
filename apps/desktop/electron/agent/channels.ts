import { callJsonForRenderer, teamQuery } from './http'

import type { ChannelAgent, ChannelMention } from '../../src/api/agent-types'
import type { FileTransferGroup } from '../../src/types'

const at = (sessionId: string) => `/agent/conversations/${encodeURIComponent(sessionId)}`

/**
 * A new channel, private until shared; its people and agents are added after.
 * It has no name: each member sees it called by the others in it.
 */
export async function createChannel(teamId: string): Promise<{ sessionId: string }> {
  return callJsonForRenderer('POST', `/agent/channels${teamQuery(teamId)}`, {})
}

/** Where a new Bot runs: the runtime a new chat would start on. */
export type NewBot = {
  title?: string
  avatar?: string
  runtimeId?: string
  agentRuntime?: string
  runtimeLabel?: string
}

/** "+" on Bots: a Bot with a name and a face, before anyone types. */
export async function createBot(
  teamId: string,
  bot: NewBot = {},
): Promise<{ sessionId: string; title: string; avatar: string }> {
  return callJsonForRenderer('POST', `/agent/bots${teamQuery(teamId)}`, bot)
}

/** "Make this a Bot": the Task gets its face and is asked to name itself. */
export async function makeBot(sessionId: string, teamId: string): Promise<{ avatar: string }> {
  return callJsonForRenderer('POST', `${at(sessionId)}/bot${teamQuery(teamId)}`, {})
}

export async function listChannelAgents(
  channelId: string,
  teamId: string,
): Promise<{ agents: ChannelAgent[] }> {
  return callJsonForRenderer('GET', `${at(channelId)}/agents${teamQuery(teamId)}`)
}

/** Only the agent's owner can add it: their word that the channel may talk to it. */
export async function addChannelAgent(
  channelId: string,
  teamId: string,
  agentSessionId: string,
): Promise<{ agents: ChannelAgent[] }> {
  return callJsonForRenderer('POST', `${at(channelId)}/agents${teamQuery(teamId)}`, {
    sessionId: agentSessionId,
  })
}

export async function removeChannelAgent(
  channelId: string,
  teamId: string,
  agentSessionId: string,
): Promise<void> {
  await callJsonForRenderer(
    'DELETE',
    `${at(channelId)}/agents/${encodeURIComponent(agentSessionId)}${teamQuery(teamId)}`,
  )
}

/**
 * `id` makes a resend the same message; `upload` is a finished upload's group;
 * `mentions` are the user ids of the composer's mention chips.
 */
export async function postChannelMessage(
  channelId: string,
  teamId: string,
  text: string,
  id: string,
  upload?: string,
  mentions?: string[],
): Promise<{ id: string }> {
  return callJsonForRenderer('POST', `${at(channelId)}/channel-messages${teamQuery(teamId)}`, {
    text,
    id,
    ...(upload ? { upload } : {}),
    ...(mentions?.length ? { mentions } : {}),
  })
}

/** A file posted in the channel, with fresh links, for anyone who can read it. */
export async function resolveChannelAttachment(
  channelId: string,
  teamId: string,
  groupId: string,
): Promise<FileTransferGroup> {
  return callJsonForRenderer(
    'GET',
    `${at(channelId)}/attachments/${encodeURIComponent(groupId)}${teamQuery(teamId)}`,
  )
}

/** The Inbox's channel entries: posts that @mention the viewer. */
export async function listChannelMentions(teamId: string): Promise<{ mentions: ChannelMention[] }> {
  return callJsonForRenderer('GET', `/agent/channels/mentions${teamQuery(teamId)}`)
}
