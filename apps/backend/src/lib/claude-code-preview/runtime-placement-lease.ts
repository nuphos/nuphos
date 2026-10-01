import { randomUUID } from 'node:crypto'

import { db } from '@/lib/db'

import type { KubeClient } from './kube-client'

/** Serialize provisioning and destruction across backend replicas. All Kubernetes
 * mutations recheck ownership; a stalled worker cannot resume deleting resources
 * after another replica acquired the expired lease. */
export async function withRuntimePlacementLease<T>(
  teamId: string,
  placementId: string,
  kube: KubeClient,
  operation: (guarded: KubeClient) => Promise<T>,
): Promise<T | undefined> {
  const collection = db().collection<{
    _id: string
    teamId: string
    token: string
    expiresAt: Date
  }>('agent_runtime_placement_leases')
  const token = randomUUID()
  const _id = `${teamId}:${placementId}`
  const expiresAt = () => new Date(Date.now() + 5 * 60_000)

  try {
    const lease = await collection.findOneAndUpdate(
      { _id, expiresAt: { $lte: new Date() } },
      { $set: { teamId, token, expiresAt: expiresAt() } },
      { upsert: true, returnDocument: 'after' },
    )

    if (lease?.token !== token) return undefined
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)
      return undefined
    throw error
  }
  let lost = false
  let renewing = false
  const timer = setInterval(() => {
    if (renewing || lost) return
    renewing = true
    void collection
      .updateOne(
        { _id, token, expiresAt: { $gt: new Date() } },
        { $set: { expiresAt: expiresAt() } },
      )
      .then((result) => {
        if (!result.matchedCount) lost = true
      })
      .catch(() => {
        lost = true
      })
      .finally(() => {
        renewing = false
      })
  }, 60_000)
  const assertOwned = async () => {
    if (lost || !(await collection.findOne({ _id, token, expiresAt: { $gt: new Date() } })))
      throw new Error('Runtime operation lease expired. Retry safely.')
  }
  const guarded: KubeClient = {
    ...kube,
    apply: async (...args) => {
      await assertOwned()

      return kube.apply(...args)
    },
    createIfAbsent: async (...args) => {
      await assertOwned()

      return kube.createIfAbsent(...args)
    },
    delete: async (...args) => {
      await assertOwned()

      return kube.delete(...args)
    },
  }

  try {
    return await operation(guarded)
  } finally {
    clearInterval(timer)
    await collection.deleteOne({ _id, token })
  }
}
