import { db } from '@/lib/db'

import type { OpenAbProvider } from './runtime-provider'
import type { Collection, ObjectId } from 'mongodb'

export const RUNTIME_IMAGE_EVENTS_COLLECTION = 'runtime_image_change_events'

/** An administrator repointing a runtime at another image, from when each chose its own. */
export type RuntimeImageChangeEvent = {
  _id?: ObjectId
  teamId: string
  runtimeId: string
  provider: OpenAbProvider
  runtimeLabel: string
  actorUserId: string | null
  fromImage: string | null
  toImage: string
  createdAt: Date
}

export const runtimeImageEvents = (): Collection<RuntimeImageChangeEvent> =>
  db().collection<RuntimeImageChangeEvent>(RUNTIME_IMAGE_EVENTS_COLLECTION)

export async function setupRuntimeImageAuditIndexes(): Promise<void> {
  await runtimeImageEvents().createIndex(
    { teamId: 1, createdAt: -1 },
    { background: true, name: 'runtime_image_events_team_createdAt' },
  )
  await runtimeImageEvents().createIndex(
    { actorUserId: 1, createdAt: -1 },
    { background: true, name: 'runtime_image_events_actor_createdAt' },
  )
}

export function runtimeImageAuditEvent(doc: RuntimeImageChangeEvent) {
  const key = doc._id?.toHexString() ?? [doc.runtimeId, doc.createdAt.toISOString()].join(':')

  return {
    kind: 'runtime_image' as const,
    eventId: `runtime_image:${key}`,
    ts: doc.createdAt.toISOString(),
    type: 'runtime_image_change' as const,
    actor: { userId: doc.actorUserId, teamId: doc.teamId },
    resource: {
      kind: 'runtime' as const,
      runtimeId: doc.runtimeId,
      provider: doc.provider,
      label: doc.runtimeLabel,
    },
    change: { fromImage: doc.fromImage, toImage: doc.toImage },
  }
}
