import { db } from '@/lib/db'

import type { AgentAddition, RegisteredAgent } from './agent-registry'
import type { LocalAgentShare } from './local-share-types'
import type { RequestOrigin } from '@/lib/request-origin'
import type { Collection } from 'mongodb'

export { isActiveTeamMember } from './team-membership'

/**
 * A machine Nuphos created for this device; absent for a person's own computer. Its state is
 * never stored: instabox and presence know it. A `k8s` Box is the pod of a managed runtime,
 * which the team reaches through that runtime, so it is never listed as one of the team's Boxes.
 */
export type AgentDeviceBox = {
  provider: 'instabox' | 'k8s'
  /** Set once the machine is ordered; a row without one is still being created. */
  sandboxId?: string
  /** The vCPUs it was ordered with; they count against the team's limit until the machine is listed. */
  vcpus?: number
  /** Asset scope; independent of the host's transport owner. */
  teamId: string
  createdBy?: string
  access?: { everyone: boolean; userIds: string[] }
  /** When an update last restarted its host; see box-updating. */
  updateStartedAt?: Date
}

export type AgentDevice = {
  userId: string
  deviceId: string
  label: string
  platform: string
  /** The machine's model as the OS names it, e.g. "MacBook Pro"; absent for a Box. */
  model?: string
  allowLocalExec: boolean
  box?: AgentDeviceBox
  /** Teams in which its owner shares this computer's Local Agent; never on a Box. See local-share. */
  shares?: LocalAgentShare[]
  /** Agents this computer has ever had signed in; see agent-registry. */
  agents?: RegisteredAgent[]
  /** Who added each of its added agents; absent for agents added before this was recorded. */
  addedAgents?: AgentAddition[]
  /** sha256 of the credential a join token issued; absent for devices signed in as their owner. */
  credentialHash?: string
  credentialIssuedAt?: Date
  /**
   * When its host reported in: set on its first report of each connection and when its agent
   * list changes. Absent means it has never joined; a Box is still starting until then.
   */
  lastSeenAt?: Date
  /** Where the host connected from when it last reported in. */
  lastSeen?: RequestOrigin
  createdAt: Date
  updatedAt: Date
}

export type AgentDeviceRegistration = Pick<
  AgentDevice,
  'deviceId' | 'label' | 'platform' | 'model' | 'allowLocalExec'
>

export const agentDevices = (): Collection<AgentDevice> =>
  db().collection<AgentDevice>('agent_devices')

export async function setupAgentDeviceIndexes(): Promise<void> {
  const collection = agentDevices()

  await collection.createIndex(
    { userId: 1, deviceId: 1 },
    { unique: true, name: 'agent_device_user_device_unique' },
  )
  await collection.createIndex(
    { credentialHash: 1 },
    {
      unique: true,
      partialFilterExpression: { credentialHash: { $exists: true } },
      name: 'agent_device_credential_unique',
    },
  )
}

/**
 * Registers the device, or refreshes what it reports about itself. The label is
 * written only for a new device: a person renames it through `renameAgentDevice`,
 * and the machine's own re-registration (every Desktop launch, every host start)
 * must not undo that.
 */
export async function upsertAgentDevice(
  userId: string,
  { label, ...device }: AgentDeviceRegistration,
): Promise<void> {
  const now = new Date()

  await agentDevices().updateOne(
    { userId, deviceId: device.deviceId },
    { $set: { ...device, userId, updatedAt: now }, $setOnInsert: { label, createdAt: now } },
    { upsert: true },
  )
}

export async function renameAgentDevice(
  userId: string,
  deviceId: string,
  label: string,
): Promise<boolean> {
  const result = await agentDevices().updateOne(
    { userId, deviceId },
    { $set: { label, updatedAt: new Date() } },
  )

  return result.matchedCount === 1
}

/** A joined device is always new, so a join token can never take over an existing one. */
export async function insertJoinedAgentDevice(
  userId: string,
  device: AgentDeviceRegistration,
  credentialHash: string,
): Promise<void> {
  const now = new Date()

  await agentDevices().insertOne({
    ...device,
    userId,
    credentialHash,
    credentialIssuedAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * A Box's device row exists from the moment the machine is ordered, so the UI can show it.
 * Its access is the creator's, plus `shared` when the route chose whom to share it with;
 * whatever access the registration carries is ignored.
 */
export async function insertBoxAgentDevice(
  userId: string,
  device: AgentDeviceRegistration & { box: AgentDeviceBox },
  shared?: { everyone: boolean; userIds: string[] },
): Promise<AgentDevice> {
  const now = new Date()
  const access = {
    everyone: shared?.everyone ?? false,
    userIds: [...new Set([userId, ...(shared?.userIds ?? [])])],
  }
  const created: AgentDevice = {
    ...device,
    userId,
    box: { ...device.box, createdBy: userId, access },
    createdAt: now,
    updatedAt: now,
  }

  await agentDevices().insertOne(created)

  return created
}

/** The device a managed runtime's pod joins as: the team's, usable by all of it. */
export async function insertManagedRuntimeDevice(
  userId: string,
  device: { deviceId: string; label: string; teamId: string },
): Promise<AgentDevice> {
  const now = new Date()
  const created: AgentDevice = {
    deviceId: device.deviceId,
    label: device.label,
    platform: 'linux',
    allowLocalExec: false,
    userId,
    box: {
      provider: 'k8s',
      teamId: device.teamId,
      createdBy: userId,
      access: { everyone: true, userIds: [] },
    },
    createdAt: now,
    updatedAt: now,
  }

  await agentDevices().insertOne(created)

  return created
}

/**
 * The join token made for a Box claims that Box's row, and nothing else: the row
 * must still have no credential, so a token can never take over a device in use.
 */
export async function claimBoxAgentDevice(
  userId: string,
  deviceId: string,
  platform: string,
  credentialHash: string,
): Promise<boolean> {
  const now = new Date()
  const result = await agentDevices().updateOne(
    { userId, deviceId, box: { $exists: true }, credentialHash: { $exists: false } },
    {
      $set: { platform, credentialHash, credentialIssuedAt: now, updatedAt: now },
    },
  )

  return result.matchedCount > 0
}

export async function findAgentDeviceByCredentialHash(
  credentialHash: string,
): Promise<AgentDevice | null> {
  return agentDevices().findOne({ credentialHash })
}

export async function revokeAgentDeviceCredential(
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const result = await agentDevices().updateOne(
    { userId, deviceId, credentialHash: { $exists: true } },
    { $unset: { credentialHash: '' }, $set: { updatedAt: new Date() } },
  )

  return result.modifiedCount > 0
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

export async function setAgentDeviceBoxSandbox(
  userId: string,
  deviceId: string,
  sandboxId: string,
): Promise<boolean> {
  const result = await agentDevices().updateOne(
    { userId, deviceId, box: { $exists: true } },
    { $set: { 'box.sandboxId': sandboxId, updatedAt: new Date() } },
  )

  return result.matchedCount > 0
}

/** vCPUs of the team's Boxes still being ordered: rows without their machine yet. */
export async function teamOrderingVcpus(teamId: string): Promise<number> {
  const rows = await agentDevices()
    .find(
      {
        'box.teamId': teamId,
        'box.provider': { $ne: 'k8s' },
        'box.sandboxId': { $exists: false },
      },
      { projection: { 'box.vcpus': 1 } },
    )
    .toArray()

  return rows.reduce((sum, row) => sum + (row.box?.vcpus ?? 0), 0)
}

export async function deleteAgentDevice(userId: string, deviceId: string): Promise<boolean> {
  const result = await agentDevices().deleteOne({ userId, deviceId })

  return result.deletedCount > 0
}

/** Never infer a legacy Box's team from its owner. */
export async function listTeamBoxes(teamId: string): Promise<AgentDevice[]> {
  return agentDevices()
    .find({ 'box.teamId': teamId, 'box.provider': { $ne: 'k8s' } })
    .toArray()
}

/** Replaces who may use a Box. Callers check `manage` first. */
export async function setBoxAccess(
  userId: string,
  deviceId: string,
  access: { everyone: boolean; userIds: string[] },
): Promise<boolean> {
  const result = await agentDevices().updateOne(
    { userId, deviceId, box: { $exists: true } },
    { $set: { 'box.access': access, updatedAt: new Date() } },
  )

  return result.matchedCount === 1
}

/** Someone who left the team leaves every one of its Box access lists. */
export async function dropFromTeamBoxAccess(teamId: string, userId: string): Promise<void> {
  await agentDevices().updateMany(
    { 'box.teamId': teamId, 'box.access.userIds': userId },
    { $pull: { 'box.access.userIds': userId } },
  )
}
