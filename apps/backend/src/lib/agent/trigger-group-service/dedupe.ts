import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import { byCodeUnit } from '@/lib/agent/sort-order'

import { agentTriggerGroups, isSharedIngressTriggerGroup } from '../trigger-group-db'

import type { AgentTriggerGroup } from '../trigger-group-db'
import type { SlackOutboundDestination } from '@/lib/slack/destinations'

export function triggerGroupDedupeKey(input: {
  /** Omitted for the team-scoped identity; supplied only to rebuild the legacy key. */
  userId?: string
  teamId: string
  memberKeys: string[]
  slackDestination?: SlackOutboundDestination
}): string {
  // v1 belonged to the earlier "many standalone triggers" prototype. Keep a
  // versioned boundary so its retained metadata cannot collide with a new
  // shared-ingress group using the same selection.
  return `watch-group:v2:${createHash('sha256')
    .update(
      JSON.stringify([
        input.userId ?? 'team',
        input.teamId,
        [...input.memberKeys].sort(byCodeUnit),
        input.slackDestination ?? null,
      ]),
    )
    .digest('hex')}`
}

/**
 * Find the Group this creation request should reuse.
 *
 * The pre-team-ownership key is derived from its creator, so a colleague
 * cannot compute the key of a Group somebody else created. Falling back to the
 * selection itself — same team, same exact member set, same destination — is
 * what actually converges an existing team Group onto one row.
 */
export async function findExistingTriggerGroup(input: {
  dedupeKey: string
  legacyDedupeKey: string
  teamId: string
  memberKeys: string[]
  slackDestination?: SlackOutboundDestination
}): Promise<AgentTriggerGroup | null> {
  const byKey = await agentTriggerGroups().findOne({
    dedupeKey: { $in: [input.dedupeKey, input.legacyDedupeKey] },
  })

  if (byKey) return byKey
  const candidates = await agentTriggerGroups()
    .find({
      teamId: input.teamId,
      // $all matches a superset, so the exact selection still has to be
      // confirmed by member count below.
      'members.key': { $all: input.memberKeys },
    })
    // Oldest first, so which Group a selection reuses does not depend on
    // storage order.
    .sort({ createdAt: 1 })
    .limit(50)
    .toArray()

  return (
    candidates.find(
      (candidate) =>
        // A v1 prototype row matching the same selection must stay unreachable.
        // Its creator-derived key never matched before, and returning it here
        // would fail the shared-ingress check and leave the caller permanently
        // unable to create this Group.
        isSharedIngressTriggerGroup(candidate) &&
        candidate.members.length === input.memberKeys.length &&
        isDeepStrictEqual(candidate.slackDestination, input.slackDestination),
    ) ?? null
  )
}
