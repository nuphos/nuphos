import { randomUUID } from 'node:crypto'

import { db } from '@/lib/db'

import type { AgentDevice } from './store'
import type { Collection } from 'mongodb'

/** One teammate's conversation waiting for, or given, a computer owner's answer. */
export type ShareApproval = {
  _id: string
  ownerId: string
  deviceId: string
  teamId: string
  sessionId: string
  actorId: string
  status: 'pending' | 'approved' | 'denied'
  requestedAt: Date
  decidedAt?: Date
}

export const shareApprovals = (): Collection<ShareApproval> =>
  db().collection<ShareApproval>('agent_device_share_approvals')

export async function setupShareApprovalIndexes(): Promise<void> {
  await shareApprovals().createIndex(
    { ownerId: 1, deviceId: 1, sessionId: 1, actorId: 1 },
    { unique: true, name: 'share_approval_unique' },
  )
  await shareApprovals().createIndex(
    { ownerId: 1, status: 1, requestedAt: -1 },
    { name: 'share_approval_owner_status' },
  )
}

/** Approvals a person asked for or gave in this team, so none carries over if they rejoin. */
export async function dropMemberShareApprovals(teamId: string, userId: string): Promise<void> {
  await shareApprovals().deleteMany({ teamId, $or: [{ actorId: userId }, { ownerId: userId }] })
}

/**
 * Every team's answers about this computer. Their team is not named, because the
 * computer is going: a machine that registers again under the same id asks afresh.
 */
export async function dropDeviceShareApprovals(ownerId: string, deviceId: string): Promise<void> {
  await shareApprovals().deleteMany({ ownerId, deviceId })
}

export async function findShareApproval(
  ownerId: string,
  deviceId: string,
  sessionId: string,
  actorId: string,
): Promise<ShareApproval | null> {
  return shareApprovals().findOne({ ownerId, deviceId, sessionId, actorId })
}

export async function requestShareApproval(input: {
  device: AgentDevice
  teamId: string
  actorId: string
  sessionId: string
}): Promise<void> {
  const { device, teamId, actorId, sessionId } = input

  await shareApprovals().updateOne(
    { ownerId: device.userId, deviceId: device.deviceId, sessionId, actorId },
    {
      $setOnInsert: {
        _id: randomUUID(),
        teamId,
        status: 'pending',
        requestedAt: new Date(),
      },
    },
    { upsert: true },
  )
}

/** The latest answer this person has for their own conversation, if they asked. */
export async function findOwnShareApproval(
  sessionId: string,
  actorId: string,
): Promise<ShareApproval | null> {
  return shareApprovals().findOne({ sessionId, actorId }, { sort: { requestedAt: -1 } })
}

/** What waits for this owner, newest first. */
export async function listPendingShareApprovals(
  ownerId: string,
  teamId: string,
): Promise<ShareApproval[]> {
  return shareApprovals()
    .find({ ownerId, teamId, status: 'pending' })
    .sort({ requestedAt: -1 })
    .limit(50)
    .toArray()
}

/** One teammate's requests still waiting on one of this owner's computers in this team. */
export async function listPendingShareApprovalsFrom(key: {
  ownerId: string
  deviceId: string
  teamId: string
  actorId: string
}): Promise<ShareApproval[]> {
  return shareApprovals()
    .find({ ...key, status: 'pending' })
    .limit(500)
    .toArray()
}

/** Only the owner's own pending request changes; the answer is final for that conversation. */
export async function decideShareApproval(
  ownerId: string,
  approvalId: string,
  approve: boolean,
): Promise<ShareApproval | null> {
  return shareApprovals().findOneAndUpdate(
    { _id: approvalId, ownerId, status: 'pending' },
    { $set: { status: approve ? 'approved' : 'denied', decidedAt: new Date() } },
    { returnDocument: 'after' },
  )
}

/** Forgets the answers these people had on this computer, so a new grant asks again. */
export async function dropShareApprovals(
  ownerId: string,
  deviceId: string,
  teamId: string,
  actorIds?: string[],
): Promise<void> {
  await shareApprovals().deleteMany({
    ownerId,
    deviceId,
    teamId,
    ...(actorIds ? { actorId: { $in: actorIds } } : {}),
  })
}
