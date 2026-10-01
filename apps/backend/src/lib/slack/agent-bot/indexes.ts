import {
  isDuplicateKeyError,
  slackAddressingVerdicts,
  slackAgentThreads,
  slackAssistantThreadContexts,
  slackChannelMappings,
  slackProcessedEvents,
  slackReplyFeedback,
  slackUserMappings,
} from '@/lib/slack/agent-bot/collections'

import type { ObjectId } from 'mongodb'

export async function setupSlackAgentIndexes(): Promise<void> {
  await slackChannelMappings().createIndex(
    { slackWorkspaceId: 1, slackChannelId: 1 },
    { unique: true, background: true },
  )
  await slackChannelMappings().createIndex({ teamId: 1, updatedAt: -1 }, { background: true })
  await slackUserMappings().createIndex(
    { slackWorkspaceId: 1, teamId: 1, slackUserId: 1 },
    { unique: true, background: true },
  )
  const createReverseMappingIndex = async () =>
    await slackUserMappings().createIndex(
      { slackWorkspaceId: 1, teamId: 1, nuphosUserId: 1 },
      {
        unique: true,
        partialFilterExpression: { enabled: true },
        background: true,
        name: 'slack_user_mapping_active_nuphos_unique',
      },
    )

  try {
    await createReverseMappingIndex()
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err
    // Older rows allowed several active Slack identities for one Nuphos user.
    // Only scan and migrate when the invariant cannot be installed because
    // such rows actually exist; established deployments skip this work.
    const duplicateReverseMappings = await slackUserMappings()
      .aggregate<{ ids: ObjectId[] }>([
        { $match: { enabled: true } },
        { $sort: { updatedAt: -1 } },
        {
          $group: {
            _id: {
              slackWorkspaceId: '$slackWorkspaceId',
              teamId: '$teamId',
              nuphosUserId: '$nuphosUserId',
            },
            ids: { $push: '$_id' },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray()

    for (const duplicate of duplicateReverseMappings) {
      await slackUserMappings().updateMany(
        { _id: { $in: duplicate.ids.slice(1) } },
        { $set: { enabled: false, updatedAt: new Date() } },
      )
    }
    await createReverseMappingIndex()
  }
  await slackUserMappings().createIndex({ teamId: 1, updatedAt: -1 }, { background: true })
  await slackUserMappings().createIndex({ nuphosUserId: 1, updatedAt: -1 }, { background: true })
  await slackAgentThreads().createIndex(
    { slackWorkspaceId: 1, slackChannelId: 1, slackThreadTs: 1 },
    { unique: true, background: true },
  )
  await slackAgentThreads().createIndex({ sessionId: 1 }, { unique: true, background: true })
  await slackAgentThreads().createIndex({ teamId: 1, lastActiveAt: -1 }, { background: true })
  await slackProcessedEvents().createIndex({ eventId: 1 }, { unique: true, background: true })
  await slackProcessedEvents().createIndex({ createdAt: -1 }, { background: true })
  await slackProcessedEvents().createIndex(
    { status: 1, processingExpiresAt: 1 },
    { background: true },
  )
  // One vote per user per reply; pressing the other button flips the verdict.
  await slackReplyFeedback().createIndex(
    { slackWorkspaceId: 1, slackChannelId: 1, messageTs: 1, slackUserId: 1 },
    { unique: true, background: true },
  )
  await slackReplyFeedback().createIndex({ sessionId: 1, updatedAt: -1 }, { background: true })
  await slackAssistantThreadContexts().createIndex(
    { slackWorkspaceId: 1, slackChannelId: 1, slackThreadTs: 1 },
    { unique: true, background: true },
  )
  await slackAddressingVerdicts().createIndex({ dedupeKey: 1 }, { unique: true, background: true })
  await slackAddressingVerdicts().createIndex({ addressed: 1, createdAt: -1 }, { background: true })
  await slackAddressingVerdicts().createIndex({ sessionId: 1, createdAt: -1 }, { background: true })
}
