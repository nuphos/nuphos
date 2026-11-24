// What a person's computer that was forgotten keeps until it registers again: who signed its
// agents in, and the resets they still owe, so a sign-in that ended stays ended.
import { db } from '@/lib/db'

import type { AgentDevice } from './store'
import type { Collection } from 'mongodb'

type ForgottenDevice = Pick<AgentDevice, 'userId' | 'deviceId' | 'signIns' | 'pendingResets'>

const forgottenDevices = (): Collection<ForgottenDevice> =>
  db().collection<ForgottenDevice>('agent_devices_forgotten')

export async function setupForgottenDeviceIndexes(): Promise<void> {
  await forgottenDevices().createIndex(
    { userId: 1, deviceId: 1 },
    { unique: true, name: 'agent_device_forgotten_user_device_unique' },
  )
}

/** Keeps them for a computer just forgotten, if any; a Box's go with it. False with none. */
export async function keep(device: AgentDevice | null): Promise<boolean> {
  if (!device) return false
  const { userId, deviceId, box, signIns = [], pendingResets = [] } = device

  if (!box && (signIns.length || pendingResets.length))
    await forgottenDevices().replaceOne(
      { userId, deviceId },
      { userId, deviceId, signIns, pendingResets },
      { upsert: true },
    )

  return true
}

/** What a computer registering again kept when it was forgotten, if anything. */
export async function kept(userId: string, deviceId: string) {
  const found = await forgottenDevices().findOne(
    { userId, deviceId },
    { projection: { _id: 0, signIns: 1, pendingResets: 1 } },
  )

  return found ?? {}
}

/** Once it registered again with them. */
export async function drop(userId: string, deviceId: string): Promise<void> {
  await forgottenDevices().deleteOne({ userId, deviceId })
}
