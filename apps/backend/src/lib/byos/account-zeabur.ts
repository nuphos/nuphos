import { decryptZeaburToken } from '@/lib/byos/secrets'
import { discoverZeaburIdentities } from '@/lib/byos/zeabur'
import { teamByosBindings } from '@/models'

import type { ZeaburProviderBinding } from '@/models'
import type { ObjectId } from 'mongodb'

export async function findZeaburProvider(
  teamId: ObjectId,
  providerId: ObjectId,
): Promise<ZeaburProviderBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { zeaburProviders: 1 } },
  )

  return (doc?.zeaburProviders ?? []).find((b) => b.id.equals(providerId)) ?? null
}

export async function findZeaburProviderByZeaburId(
  teamId: ObjectId,
  zeaburId: string,
): Promise<ZeaburProviderBinding | null> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { zeaburProviders: 1 } },
  )

  return (
    (doc?.zeaburProviders ?? []).find((binding) =>
      binding.identities?.some((identity) => identity.zeaburId === zeaburId),
    ) ?? null
  )
}

export async function listZeaburProviderBindings(
  teamId: ObjectId,
): Promise<ZeaburProviderBinding[]> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { zeaburProviders: 1 } },
  )

  return doc?.zeaburProviders ?? []
}

function zeaburIdentitiesEqual(
  a: ZeaburProviderBinding['identities'],
  b: ZeaburProviderBinding['identities'],
): boolean {
  if (a.length !== b.length) return false

  return a.every((identity, index) => {
    const other = b[index]

    return (
      other &&
      identity.zeaburId === other.zeaburId &&
      identity.kind === other.kind &&
      identity.name === other.name
    )
  })
}

export async function syncZeaburProviderBindings(
  teamId: ObjectId,
  options: { minIntervalMs?: number; fallbackOnError?: boolean } = {},
): Promise<ZeaburProviderBinding[]> {
  const bindings = await listZeaburProviderBindings(teamId)

  if (bindings.length === 0) return []

  const now = new Date()
  let changed = false
  const synced = await Promise.all(
    bindings.map(async (binding) => {
      if (
        options.minIntervalMs &&
        binding.lastSyncedAt &&
        now.getTime() - binding.lastSyncedAt.getTime() < options.minIntervalMs
      ) {
        return binding
      }
      let identities: ZeaburProviderBinding['identities']

      try {
        identities = await discoverZeaburIdentities(decryptZeaburToken(binding.encryptedToken))
      } catch (err) {
        if (options.fallbackOnError) return binding
        throw err
      }
      if (!zeaburIdentitiesEqual(binding.identities ?? [], identities)) {
        changed = true
      }
      if (options.minIntervalMs) {
        changed = true
      }

      return { ...binding, identities, lastSyncedAt: now }
    }),
  )

  if (changed) {
    await teamByosBindings().updateOne(
      { _id: teamId },
      { $set: { zeaburProviders: synced, updatedAt: new Date() } },
    )
  }

  return synced
}
