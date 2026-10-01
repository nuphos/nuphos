import { mongo } from '@/lib/db'
import {
  discordChannelMappings,
  discordInstallations,
  discordPendingOAuth,
  discordUserMappings,
} from '@/lib/discord/store'

import { markDiscordApprovalsRejected, resolveInvalidatedDiscordApprovals } from './approval'

import type { DiscordInstallation, DiscordPendingOAuth } from '@/lib/discord/store'

const dependencies = {
  startSession: () => mongo.startSession(),
  discordInstallations,
  discordPendingOAuth,
  discordChannelMappings,
  discordUserMappings,
  markDiscordApprovalsRejected,
  resolveInvalidatedDiscordApprovals,
}

/** Consume OAuth state in the same transaction as the grants it creates. */
export async function completeDiscordOAuth(
  args: {
    pending: DiscordPendingOAuth
    discordUserId: string
    guild?: { id: string; name: string }
  },
  deps = dependencies,
): Promise<DiscordInstallation> {
  const { pending, discordUserId, guild } = args
  const session = deps.startSession()
  let installation: DiscordInstallation | null = null
  let decisions: Awaited<ReturnType<typeof markDiscordApprovalsRejected>> = []

  try {
    await session.withTransaction(async () => {
      installation = null
      decisions = []
      const claimed = await deps
        .discordPendingOAuth()
        .deleteOne(
          { _id: pending._id, teamId: pending.teamId, expiresAt: { $gt: new Date() } },
          { session },
        )

      if (!claimed.deletedCount) throw new Error('expired_state')
      const existing = await deps
        .discordInstallations()
        .findOne({ teamId: pending.teamId }, { session })

      if (pending.operation === 'install') {
        if (!guild) throw new Error('missing_guild')
        if (existing?.guildId !== pending.expectedGuildId) {
          throw new Error('installation_changed')
        }
        const now = new Date()

        installation = {
          teamId: pending.teamId,
          guildId: guild.id,
          guildName: guild.name,
          installerDiscordUserId: discordUserId,
          installerNuphosUserId: pending.requesterUserId,
          // A new installation must never reuse a deleted installation's generation.
          generation: Math.max(now.getTime(), (existing?.generation ?? 0) + 1),
          enabled: true,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }
        await deps
          .discordInstallations()
          .updateOne({ teamId: pending.teamId }, { $set: installation }, { upsert: true, session })
        if (existing) {
          decisions = await deps.markDiscordApprovalsRejected(
            {
              teamId: pending.teamId,
              guildId: existing.guildId,
              installationGeneration: existing.generation,
            },
            session,
          )
        }
      } else {
        if (!existing?.enabled || existing.guildId !== pending.expectedGuildId) {
          throw new Error('installation_changed')
        }
        installation = existing
      }
      const prior = await deps
        .discordUserMappings()
        .findOne({ guildId: installation.guildId, discordUserId }, { session })

      if (prior && prior.nuphosUserId !== pending.requesterUserId) {
        throw new Error('discord_account_already_linked')
      }
      const now = new Date()

      await deps.discordUserMappings().updateOne(
        { guildId: installation.guildId, discordUserId },
        {
          $setOnInsert: { createdAt: now },
          $set: {
            teamId: pending.teamId,
            nuphosUserId: pending.requesterUserId,
            enabled: true,
            updatedAt: now,
          },
        },
        { upsert: true, session },
      )
    })
  } finally {
    await session.endSession()
  }
  await deps.resolveInvalidatedDiscordApprovals(decisions, 'discord_installation_replaced')
  if (!installation) throw new Error('installation_changed')

  return installation
}

export async function disconnectDiscord(teamId: string, deps = dependencies): Promise<void> {
  const session = deps.startSession()
  let decisions: Awaited<ReturnType<typeof markDiscordApprovalsRejected>> = []

  try {
    await session.withTransaction(async () => {
      decisions = await deps.markDiscordApprovalsRejected({ teamId }, session)
      await deps.discordInstallations().deleteOne({ teamId }, { session })
      await deps.discordChannelMappings().deleteMany({ teamId }, { session })
      await deps.discordUserMappings().deleteMany({ teamId }, { session })
      // Also conflicts with callbacks already exchanging a code outside this transaction.
      await deps.discordPendingOAuth().deleteMany({ teamId }, { session })
      // Keep thread bindings as tombstones: reinstallation cannot reuse their history.
    })
  } finally {
    await session.endSession()
  }
  await deps.resolveInvalidatedDiscordApprovals(decisions, 'discord_disconnected')
}
