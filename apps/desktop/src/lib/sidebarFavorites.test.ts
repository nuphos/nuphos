import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addSidebarFavorite,
  applyFavoriteOperations,
  favoriteIdentity,
  mergeFavoriteLists,
  readSidebarFavorites,
  syncSidebarFavorites,
} from './sidebarFavorites.ts'

import type { SidebarFavorite } from './sidebarFavorites.ts'

type Snapshot = { entries: SidebarFavorite[]; revision: number; updatedAt: string | null }

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const storage = new MemoryStorage()
const remote = new Map<string, Snapshot>()
let getFavoriteSnapshot: (teamId: string) => Promise<Snapshot>
let putFavoriteSnapshot: (
  teamId: string,
  entries: SidebarFavorite[],
  expectedRevision: number,
) => Promise<Snapshot>

const rendererWindow = Object.assign(new EventTarget(), {
  api: {
    atlasGetSidebarFavorites: (teamId: string) => getFavoriteSnapshot(teamId),
    atlasPutSidebarFavorites: (
      teamId: string,
      entries: SidebarFavorite[],
      expectedRevision: number,
    ) => putFavoriteSnapshot(teamId, entries, expectedRevision),
  },
})

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
Object.defineProperty(globalThis, 'window', { configurable: true, value: rendererWindow })

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return structuredClone(snapshot)
}

function installCloud(): void {
  getFavoriteSnapshot = async (teamId) =>
    cloneSnapshot(remote.get(teamId) ?? { entries: [], revision: 0, updatedAt: null })
  putFavoriteSnapshot = async (teamId, entries, expectedRevision) => {
    const current = remote.get(teamId) ?? { entries: [], revision: 0, updatedAt: null }

    if (current.revision !== expectedRevision) {
      throw new Error(
        `__ATLAS_API_ERROR__${JSON.stringify({
          message: 'changed',
          code: 'sidebar_favorites_changed',
        })}`,
      )
    }
    const saved = {
      entries: structuredClone(entries),
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    }

    remote.set(teamId, saved)

    return cloneSnapshot(saved)
  }
}

function reset(): void {
  storage.clear()
  remote.clear()
  installCloud()
}

test('operation replay is deterministic and migration merge preserves both sides', () => {
  const cloud = [{ label: 'Cloud', key: 'cloud' }]
  const local = [
    { label: 'Local label loses to cloud', key: 'cloud' },
    { label: 'Local only', href: '/local' },
  ]
  const merged = mergeFavoriteLists(cloud, local)

  assert.deepEqual(merged, [cloud[0], local[1]])
  assert.deepEqual(
    applyFavoriteOperations(merged, [
      { id: '1', kind: 'remove', identity: favoriteIdentity(cloud[0]) },
      { id: '2', kind: 'upsert', favorite: { label: 'New', key: 'new' } },
    ]),
    [local[1], { label: 'New', key: 'new' }],
  )
})

test('first sync discards ownerless legacy cache and keeps cloud favorites', async () => {
  reset()
  const teamId = 'migration-team'

  storage.setItem(
    'nuphos.sidebarFavorites',
    JSON.stringify({ [teamId]: [{ label: 'Local', key: 'local' }] }),
  )
  remote.set(teamId, {
    entries: [{ label: 'Cloud', key: 'cloud' }],
    revision: 1,
    updatedAt: null,
  })

  assert.deepEqual(readSidebarFavorites('user-a', teamId), [])
  assert.equal(storage.getItem('nuphos.sidebarFavorites'), null)
  await syncSidebarFavorites('user-a', teamId)

  assert.deepEqual(readSidebarFavorites('user-a', teamId), [{ label: 'Cloud', key: 'cloud' }])
  assert.deepEqual(remote.get(teamId)?.entries, readSidebarFavorites('user-a', teamId))
  assert.deepEqual(readSidebarFavorites('user-b', teamId), [])
})

test('add is immediately visible locally and eventually persists remotely', async () => {
  reset()
  const teamId = 'optimistic-team'
  const favorite = { label: 'Pods', key: 'workloads.pods' }

  assert.equal(addSidebarFavorite('user-a', teamId, favorite), true)
  assert.deepEqual(readSidebarFavorites('user-a', teamId), [favorite])
  await syncSidebarFavorites('user-a', teamId)

  assert.deepEqual(remote.get(teamId)?.entries, [favorite])
})

test('a response in flight cannot overwrite a newer optimistic mutation', async () => {
  reset()
  const teamId = 'stale-response-team'
  let releaseFirstPut: (() => void) | null = null
  const firstPutStarted = new Promise<void>((resolveStarted) => {
    putFavoriteSnapshot = async (id, entries, expectedRevision) => {
      resolveStarted()
      await new Promise<void>((resolve) => {
        releaseFirstPut = resolve
      })
      const saved = {
        entries: structuredClone(entries),
        revision: expectedRevision + 1,
        updatedAt: null,
      }

      remote.set(id, saved)
      installCloud()

      return cloneSnapshot(saved)
    }
  })

  addSidebarFavorite('user-a', teamId, { label: 'A', key: 'a' })
  await firstPutStarted
  addSidebarFavorite('user-a', teamId, { label: 'B', key: 'b' })
  assert.deepEqual(readSidebarFavorites('user-a', teamId), [
    { label: 'A', key: 'a' },
    { label: 'B', key: 'b' },
  ])
  releaseFirstPut?.()
  await syncSidebarFavorites('user-a', teamId)
  await syncSidebarFavorites('user-a', teamId)

  assert.deepEqual(readSidebarFavorites('user-a', teamId), [
    { label: 'A', key: 'a' },
    { label: 'B', key: 'b' },
  ])
  assert.deepEqual(remote.get(teamId)?.entries, readSidebarFavorites('user-a', teamId))
})

test('CAS conflict fetches the winner and replays local intent', async () => {
  reset()
  const teamId = 'conflict-team'
  let conflicted = false
  const regularPut = putFavoriteSnapshot

  putFavoriteSnapshot = async (id, entries, expectedRevision) => {
    if (!conflicted) {
      conflicted = true
      remote.set(id, {
        entries: [{ label: 'Other device', key: 'other' }],
        revision: 1,
        updatedAt: null,
      })
      throw new Error('__ATLAS_API_ERROR__{"message":"changed","code":"sidebar_favorites_changed"}')
    }

    return regularPut(id, entries, expectedRevision)
  }

  addSidebarFavorite('user-a', teamId, { label: 'This device', key: 'local' })
  await syncSidebarFavorites('user-a', teamId)

  assert.deepEqual(remote.get(teamId)?.entries, [
    { label: 'Other device', key: 'other' },
    { label: 'This device', key: 'local' },
  ])
})
