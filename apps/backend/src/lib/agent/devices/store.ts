import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'

import type { Collection } from 'mongodb'

export type AgentDevice = {
  userId: string
  deviceId: string
  label: string
  platform: string
  allowLocalExec: boolean
  createdAt: Date
  updatedAt: Date
}

export type AgentDeviceRegistration = Pick<
  AgentDevice,
  'deviceId' | 'label' | 'platform' | 'allowLocalExec'
>

const agentDevices = (): Collection<AgentDevice> => db().collection<AgentDevice>('agent_devices')

export async function setupAgentDeviceIndexes(): Promise<void> {
  const collection = agentDevices()

  await collection.createIndex(
    { userId: 1, deviceId: 1 },
    { unique: true, name: 'agent_device_user_device_unique' },
  )
}

export async function upsertAgentDevice(
  userId: string,
  device: AgentDeviceRegistration,
): Promise<void> {
  const now = new Date()

  await agentDevices().updateOne(
    { userId, deviceId: device.deviceId },
    { $set: { ...device, userId, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  )
}

export async function getAgentDevice(
  userId: string,
  deviceId: string,
): Promise<AgentDevice | null> {
  return agentDevices().findOne({ userId, deviceId })
}

export async function listAgentDevicesForUser(userId: string): Promise<AgentDevice[]> {
  return agentDevices().find({ userId }).toArray()
}

type TeamMembershipDoc = {
  members: { userId: ObjectId; deletedAt?: Date }[]
}

/** Local agents and local exec follow their owner into any team they currently belong to. */
export async function isActiveTeamMember(userId: string, teamId: string): Promise<boolean> {
  if (!ObjectId.isValid(userId) || !ObjectId.isValid(teamId)) return false
  const userObjectId = new ObjectId(userId)
  const team = await db()
    .collection<TeamMembershipDoc>('teams')
    .findOne(
      { _id: new ObjectId(teamId), deletedAt: { $exists: false } },
      { projection: { members: 1 } },
    )

  return Boolean(team?.members.some((m) => m.userId.equals(userObjectId) && !m.deletedAt))
}
