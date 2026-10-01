import { randomBytes, randomUUID } from 'node:crypto'

import { resolvePreviewDecisionByRef } from '@/lib/claude-code-preview/decision-waiter'
import { mongo } from '@/lib/db'
import { sendDiscordApproval } from '@/lib/discord/api'
import { discordDecisions, discordInstallations, discordChannelMappings } from '@/lib/discord/store'

import type { DiscordDecision } from '@/lib/discord/store'
import type { ClientSession } from 'mongodb'

export async function postDiscordToolApproval(args: {
  request: Record<string, unknown>
  guildId: string
  channelId: string
  parentChannelId: string
  installationGeneration: number
  teamId: string
  sessionId: string
  actorUserId: string
}): Promise<void> {
  const toolCallId = typeof args.request.toolCallId === 'string' ? args.request.toolCallId : null

  if (!toolCallId) return
  const decisionId = randomBytes(18).toString('base64url')
  const label =
    typeof args.request.toolLabel === 'string' ? args.request.toolLabel : 'Run the requested tool'

  const session = mongo.startSession()
  let created = false

  try {
    await session.withTransaction(async () => {
      created = false
      const update = { $set: { discordApprovalFence: randomUUID() } }
      const installation = await discordInstallations().updateOne(
        {
          teamId: args.teamId,
          guildId: args.guildId,
          generation: args.installationGeneration,
          enabled: true,
        },
        update,
        { session },
      )
      const channel = await discordChannelMappings().updateOne(
        {
          teamId: args.teamId,
          guildId: args.guildId,
          channelId: args.parentChannelId,
          enabled: true,
        },
        update,
        { session },
      )

      if (!installation.matchedCount || !channel.matchedCount) return
      await discordDecisions().insertOne(
        {
          _id: decisionId,
          kind: 'agent-permission',
          ref: toolCallId,
          guildId: args.guildId,
          channelId: args.channelId,
          parentChannelId: args.parentChannelId,
          installationGeneration: args.installationGeneration,
          teamId: args.teamId,
          sessionId: args.sessionId,
          actorUserId: args.actorUserId,
          status: 'pending',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
        { session },
      )
      created = true
    })
  } finally {
    await session.endSession()
  }
  if (!created) {
    await resolvePreviewDecisionByRef({
      kind: 'agent-permission',
      ref: toolCallId,
      payload: { decision: 'rejected', reason: 'discord_disconnected' },
    })

    return
  }

  try {
    await sendDiscordApproval({
      channelId: args.channelId,
      content: `Approval required: **${label.replaceAll('*', '\\*').slice(0, 180)}**`,
      decisionId,
    })
  } catch (err) {
    await discordDecisions().deleteOne({ _id: decisionId })
    await resolvePreviewDecisionByRef({
      kind: 'agent-permission',
      ref: toolCallId,
      payload: { decision: 'rejected', reason: 'discord_card_delivery_failed' },
    })
    throw err
  }
}

export async function invalidateDiscordApprovals(args: {
  teamId: string
  guildId?: string
  parentChannelId?: string
  installationGeneration?: number
  actorUserId?: string
  reason: string
}): Promise<void> {
  const decisions = await markDiscordApprovalsRejected(args)

  await resolveInvalidatedDiscordApprovals(decisions, args.reason)
}

export async function markDiscordApprovalsRejected(
  args: {
    teamId: string
    guildId?: string
    parentChannelId?: string
    installationGeneration?: number
    actorUserId?: string
  },
  session?: ClientSession,
): Promise<DiscordDecision[]> {
  const filter = {
    teamId: args.teamId,
    status: 'pending' as const,
    ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
    ...(args.guildId ? { guildId: args.guildId } : {}),
    ...(args.parentChannelId ? { parentChannelId: args.parentChannelId } : {}),
    ...(args.installationGeneration === undefined
      ? {}
      : { installationGeneration: args.installationGeneration }),
  }
  const decisions = await discordDecisions().find(filter, { session }).toArray()

  if (!decisions.length) return []
  const decidedAt = new Date()

  await discordDecisions().updateMany(
    filter,
    { $set: { status: 'rejected', decidedAt } },
    { session },
  )

  return decisions
}

export async function resolveInvalidatedDiscordApprovals(
  decisions: DiscordDecision[],
  reason: string,
): Promise<void> {
  await Promise.all(
    decisions.map(async (decision) => {
      await resolvePreviewDecisionByRef({
        kind: decision.kind,
        ref: decision.ref,
        payload: { decision: 'rejected', reason },
      })
    }),
  )
}
