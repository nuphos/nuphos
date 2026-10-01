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

import { recordDiscordSessionMessage, withDiscordSessionContext } from './session-context'
import { getDiscordThreadHistory, recordDiscordThreadMessage } from './thread-history'
import { buildMessagesForDiscordTurn } from './transcript'
import { executeDiscordTurn } from './turn'

export const defaultDependencies = {
  recordDiscordSessionMessage,
  withDiscordSessionContext,
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
  executeDiscordTurn,
  turnRunner,
}

export type DiscordMessageDependencies = typeof defaultDependencies
