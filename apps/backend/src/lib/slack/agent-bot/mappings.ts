import { AppError } from '@/lib/errors'
import {
  isDuplicateKeyError,
  slackChannelMappings,
  slackUserMappings,
} from '@/lib/slack/agent-bot/collections'

import type { SlackChannelMapping, SlackUserMapping } from '@/lib/slack/agent-bot/collections'

export async function getSlackChannelMapping(
  slackWorkspaceId: string,
  slackChannelId: string,
): Promise<SlackChannelMapping | null> {
  return await slackChannelMappings().findOne({
    slackWorkspaceId,
    slackChannelId,
    enabled: true,
  })
}

// A Slack Connect channel keeps the same channel id in every workspace it is
// shared with, so a mention arriving through one workspace's installation can
// detect that the channel is already served by another installation. Used only
// to point the user at the right bot — never to pick an execution context.
export async function getCrossWorkspaceChannelMapping(
  slackChannelId: string,
  excludeWorkspaceId: string,
): Promise<SlackChannelMapping | null> {
  return await slackChannelMappings().findOne({
    slackChannelId,
    slackWorkspaceId: { $ne: excludeWorkspaceId },
    enabled: true,
  })
}

export async function listSlackChannelMappings(teamId: string): Promise<SlackChannelMapping[]> {
  return await slackChannelMappings().find({ teamId }).sort({ updatedAt: -1 }).toArray()
}

export async function upsertSlackChannelMapping(data: {
  slackWorkspaceId: string
  slackChannelId: string
  teamId: string
  createdBy: string
  enabled?: boolean
}): Promise<SlackChannelMapping> {
  const now = new Date()
  const mapping = await slackChannelMappings().findOneAndUpdate(
    {
      slackWorkspaceId: data.slackWorkspaceId,
      slackChannelId: data.slackChannelId,
    },
    {
      $setOnInsert: {
        createdAt: now,
        createdBy: data.createdBy,
      },
      $set: {
        teamId: data.teamId,
        enabled: data.enabled ?? true,
        updatedAt: now,
      },
      $unset: { agentUserId: '', credentialAccess: '' },
    },
    { upsert: true, returnDocument: 'after' },
  )

  if (!mapping) throw new Error('Failed to upsert Slack channel mapping')

  return mapping
}

export async function deleteSlackChannelMapping(
  slackWorkspaceId: string,
  slackChannelId: string,
  teamId: string,
): Promise<boolean> {
  const result = await slackChannelMappings().deleteOne({
    slackWorkspaceId,
    slackChannelId,
    teamId,
  })

  return result.deletedCount > 0
}

export async function getSlackUserMapping(
  slackWorkspaceId: string,
  teamId: string,
  slackUserId: string,
): Promise<SlackUserMapping | null> {
  return await slackUserMappings().findOne({
    slackWorkspaceId,
    teamId,
    slackUserId,
    enabled: true,
  })
}

export async function getSlackUserMappingForNuphosUser(
  slackWorkspaceId: string,
  teamId: string,
  nuphosUserId: string,
): Promise<SlackUserMapping | null> {
  return await slackUserMappings().findOne({
    slackWorkspaceId,
    teamId,
    nuphosUserId,
    enabled: true,
  })
}

export async function listSlackUserMappings(teamId: string): Promise<SlackUserMapping[]> {
  return await slackUserMappings().find({ teamId }).sort({ updatedAt: -1 }).toArray()
}

export async function upsertSlackUserMapping(data: {
  slackWorkspaceId: string
  slackUserId: string
  teamId: string
  nuphosUserId: string
  createdBy: string
  enabled?: boolean
}): Promise<SlackUserMapping> {
  const now = new Date()
  const enabled = data.enabled ?? true

  if (enabled) {
    // Relinking retires the previous reverse mapping before enabling the new
    // one. The partial unique index closes the concurrent relink race.
    await slackUserMappings().updateMany(
      {
        slackWorkspaceId: data.slackWorkspaceId,
        teamId: data.teamId,
        nuphosUserId: data.nuphosUserId,
        slackUserId: { $ne: data.slackUserId },
        enabled: true,
      },
      { $set: { enabled: false, updatedAt: now } },
    )
  }
  try {
    const mapping = await slackUserMappings().findOneAndUpdate(
      {
        slackWorkspaceId: data.slackWorkspaceId,
        teamId: data.teamId,
        slackUserId: data.slackUserId,
      },
      {
        $setOnInsert: {
          createdAt: now,
          createdBy: data.createdBy,
        },
        $set: {
          nuphosUserId: data.nuphosUserId,
          enabled,
          updatedAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    )

    if (!mapping) throw new Error('Failed to upsert Slack user mapping')

    return mapping
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(
        409,
        'slack_identity_conflict',
        'Another link changed this Slack identity concurrently; retry the link operation',
      )
    }
    throw err
  }
}

/**
 * Atomically claim a Slack identity for the same Nuphos user. Unlike the
 * administrator-facing upsert, this auto-link path never overwrites another
 * user's active claim; a duplicate-key race is reported as null.
 */
export async function claimSlackUserMapping(data: {
  slackWorkspaceId: string
  slackUserId: string
  teamId: string
  nuphosUserId: string
  createdBy: string
}): Promise<SlackUserMapping | null> {
  const now = new Date()

  try {
    return await slackUserMappings().findOneAndUpdate(
      {
        slackWorkspaceId: data.slackWorkspaceId,
        teamId: data.teamId,
        slackUserId: data.slackUserId,
        $or: [
          { nuphosUserId: data.nuphosUserId },
          { enabled: false },
          { nuphosUserId: { $exists: false } },
        ],
      },
      {
        $setOnInsert: { createdAt: now, createdBy: data.createdBy },
        $set: {
          nuphosUserId: data.nuphosUserId,
          enabled: true,
          updatedAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    )
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return null
    throw err
  }
}

export async function deleteSlackUserMapping(
  slackWorkspaceId: string,
  teamId: string,
  slackUserId: string,
): Promise<boolean> {
  const result = await slackUserMappings().deleteOne({
    slackWorkspaceId,
    teamId,
    slackUserId,
  })

  return result.deletedCount > 0
}
