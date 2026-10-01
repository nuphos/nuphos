import { config } from '@/config'
import {
  findPreviewWaitByRef,
  resolvePreviewDecision,
} from '@/lib/claude-code-preview/decision-waiter'
import {
  discordApi,
  acknowledgeDiscordInteraction,
  editDiscordInteractionResponse,
} from '@/lib/discord/api'
import { verifyDiscordSignature } from '@/lib/discord/signature'
import { discordDecisions, discordUserMappings } from '@/lib/discord/store'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { logError, logEvent } from '@/lib/observability'

import { claimDiscordApproval } from './approval-claim'
import { invalidateDiscordApprovals } from './approval'
import { handleDiscordChannelCommand } from './channel-command'
import { handleDiscordModeCommand } from './mode-command'

import type { Context } from 'hono'

export type DiscordInteraction = {
  id: string
  application_id: string
  token: string
  message?: { id: string }
  type: number
  guild_id?: string
  channel_id?: string
  user?: { id: string }
  member?: { permissions?: string; user?: { id: string } }
  data?: {
    custom_id?: string
    name?: string
    options?: { type?: number; name?: string }[]
  }
}

const ephemeral = (content: string) => ({
  type: 4,
  data: { content, flags: 64, allowed_mentions: { parse: [] as string[] } },
})

export async function handleDiscordInteraction(c: Context): Promise<Response> {
  const publicKey = config.discord.publicKey

  if (!publicKey)
    throw new AppError(503, 'discord_not_configured', 'Discord public key is not configured')
  const rawBody = await c.req.text()

  if (
    !verifyDiscordSignature({
      publicKey,
      signature: c.req.header('X-Signature-Ed25519'),
      timestamp: c.req.header('X-Signature-Timestamp'),
      rawBody,
    })
  ) {
    throw new AppError(401, 'invalid_signature', 'Invalid Discord signature')
  }
  const interaction = JSON.parse(rawBody) as DiscordInteraction

  if (interaction.type === 1) return c.json({ type: 1 })

  return c.json(await dispatchDiscordInteraction(interaction, 'http'))
}

const deliveryDependencies = {
  acknowledge: acknowledgeDiscordInteraction,
  process: processDiscordInteraction,
  editResponse: editDiscordInteractionResponse,
  editMessage: async (channelId: string, messageId: string, data: unknown) => {
    await discordApi(`/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },
}

export type DiscordDeliveryDependencies = typeof deliveryDependencies

/** Both delivery transports acknowledge before any database or agent work. */
export async function dispatchDiscordInteraction(
  interaction: DiscordInteraction,
  transport: 'http' | 'gateway',
  dependencies: DiscordDeliveryDependencies = deliveryDependencies,
) {
  const acknowledgement = { type: 5, data: { flags: 64 } }

  if (transport === 'gateway') {
    await dependencies.acknowledge(interaction.id, interaction.token)
    await completeDiscordInteraction(interaction, dependencies)
  } else {
    // Start after the HTTP handler has returned its acknowledgement.
    setTimeout(() => {
      void completeDiscordInteraction(interaction, dependencies).catch((err: unknown) => {
        logError('discord.interaction.delivery_error', err, { interaction_id: interaction.id })
      })
    }, 0)
  }

  return acknowledgement
}

/** Used when no HTTP Interactions Endpoint URL is configured in Discord. */
export async function handleDiscordGatewayInteraction(
  interaction: DiscordInteraction,
): Promise<void> {
  await dispatchDiscordInteraction(interaction, 'gateway')
}

async function completeDiscordInteraction(
  interaction: DiscordInteraction,
  dependencies: DiscordDeliveryDependencies,
): Promise<void> {
  try {
    const result = await dependencies.process(interaction)

    if (result.type === 7 && interaction.channel_id && interaction.message?.id) {
      await dependencies.editMessage(interaction.channel_id, interaction.message.id, result.data)
    }
    await dependencies.editResponse(interaction.application_id, interaction.token, result.data)
  } catch (err) {
    logError('discord.interaction.error', err, { interaction_id: interaction.id })
    await dependencies.editResponse(interaction.application_id, interaction.token, {
      content: 'Nuphos could not complete this interaction. Please try again.',
    })
  }
}

const processDependencies = {
  handleDiscordModeCommand,
  handleDiscordChannelCommand,
  discordDecisions,
  discordUserMappings,
  getTeamMembership,
  findPreviewWaitByRef,
  claimDiscordApproval,
  invalidateDiscordApprovals,
  resolvePreviewDecision,
}

export type DiscordInteractionDependencies = typeof processDependencies

export async function processDiscordInteraction(
  interaction: DiscordInteraction,
  dependencies: DiscordInteractionDependencies = processDependencies,
) {
  const {
    handleDiscordModeCommand,
    handleDiscordChannelCommand,
    discordDecisions,
    discordUserMappings,
    getTeamMembership,
    findPreviewWaitByRef,
    claimDiscordApproval,
    invalidateDiscordApprovals,
    resolvePreviewDecision,
  } = dependencies

  if (interaction.type === 2) {
    const modeResult = await handleDiscordModeCommand(interaction)

    return ephemeral(modeResult ?? (await handleDiscordChannelCommand(interaction)))
  }
  const match = interaction.data?.custom_id?.match(/^nuphos:tool:(approve|reject):(.+)$/)

  if (interaction.type !== 3 || !match) return ephemeral('This interaction is not supported.')
  const discordUserId = interaction.member?.user?.id ?? interaction.user?.id
  const decisionId = match[2]

  if (!discordUserId || !decisionId || !interaction.guild_id || !interaction.channel_id) {
    return ephemeral('This approval request is incomplete.')
  }
  const decision = await discordDecisions().findOne({
    _id: decisionId,
    guildId: interaction.guild_id,
    channelId: interaction.channel_id,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  })

  if (!decision) return ephemeral('This approval request expired or was already decided.')
  const mapping = await discordUserMappings().findOne({
    guildId: decision.guildId,
    discordUserId,
    teamId: decision.teamId,
    nuphosUserId: decision.actorUserId,
    enabled: true,
  })

  if (!mapping || !(await getTeamMembership(mapping.nuphosUserId, decision.teamId))) {
    return ephemeral('Only the person whose credentials this turn is using can decide it.')
  }
  const wait = await findPreviewWaitByRef('agent-permission', decision.ref)

  if (!wait || wait.sessionId !== decision.sessionId || wait.userId !== decision.actorUserId) {
    return ephemeral('This approval request is no longer active.')
  }
  const status = match[1] === 'approve' ? 'approved' : 'rejected'
  const claim = await claimDiscordApproval(decision, discordUserId, status)

  if (claim === 'revoked') {
    await invalidateDiscordApprovals({
      teamId: decision.teamId,
      guildId: decision.guildId,
      parentChannelId: decision.parentChannelId,
      installationGeneration: decision.installationGeneration,
      actorUserId: decision.actorUserId,
      reason: 'discord_authorization_revoked',
    })

    return ephemeral('This approval is no longer authorized for this server or channel.')
  }

  if (claim !== 'claimed') return ephemeral('This approval request was already decided.')
  const resolved = await resolvePreviewDecision({
    userId: wait.userId,
    sessionId: wait.sessionId,
    waitId: wait.waitId,
    payload: { decision: status },
  })

  if (!resolved) return ephemeral('This approval request was already decided.')
  logEvent('info', 'discord.tool_approval.decided', {
    decision: status,
    team_id: decision.teamId,
    session_id: decision.sessionId,
    discord_guild_id: decision.guildId,
    discord_user_id: discordUserId,
    nuphos_user_id: mapping.nuphosUserId,
  })

  return {
    type: 7,
    data: {
      content: status === 'approved' ? '✅ Tool approved once.' : '⛔ Tool request rejected.',
      components: [],
      allowed_mentions: { parse: [] },
    },
  }
}
