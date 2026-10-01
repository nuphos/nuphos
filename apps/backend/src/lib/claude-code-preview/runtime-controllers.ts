import { db } from '@/lib/db'

import type { OpenAbProvider } from './runtime-provider'

export const RUNTIME_CONTROLLER_STALE_MS = 24 * 60 * 60_000

type RuntimeController = {
  _id: string
  provider: OpenAbProvider
  namespace: string
  seenAt: Date
}
const runtimeControllers = () => db().collection<RuntimeController>('agent_runtime_controllers')
const controllerId = (provider: OpenAbProvider, namespace: string) => `${provider}:${namespace}`

export async function recordRuntimeController(
  namespace: string,
  provider: OpenAbProvider,
  now = new Date(),
) {
  await runtimeControllers().updateOne(
    { _id: controllerId(provider, namespace) },
    { $set: { provider, namespace, seenAt: now } },
    { upsert: true },
  )
}

export function placementNamespace(url: string): string | undefined {
  return /^wss?:\/\/[^./]+\.([^./]+)\.svc[:/]/.exec(url)?.[1]
}

/** A placement whose environment has stopped reconciling can never be deleted
 *  by its owner, so it must not hold the deletion open forever. */
export async function runtimeControllerGone(
  provider: OpenAbProvider,
  namespace: string,
  requestedAt: Date,
  now = new Date(),
): Promise<boolean> {
  const controller = await runtimeControllers().findOne({ _id: controllerId(provider, namespace) })
  const lastSeen = controller?.seenAt ?? requestedAt

  return now.getTime() - lastSeen.getTime() > RUNTIME_CONTROLLER_STALE_MS
}
