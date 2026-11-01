import { db } from '@/lib/db'

import type { ApnsEnvironment } from './apns'
import type { Collection } from 'mongodb'

export type PushDevice = {
  userId: string
  token: string
  deviceId: string
  platform: 'ios' | 'android'
  environment: ApnsEnvironment
  bundleId?: string
  projectId?: string
  /** Lets the backend start the app's Live Activity (iOS). */
  liveActivityStartToken?: string
  /** When the backend last started a card whose token has not come back. */
  liveActivityStartedAt?: Date
  /** Conversations waiting for that card. */
  liveActivityPending?: PendingLiveActivityRow[]
  createdAt: Date
  updatedAt: Date
}

export type PendingLiveActivityRow = { sessionId: string; teamId: string; title: string }

export type PushDeviceRegistration = Pick<
  PushDevice,
  | 'token'
  | 'deviceId'
  | 'platform'
  | 'environment'
  | 'bundleId'
  | 'projectId'
  | 'liveActivityStartToken'
>

export type PushDeviceStore = {
  register: (userId: string, device: PushDeviceRegistration) => Promise<void>
  unregister: (userId: string, token: string) => Promise<void>
  listForUser: (userId: string) => Promise<PushDevice[]>
  removeToken: (token: string) => Promise<void>
}

const pushDevices = (): Collection<PushDevice> => db().collection<PushDevice>('push_devices')

export async function setupPushDeviceIndexes(): Promise<void> {
  const collection = pushDevices()

  await collection.createIndex({ token: 1 }, { unique: true, name: 'push_device_token_unique' })
  await collection.createIndex({ userId: 1, deviceId: 1 }, { name: 'push_device_user_device' })
}

export const pushDeviceStore: PushDeviceStore = {
  // Keyed by the APNs token, so a phone that changes hands between accounts
  // moves to the new user; a device's rotated token replaces its old one.
  async register(userId, device) {
    const now = new Date()

    await pushDevices().deleteMany({
      userId,
      deviceId: device.deviceId,
      token: { $ne: device.token },
    })
    await pushDevices().updateOne(
      { token: device.token },
      { $set: { ...device, userId, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    )
  },
  async unregister(userId, token) {
    await pushDevices().deleteOne({ userId, token })
  },
  async listForUser(userId) {
    return pushDevices().find({ userId }).toArray()
  },
  async removeToken(token) {
    await pushDevices().deleteOne({ token })
  },
}

// How long a started card may take to send its token before another is started.
const LIVE_ACTIVITY_START_WAIT_MS = 60_000

/** A phone gets one card started at a time: until that card's token comes
 *  back, a conversation that starts running waits for it instead of starting
 *  a second card, unless that token never came back. */
export async function beginLiveActivityStart(
  userId: string,
  deviceId: string,
  pending: PendingLiveActivityRow,
): Promise<boolean> {
  const since = new Date(Date.now() - LIVE_ACTIVITY_START_WAIT_MS)
  const started = await pushDevices().updateOne(
    {
      userId,
      deviceId,
      $or: [
        { liveActivityStartedAt: { $exists: false } },
        { liveActivityStartedAt: { $lt: since } },
      ],
    },
    { $set: { liveActivityStartedAt: new Date(), liveActivityPending: [pending] } },
  )

  if (started.modifiedCount > 0) return true
  await pushDevices().updateOne(
    { userId, deviceId, 'liveActivityPending.sessionId': { $ne: pending.sessionId } },
    { $push: { liveActivityPending: pending } },
  )

  return false
}

/** The started card's token came back: hands over the conversations waiting for it. */
export async function takeLiveActivityPending(
  userId: string,
  deviceId: string,
): Promise<PendingLiveActivityRow[]> {
  const before = await pushDevices().findOneAndUpdate(
    { userId, deviceId, liveActivityStartedAt: { $exists: true } },
    { $unset: { liveActivityStartedAt: '', liveActivityPending: '' } },
    { returnDocument: 'before' },
  )

  return before?.liveActivityPending ?? []
}
