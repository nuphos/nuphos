import { createMessageMetadata } from '@/lib/agent/message-attribution'
import { turnRunner } from '@/lib/agent/turn-runner'
import { createDiscordThread, getDiscordChannel, sendDiscordMessage } from '@/lib/discord/api'
import {
  claimDiscordEvent,
  discordAgentThreads,
  discordChannelMappings,
  discordInstallations,
  discordUserMappings,
  getOrCreateDiscordThread,
  markDiscordEvent,
  refreshDiscordEventClaim,
} from '@/lib/discord/store'
import { getTeamMembership, signNuphosToken } from '@/lib/identity'

import { recordDiscordSessionMessage } from './session-context'
import { buildMessagesForDiscordTurn, syncDiscordThread } from './transcript'
import { executeDiscordTurn } from './turn'

export const defaultDependencies = {
  recordDiscordSessionMessage,
  claimDiscordEvent,
  discordAgentThreads,
  discordChannelMappings,
  discordInstallations,
  discordUserMappings,
  getOrCreateDiscordThread,
  markDiscordEvent,
  refreshDiscordEventClaim,
  getTeamMembership,
  signNuphosToken,
  createDiscordThread,
  getDiscordChannel,
  sendDiscordMessage,
  buildMessagesForDiscordTurn,
  syncDiscordThread,
  createMessageMetadata,
  executeDiscordTurn,
  turnRunner,
}

export type DiscordMessageDependencies = typeof defaultDependencies
