import { ObjectId } from 'mongodb'

import { getTeamMembership } from '@/lib/identity'
import { redactSecrets } from '@/lib/journal/redact'

import { agentMemories, LIVE_RECORD_FILTER, teamMemories } from './store'

import type { MemoryScope } from './records-api-types'

// ── Delete (DELETE /memories/:memoryId) ─────────────────────────────────
// Everything is a tombstone, never a hard delete (ADR-0005/0006): flat
// records get disabledAt/disabledBy (audit survives, restoreMemoryItem can
// revert, and the write gate blocks silent resurrection); playbooks soft-delete
// to status 'rejected' — lineage and the applications journal stay intact.
// Team-scope deletes require EDITOR+, matching the Playbook write path's gate
// (a VIEWER must not be able to remove curated knowledge it cannot even
// propose).

export async function deleteMemoryItem(
  userId: string,
  memoryId: string,
  opts: { teamId?: string; scope?: MemoryScope; reason?: string } = {},
): Promise<boolean> {
  if (!ObjectId.isValid(memoryId)) return false
  const _id = new ObjectId(memoryId)
  // Human-stated removal reason: the strongest negative ground truth we can
  // collect. Redacted (people paste secrets into "why" boxes too) and capped.
  const reason = opts.reason?.trim()
    ? redactSecrets(opts.reason.trim()).redacted.slice(0, 300)
    : undefined

  if (opts.scope === 'team') {
    if (!opts.teamId) return false
    // Role gate FIRST: VIEWER is read-only for ALL team-scope deletes — the
    // flat (imported legacy) records too, not just playbook tombstoning.
    const membership = await getTeamMembership(userId, opts.teamId)

    if (!membership || membership.role === 'VIEWER') return false
    const disabled = await agentMemories().updateOne(
      { _id, scope: 'team', teamId: opts.teamId, ...LIVE_RECORD_FILTER },
      {
        $set: {
          disabledAt: new Date(),
          disabledBy: userId,
          ...(reason ? { disabledReason: reason } : {}),
        },
      },
    )

    if (disabled.matchedCount > 0) return true
    // Only VISIBLE playbooks are deletable (review F5): superseded ones are
    // already out of every read path — rewriting their status would destroy
    // lineage history for no user-visible effect. The prior status rides
    // along on the tombstone (rejectedFromStatus) so restore can put the
    // playbook back where it was; re-checking status in the update filter keeps
    // the pair race-safe (a concurrent delete just loses, matchedCount 0).
    const playbook = await teamMemories().findOne(
      { _id, teamId: opts.teamId, status: { $in: ['active', 'needs_review'] } },
      { projection: { status: 1 } },
    )

    if (!playbook) return false
    const priorStatus = playbook.status as 'active' | 'needs_review' // guaranteed by the $in filter above
    const softDeleted = await teamMemories().updateOne(
      { _id, teamId: opts.teamId, status: priorStatus },
      {
        $set: {
          status: 'rejected',
          rejectedFromStatus: priorStatus,
          updatedAt: new Date(),
          updatedBy: userId,
          ...(reason ? { rejectedReason: reason } : {}),
        },
      },
    )

    return softDeleted.matchedCount > 0
  }
  // Tombstone, not delete (ADR-0005/0006): audit + restore + non-resurrection.
  const disabled = await agentMemories().updateOne(
    {
      _id,
      scope: 'personal',
      ownerUserId: userId,
      teamId: opts.teamId ?? null,
      ...LIVE_RECORD_FILTER,
    },
    {
      $set: {
        disabledAt: new Date(),
        disabledBy: userId,
        ...(reason ? { disabledReason: reason } : {}),
      },
    },
  )

  return disabled.matchedCount > 0
}

// ── Restore (POST /memories/:memoryId/restore, ADR-0005) ────────────────
// A wrong removal costs one click. Authority: personal = the owner; team
// (flat record or playbook) = whoever removed it, or an ADMINISTRATOR.

async function canRestoreTeamItem(
  userId: string,
  teamId: string,
  removedBy: string | undefined,
): Promise<boolean> {
  if (removedBy === userId) return true
  const membership = await getTeamMembership(userId, teamId)

  return membership?.role === 'ADMINISTRATOR'
}

export async function restoreMemoryItem(
  userId: string,
  memoryId: string,
  opts: { teamId?: string; scope?: MemoryScope } = {},
): Promise<boolean> {
  if (!ObjectId.isValid(memoryId)) return false
  const _id = new ObjectId(memoryId)

  if (opts.scope === 'team') {
    if (!opts.teamId) return false
    const record = await agentMemories().findOne(
      { _id, scope: 'team', teamId: opts.teamId, disabledAt: { $exists: true } },
      { projection: { disabledBy: 1 } },
    )

    if (record) {
      if (!(await canRestoreTeamItem(userId, opts.teamId, record.disabledBy))) return false
      // Superseded records are NOT user tombstones: restoring one would put
      // the outdated predecessor back alongside its replacement (review).
      // Remove the replacement first if the old version is really wanted.
      // scope/teamId repeated from the findOne: _id alone would already be
      // unique, but tenant-isolation writes keep the full filter (defense
      // in depth against any future path that reassigns a record's team).
      const res = await agentMemories().updateOne(
        {
          _id,
          scope: 'team',
          teamId: opts.teamId,
          disabledAt: { $exists: true },
          supersededBy: { $exists: false },
        },
        { $unset: { disabledAt: '', disabledBy: '' } },
      )

      return res.matchedCount > 0
    }
    const playbook = await teamMemories().findOne(
      { _id, teamId: opts.teamId, status: 'rejected' },
      { projection: { updatedBy: 1, rejectedFromStatus: 1 } },
    )

    if (!playbook) return false
    if (!(await canRestoreTeamItem(userId, opts.teamId, playbook.updatedBy))) return false
    // Back to the status it was removed from: delete+restore must not
    // silently promote a needs_review playbook. Legacy tombstones (no
    // rejectedFromStatus) restore to 'active'.
    const res = await teamMemories().updateOne(
      { _id, teamId: opts.teamId, status: 'rejected' },
      {
        $set: {
          status: playbook.rejectedFromStatus ?? 'active',
          updatedAt: new Date(),
          updatedBy: userId,
        },
        $unset: { rejectedFromStatus: '' },
      },
    )

    return res.matchedCount > 0
  }
  // Same supersede guard as the team branch above.
  const res = await agentMemories().updateOne(
    {
      _id,
      scope: 'personal',
      ownerUserId: userId,
      teamId: opts.teamId ?? null,
      disabledAt: { $exists: true },
      supersededBy: { $exists: false },
    },
    { $unset: { disabledAt: '', disabledBy: '' } },
  )

  return res.matchedCount > 0
}
