export type ComposerDraft = {
  text: string
  filePaths: string[]
  folderPaths: string[]
}

type StoredDraft = ComposerDraft & { updatedAt: number }
type DraftStore = { owner: string | null; drafts: Record<string, StoredDraft> }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

const STORAGE_KEY = 'nuphos.agent.composerDrafts.v1'
const MAX_DRAFTS = 50
const MAX_TEXT_LENGTH = 100_000

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function read(storage: Storage | undefined): DraftStore {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as Partial<DraftStore> | null
    const drafts: Record<string, StoredDraft> = {}

    for (const [key, value] of Object.entries(parsed?.drafts ?? {})) {
      if (typeof value?.text !== 'string') continue
      drafts[key] = {
        text: value.text,
        filePaths: strings(value.filePaths),
        folderPaths: strings(value.folderPaths),
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
      }
    }

    return { owner: typeof parsed?.owner === 'string' ? parsed.owner : null, drafts }
  } catch {
    return { owner: null, drafts: {} }
  }
}

function write(storage: Storage | undefined, store: DraftStore): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Quota or blocked storage: a draft is a convenience, never an error.
  }
}

/** One draft per conversation, and one per team for the new-conversation composer. */
export function composerDraftKey(teamId: string | undefined, sessionId?: string): string {
  return `${teamId ?? 'no-team'}:${sessionId ?? 'new'}`
}

/** Bind drafts to the signed-in account; another account's drafts are dropped. */
export function claimComposerDrafts(userId: string, storage = defaultStorage()): void {
  const store = read(storage)

  if (store.owner === userId) return
  write(storage, { owner: userId, drafts: {} })
}

export function clearComposerDrafts(storage = defaultStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // Blocked storage has nothing to clear.
  }
}

export function loadComposerDraft(key: string, storage = defaultStorage()): ComposerDraft | null {
  const store = read(storage)

  if (!store.owner) return null
  const draft = store.drafts[key]

  return draft
    ? { text: draft.text, filePaths: draft.filePaths, folderPaths: draft.folderPaths }
    : null
}

/** An empty draft removes the entry, so a sent message never comes back. */
export function saveComposerDraft(
  key: string,
  draft: ComposerDraft,
  storage = defaultStorage(),
  now = Date.now(),
): void {
  const store = read(storage)

  if (!store.owner) return
  const drafts = { ...store.drafts }
  const empty = !draft.text.trim() && draft.filePaths.length === 0

  if (empty) {
    if (!(key in drafts)) return
    delete drafts[key]
  } else {
    drafts[key] = { ...draft, text: draft.text.slice(0, MAX_TEXT_LENGTH), updatedAt: now }
  }
  const kept = Object.entries(drafts)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_DRAFTS)

  write(storage, { owner: store.owner, drafts: Object.fromEntries(kept) })
}
