import { createMessageMetadata } from '@/lib/agent/message-attribution'
import { judgeThreadAddressing } from '@/lib/agent/thread-addressing'
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
  discordDecisions,
} from '@/lib/discord/store'
import { getTeamMembership, signNuphosToken } from '@/lib/identity'

import { recordDiscordSessionMessage } from './session-context'
import { getDiscordThreadHistory, recordDiscordThreadMessage } from './thread-history'
import { buildMessagesForDiscordTurn } from './transcript'
import { executeDiscordTurn } from './turn'

export const defaultDependencies = {
  recordDiscordSessionMessage,
  discordDecisions,
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
  getDiscordThreadHistory,
  recordDiscordThreadMessage,
  judgeThreadAddressing,
  buildMessagesForDiscordTurn,
  createMessageMetadata,
  executeDiscordTurn,
  turnRunner,
}

export type DiscordMessageDependencies = typeof defaultDependencies
