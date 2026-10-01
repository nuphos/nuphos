import { randomUUID } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { mongo } from '@/lib/db'
import {
  discordChannelMappings,
  discordDecisions,
  discordInstallations,
  discordUserMappings,
} from '@/lib/discord/store'
import { teams } from '@/lib/identity/shared'

import type { DiscordDecision } from '@/lib/discord/store'

const defaultDependencies = {
  mongo,
  teams,
  discordChannelMappings,
  discordDecisions,
  discordInstallations,
  discordUserMappings,
}

export type DiscordApprovalClaimDependencies = typeof defaultDependencies
export type DiscordApprovalClaim = 'claimed' | 'revoked' | 'already-decided'

/** Write every authorization document in the decision transaction. Snapshot
 * reads alone do not conflict with a concurrent revocation on another document.
 * A changed fence forces a write conflict/retry when any grant is revoked. */
export async function claimDiscordApproval(
  decision: DiscordDecision,
  discordUserId: string,
  status: 'approved' | 'rejected',
  dependencies: DiscordApprovalClaimDependencies = defaultDependencies,
): Promise<DiscordApprovalClaim> {
  const session = dependencies.mongo.startSession()
  let result: DiscordApprovalClaim = 'already-decided'

  try {
    await session.withTransaction(async () => {
      result = 'already-decided'
      const update = { $set: { discordApprovalFence: randomUUID() } }
      // Keep operations sequential: the Mongo driver does not support parallel
      // operations within a transaction.
      const installation = await dependencies.discordInstallations().updateOne(
        {
          guildId: decision.guildId,
          teamId: decision.teamId,
          generation: decision.installationGeneration,
          enabled: true,
        },
        update,
        { session },
      )
      const channel = await dependencies.discordChannelMappings().updateOne(
        {
          guildId: decision.guildId,
          teamId: decision.teamId,
          channelId: decision.parentChannelId,
          enabled: true,
        },
        update,
        { session },
      )
      const mapping = await dependencies.discordUserMappings().updateOne(
        {
          guildId: decision.guildId,
          teamId: decision.teamId,
          discordUserId,
          nuphosUserId: decision.actorUserId,
          enabled: true,
        },
        update,
        { session },
      )
      const membership = await dependencies.teams().updateOne(
        {
          _id: new ObjectId(decision.teamId),
          deletedAt: { $exists: false },
          members: {
            $elemMatch: {
              userId: new ObjectId(decision.actorUserId),
              deletedAt: { $exists: false },
            },
          },
        },
        update,
        { session },
      )

      if (
        ![installation, channel, mapping, membership].every((grant) => grant.matchedCount === 1)
      ) {
        result = 'revoked'

        return
      }
      const claimed = await dependencies.discordDecisions().findOneAndUpdate(
        {
          _id: decision._id,
          status: 'pending',
          expiresAt: { $gt: new Date() },
          guildId: decision.guildId,
          channelId: decision.channelId,
          teamId: decision.teamId,
          actorUserId: decision.actorUserId,
          installationGeneration: decision.installationGeneration,
        },
        { $set: { status, decidedAt: new Date() } },
        { returnDocument: 'after', session },
      )

      result = claimed ? 'claimed' : 'already-decided'
    })
  } finally {
    await session.endSession()
  }

  return result
}
