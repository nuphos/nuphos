import { db } from '@/lib/db'

import type { ApnsEnvironment } from './apns'
import type { Collection } from 'mongodb'

export type PushDevice = {
  userId: string
  token: string
  deviceId: string
  platform: 'ios'
  environment: ApnsEnvironment
  bundleId?: string
  createdAt: Date
  updatedAt: Date
}

export type PushDeviceRegistration = Pick<
  PushDevice,
  'token' | 'deviceId' | 'platform' | 'environment' | 'bundleId'
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
