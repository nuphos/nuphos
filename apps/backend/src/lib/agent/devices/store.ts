import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'

import { mergeAgentRegistry, reportedAgents } from './agent-registry'

import type { RegisteredAgent } from './agent-registry'
import type { LocalRuntimeStatus, RemovableAgent } from './local-runtime/protocol'
import type { Collection } from 'mongodb'

/** A cloud machine Nuphos created for this device; absent for a person's own computer. Its state is never stored: instabox and presence know it. */
export type AgentDeviceBox = {
  provider: 'instabox'
  /** Set once the machine is ordered; a row without one is still being created. */
  sandboxId?: string
  /** Asset scope; independent of the host's transport owner. */
  teamId: string
  createdBy?: string
  access?: { everyone: boolean; userIds: string[] }
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
  /** Agents this computer has ever had signed in; see agent-registry. */
  agents?: RegisteredAgent[]
  /** sha256 of the credential a join token issued; absent for devices signed in as their owner. */
  credentialHash?: string
  credentialIssuedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export type AgentDeviceRegistration = Pick<
  AgentDevice,
  'deviceId' | 'label' | 'platform' | 'model' | 'allowLocalExec'
>

const agentDevices = (): Collection<AgentDevice> => db().collection<AgentDevice>('agent_devices')

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

/** A Box's device row exists from the moment the machine is ordered, so the UI can show it. */
export async function insertBoxAgentDevice(
  userId: string,
  device: AgentDeviceRegistration & { box: AgentDeviceBox },
): Promise<AgentDevice> {
  const now = new Date()
  const created: AgentDevice = {
    ...device,
    userId,
    box: { ...device.box, createdBy: userId, access: { everyone: false, userIds: [userId] } },
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

/** The team's Boxes still being ordered: instabox does not list their machines yet. */
export async function countTeamBoxesOrdering(teamId: string): Promise<number> {
  return agentDevices().countDocuments({
    'box.teamId': teamId,
    'box.sandboxId': { $exists: false },
  })
}

export async function deleteAgentDevice(userId: string, deviceId: string): Promise<boolean> {
  const result = await agentDevices().deleteOne({ userId, deviceId })

  return result.deletedCount > 0
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

/** Never infer a legacy Box's team from its owner. */
export async function listTeamBoxes(teamId: string): Promise<AgentDevice[]> {
  return agentDevices().find({ 'box.teamId': teamId }).toArray()
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

/** Keeps the agents a status report shows signed in listed after the computer goes offline. */
export async function recordDeviceAgents(
  userId: string,
  deviceId: string,
  status: LocalRuntimeStatus,
): Promise<void> {
  const device = await agentDevices().findOne({ userId, deviceId }, { projection: { agents: 1 } })

  if (!device) return
  const next = mergeAgentRegistry(device.agents ?? [], reportedAgents(status))

  if (next) await agentDevices().updateOne({ userId, deviceId }, { $set: { agents: next } })
}

export async function removeDeviceAgent(
  userId: string,
  deviceId: string,
  agent: RemovableAgent,
): Promise<void> {
  await agentDevices().updateOne(
    { userId, deviceId },
    {
      $pull: {
        agents:
          'instanceId' in agent
            ? { instanceId: agent.instanceId }
            : { provider: agent.provider, instanceId: { $exists: false } },
      },
    },
  )
}
