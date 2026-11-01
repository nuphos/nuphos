// Questions the user cleared from the "Replying to" chip, per conversation, so a
// reload or switching chats does not silently re-arm it. Kept like composer
// drafts: bound to the signed-in account, keyed by composerDraftKey (team and
// conversation), and capped.

type StoredCleared = { ids: string[]; updatedAt: number }
type ClearedStore = { owner: string | null; cleared: Record<string, StoredCleared> }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

const STORAGE_KEY = 'nuphos.agent.clearedReplies.v1'
const MAX_CONVERSATIONS = 50

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function read(storage: Storage | undefined): ClearedStore {
  try {
    const parsed = JSON.parse(
      storage?.getItem(STORAGE_KEY) ?? 'null',
    ) as Partial<ClearedStore> | null
    const cleared: Record<string, StoredCleared> = {}

    for (const [key, value] of Object.entries(parsed?.cleared ?? {})) {
      if (!Array.isArray(value?.ids)) continue
      cleared[key] = {
        ids: value.ids.filter((id): id is string => typeof id === 'string'),
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
      }
    }

    return { owner: typeof parsed?.owner === 'string' ? parsed.owner : null, cleared }
  } catch {
    return { owner: null, cleared: {} }
  }
}

function write(storage: Storage | undefined, store: ClearedStore): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Quota or blocked storage: the chip then just re-arms after a reload.
  }
}

/** Bind cleared questions to the signed-in account; another account's are dropped. */
export function claimClearedReplies(userId: string, storage = defaultStorage()): void {
  if (read(storage).owner === userId) return
  write(storage, { owner: userId, cleared: {} })
}

export function clearClearedReplies(storage = defaultStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // Blocked storage has nothing to clear.
  }
}

export function loadClearedReplies(key: string, storage = defaultStorage()): string[] {
  const store = read(storage)

  return store.owner ? (store.cleared[key]?.ids ?? []) : []
}

/** An empty list removes the conversation; the most recently changed ones are kept. */
export function saveClearedReplies(
  key: string,
  ids: readonly string[],
  storage = defaultStorage(),
  now = Date.now(),
): void {
  const store = read(storage)

  if (!store.owner) return
  const cleared = { ...store.cleared }

  if (ids.length === 0) {
    if (!(key in cleared)) return
    delete cleared[key]
  } else {
    cleared[key] = { ids: [...ids], updatedAt: now }
  }
  const kept = Object.entries(cleared)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS)

  write(storage, { owner: store.owner, cleared: Object.fromEntries(kept) })
}
