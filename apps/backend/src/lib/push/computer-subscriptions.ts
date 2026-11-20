import { db } from '@/lib/db'

/** Explicit personal subscriptions, independent of legacy phone registration defaults. */
const rows = () =>
  db().collection<{ _id: string; userId: string; deviceId: string }>('computer_alert_subscriptions')

export const computerSubscriptions = {
  async list(userId: string): Promise<string[]> {
    return (await rows().find({ userId }).toArray()).map((row) => row.deviceId)
  },
  async has(userId: string, deviceId: string): Promise<boolean> {
    return Boolean(await rows().findOne({ _id: JSON.stringify([userId, deviceId]) }))
  },
  async set(userId: string, deviceId: string, enabled: boolean): Promise<void> {
    const _id = JSON.stringify([userId, deviceId])

    if (enabled) await rows().updateOne({ _id }, { $set: { userId, deviceId } }, { upsert: true })
    else await rows().deleteOne({ _id })
  },
}
