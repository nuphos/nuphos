import { randomUUID } from 'node:crypto'

import { db } from '@/lib/db'

import { agentDevices } from './store'

import type { LocalAgentShare } from './local-share-types'
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
  await agentDevices().createIndex(
    { 'shares.teamId': 1 },
    { partialFilterExpression: { 'shares.0': { $exists: true } }, name: 'agent_device_shares' },
  )
}

/** People's own computers with a share in this team; never a Box. */
export async function listDevicesSharedInTeam(teamId: string): Promise<AgentDevice[]> {
  return agentDevices()
    .find({ 'shares.teamId': teamId, box: { $exists: false } })
    .toArray()
}

/** Replaces this team's share on the owner's own computer; null removes it. */
export async function setDeviceShare(
  ownerId: string,
  deviceId: string,
  teamId: string,
  share: LocalAgentShare | null,
): Promise<boolean> {
  // One update, so two saves at once never leave the team with two shares or none.
  const result = await agentDevices().updateOne(
    { userId: ownerId, deviceId, box: { $exists: false } },
    [
      {
        $set: {
          shares: {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ['$shares', []] },
                  cond: { $ne: ['$$this.teamId', teamId] },
                },
              },
              share ? [share] : [],
            ],
          },
          updatedAt: '$$NOW',
        },
      },
    ],
  )

  return result.matchedCount > 0
}

/** For a person who left the team or was removed: no computer in it stays shared with them. */
export async function dropFromTeamDeviceShares(teamId: string, userId: string): Promise<void> {
  await agentDevices().updateMany(
    { shares: { $elemMatch: { teamId, userIds: userId } } },
    { $pull: { 'shares.$[share].userIds': userId } },
    { arrayFilters: [{ 'share.teamId': teamId }] },
  )
}

/** Owners' computers shared in this team; they stop being shared when the owner leaves it. */
export async function dropOwnerTeamDeviceShares(teamId: string, ownerId: string): Promise<void> {
  await agentDevices().updateMany(
    { userId: ownerId, 'shares.teamId': teamId },
    { $pull: { shares: { teamId } } },
  )
}

/** Approvals a person asked for or gave in this team, so none carries over if they rejoin. */
export async function dropMemberShareApprovals(teamId: string, userId: string): Promise<void> {
  await shareApprovals().deleteMany({ teamId, $or: [{ actorId: userId }, { ownerId: userId }] })
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
