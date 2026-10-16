import { parseAtlasError } from '../api.ts'

export const MAX_CONFLICT_RETRIES = 8
export const MAX_RETRY_DELAY_MS = 60_000

export type DocumentSyncMeta<Op> = { migrated: boolean; revision: number; pending: Op[] }

/**
 * One person's revisioned sidebar list in one team (favorites, projects): the cached
 * list, the queue of local operations not yet saved, and the server calls.
 */
export type DocumentSyncSpec<Item, Op extends { id: string }> = {
  conflictCode: string
  readItems: (userId: string, teamId: string) => Item[]
  writeItems: (userId: string, teamId: string, items: Item[]) => void
  readMeta: (userId: string, teamId: string) => DocumentSyncMeta<Op>
  writeMeta: (userId: string, teamId: string, meta: DocumentSyncMeta<Op>) => void
  notify: (userId: string, teamId: string) => void
  get: (teamId: string) => Promise<{ items: Item[]; revision: number }>
  put: (
    teamId: string,
    items: Item[],
    revision: number,
  ) => Promise<{ items: Item[]; revision: number }>
  apply: (items: Item[], operations: Op[]) => Item[]
  /** The first sync of a list that predates server storage: combine the two. */
  merge?: (remote: Item[], local: Item[]) => Item[]
}

type Runtime = {
  running: Promise<void> | null
  retryAttempt: number
  retryTimer: ReturnType<typeof setTimeout> | null
}

const NOT_RETRYABLE = [
  'forbidden',
  'invalid_id',
  'validation_error',
  'route_not_found',
  'subscription_required',
]

/**
 * Operations are persisted and replayed on top of whatever the server holds, so an
 * edit survives a reload, a conflict, or being offline, and an older response can
 * never overwrite newer intent. Failures retry with backoff.
 */
export function createDocumentSync<Item, Op extends { id: string }>(
  spec: DocumentSyncSpec<Item, Op>,
) {
  const runtimes = new Map<string, Runtime>()

  function commit(
    userId: string,
    teamId: string,
    snapshot: { items: Item[]; revision: number },
    captured: Set<string>,
  ) {
    const latest = spec.readMeta(userId, teamId)
    const remaining = latest.pending.filter((operation) => !captured.has(operation.id))

    spec.writeMeta(userId, teamId, {
      migrated: true,
      revision: snapshot.revision,
      pending: remaining,
    })
    // Operations queued while the request was in flight are replayed on the result.
    spec.writeItems(userId, teamId, spec.apply(snapshot.items, remaining))
    spec.notify(userId, teamId)
  }

  async function reconcileOnce(userId: string, teamId: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt += 1) {
      const remote = await spec.get(teamId)
      const meta = spec.readMeta(userId, teamId)
      const captured = meta.pending
      const capturedIds = new Set(captured.map((operation) => operation.id))
      const base =
        meta.migrated || !spec.merge
          ? remote.items
          : spec.merge(remote.items, spec.readItems(userId, teamId))
      const desired = spec.apply(base, captured)

      if (JSON.stringify(desired) === JSON.stringify(remote.items)) {
        commit(userId, teamId, remote, capturedIds)

        return
      }
      try {
        commit(userId, teamId, await spec.put(teamId, desired, remote.revision), capturedIds)

        return
      } catch (error) {
        if (parseAtlasError(error).code === spec.conflictCode) continue
        throw error
      }
    }

    throw new Error('The list kept changing concurrently')
  }

  function runtimeFor(userId: string, teamId: string): Runtime {
    const key = `${encodeURIComponent(userId)}|${encodeURIComponent(teamId)}`
    let runtime = runtimes.get(key)

    if (!runtime) {
      runtime = { running: null, retryAttempt: 0, retryTimer: null }
      runtimes.set(key, runtime)
    }

    return runtime
  }

  function scheduleRetry(userId: string, teamId: string, runtime: Runtime): void {
    if (runtime.retryTimer) return
    const delay = Math.min(1000 * 2 ** runtime.retryAttempt, MAX_RETRY_DELAY_MS)

    runtime.retryAttempt += 1
    runtime.retryTimer = setTimeout(() => {
      runtime.retryTimer = null
      void sync(userId, teamId)
    }, delay)
  }

  /** Reconciles with the server; one run at a time per person and team. */
  function sync(userId: string, teamId: string): Promise<void> {
    if (!userId || !teamId) return Promise.resolve()
    const runtime = runtimeFor(userId, teamId)

    if (runtime.running) return runtime.running
    if (runtime.retryTimer) {
      clearTimeout(runtime.retryTimer)
      runtime.retryTimer = null
    }
    let failed = false

    runtime.running = reconcileOnce(userId, teamId)
      .then(() => {
        runtime.retryAttempt = 0
      })
      .catch((error: unknown) => {
        failed = true
        if (!NOT_RETRYABLE.includes(parseAtlasError(error).code ?? '')) {
          scheduleRetry(userId, teamId, runtime)
        }
      })
      .finally(() => {
        runtime.running = null
        if (!failed && spec.readMeta(userId, teamId).pending.length > 0) void sync(userId, teamId)
      })

    return runtime.running
  }

  /** Records an operation already applied to the cached list, then saves it. */
  function enqueue(userId: string, teamId: string, operation: Op): void {
    const meta = spec.readMeta(userId, teamId)

    spec.writeMeta(userId, teamId, { ...meta, pending: [...meta.pending, operation] })
    void sync(userId, teamId)
  }

  return { sync, enqueue }
}
