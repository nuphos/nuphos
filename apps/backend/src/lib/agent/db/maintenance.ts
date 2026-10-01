import { randomUUID } from 'node:crypto'

import { purgeConversationAttribution } from '@/lib/agent/memory-slots/attribution-store'
import { purgeConversationPreviewMemoryActivity } from '@/lib/agent/memory-slots/preview-activity-store'
import { logError } from '@/lib/observability'

import { agentConversations, agentMessages, withTeamScope } from './shared'

// Refuses to blank a title. The conversation already carries a usable one from
// insert (`fallbackTitle`); overwriting it with '' leaves every reader falling
// back to the raw first message.
export async function updateConversationTitle(
  sessionId: string,
  userId: string,
  title: string,
): Promise<boolean> {
  const next = title.trim()

  if (!next) return false
  const result = await agentConversations().updateOne(
    { sessionId, userId, titleManuallySet: { $ne: true } },
    { $set: { title: next } },
  )

  return result.matchedCount > 0
}

// A manual title wins over an already-running background title generator.
export async function renameConversation(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
  title: string,
): Promise<boolean> {
  const next = title.trim()

  if (!next || next.length > 120) return false
  const result = await agentConversations().updateOne(
    withTeamScope({ sessionId, userId }, teamId),
    { $set: { title: next, titleManuallySet: true } },
  )

  return result.matchedCount > 0
}

// Prefix marking an in-flight claim — see `ensureBraintrustParent`. Stored
// values starting with this prefix are not valid Braintrust parent references
// and must not be returned to callers.
const BRAINTRUST_PARENT_CLAIM_PREFIX = '_claim:'

function isClaimToken(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.startsWith(BRAINTRUST_PARENT_CLAIM_PREFIX)
}

// Returns the conversation's stored Braintrust parent string, creating one via
// `factory` if missing. Bails when no conversation document exists (no point
// generating a parent we can't persist — future turns would also miss the doc
// and churn out fresh parents, defeating the whole point). Concurrency-safe:
// callers atomically claim the slot with a sentinel before invoking the
// (expensive) factory, so concurrent first-turns can't both create orphan
// Braintrust spans.
export async function ensureBraintrustParent(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
  factory: () => Promise<string | undefined>,
): Promise<string | undefined> {
  const filter = withTeamScope({ sessionId, userId }, teamId)
  const existing = await agentConversations().findOne(filter, {
    projection: { braintrustParent: 1 },
  })

  if (!existing) return undefined
  if (existing.braintrustParent && !isClaimToken(existing.braintrustParent)) {
    return existing.braintrustParent
  }

  // Atomically reserve the slot. Filter requires the doc still has no
  // `braintrustParent`, so only one of N concurrent callers wins.
  const claimToken = `${BRAINTRUST_PARENT_CLAIM_PREFIX}${randomUUID()}`
  const claimed = await agentConversations().findOneAndUpdate(
    { ...filter, braintrustParent: { $exists: false } },
    { $set: { braintrustParent: claimToken } },
    { returnDocument: 'after', projection: { braintrustParent: 1 } },
  )

  if (!claimed) {
    // Someone else claimed first (or the doc disappeared). Read the canonical
    // value. If the winner is still in the middle of `factory()` we'll see
    // their claim token — return undefined rather than a placeholder.
    const after = await agentConversations().findOne(filter, {
      projection: { braintrustParent: 1 },
    })
    const value = after?.braintrustParent

    return value && !isClaimToken(value) ? value : undefined
  }

  // We hold the claim — only this caller invokes the factory.
  const releaseClaim = () =>
    agentConversations()
      .updateOne({ ...filter, braintrustParent: claimToken }, { $unset: { braintrustParent: '' } })
      .catch((err: unknown) => {
        logError('braintrust.parent_claim_release_failed', err)
      })

  let created: string | undefined

  try {
    created = await factory()
  } catch (err) {
    await releaseClaim()
    throw err
  }
  if (!created) {
    await releaseClaim()

    return undefined
  }
  await agentConversations().updateOne(
    { ...filter, braintrustParent: claimToken },
    { $set: { braintrustParent: created } },
  )

  return created
}

export async function getCompactionSummary(
  sessionId: string,
  userId: string,
): Promise<{ summary: string; messageCount: number } | null> {
  const doc = await agentConversations().findOne(
    { sessionId, userId },
    { projection: { compactionSummary: 1, compactionMessageCount: 1 } },
  )

  if (!doc?.compactionSummary || doc.compactionMessageCount == null) return null

  return { summary: doc.compactionSummary, messageCount: doc.compactionMessageCount }
}

export async function updateCompactionSummary(
  sessionId: string,
  userId: string,
  summary: string,
  messageCount: number,
): Promise<void> {
  await agentConversations().updateOne(
    {
      sessionId,
      userId,
      $or: [
        { compactionMessageCount: { $lt: messageCount } },
        { compactionMessageCount: { $exists: false } },
      ],
    },
    { $set: { compactionSummary: summary, compactionMessageCount: messageCount } },
  )
}

export async function deleteConversation(
  sessionId: string,
  userId: string,
  teamId?: string,
): Promise<boolean> {
  const result = await agentConversations().deleteOne(withTeamScope({ sessionId, userId }, teamId))

  if (result.deletedCount === 0) return false
  await agentMessages().deleteMany({ sessionId, userId })
  // A6: measurement rows carry PII (userId/teamId/notes) and must die with
  // the conversation. Fail-open: the conversation is already gone, so a
  // transient purge error must not 5xx the delete (a retry would then 404);
  // analytics never blocks a user operation.
  await purgeConversationAttribution(sessionId).catch((err: unknown) => {
    logError('memory.attribution_purge_failed', err, { sessionId })
  })
  await purgeConversationPreviewMemoryActivity(sessionId).catch((err: unknown) => {
    logError('memory.preview_activity_purge_failed', err, { sessionId })
  })

  return true
}
