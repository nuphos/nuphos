// Updates started from this window, shared by every picker and settings card that shows them.
import { useSyncExternalStore } from 'react'

export type AgentUpdate = {
  /** `updating`: this computer's CLI is mid-update, or a team agent's update is queued or rolling out.
   *  `done` and `failed` are how an update started from this window ended. */
  state: 'available' | 'updating' | 'done' | 'failed'
  version?: string
  /** Starts the update; absent when it cannot be started from here. */
  start?: () => void
  /** Why it cannot be started from here, or why it failed. */
  reason?: string
}

type UpdateResult = { state: 'done' | 'failed'; version?: string; reason?: string }

/** How long "Updated" stays before the chip goes away. */
const DONE_MS = 6_000

/** Updates in flight from this window: `local:<provider>` or a team agent's id. */
let starting: ReadonlySet<string> = new Set()
/** How the last update from this window ended, by the same key; `failed` stays until retried. */
let results: ReadonlyMap<string, UpdateResult> = new Map()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function isStarting(key: string): boolean {
  return starting.has(key)
}

export function setStarting(key: string, on: boolean) {
  const next = new Set(starting)

  if (on) next.add(key)
  else next.delete(key)
  starting = next
  notify()
}

export function setResult(key: string, result: UpdateResult | null) {
  const next = new Map(results)

  if (result) next.set(key, result)
  else next.delete(key)
  results = next
  notify()
  if (result?.state === 'done')
    setTimeout(() => results.get(key) === result && setResult(key, null), DONE_MS)
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

export function useStarting(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => starting)
}

export function useResults(): ReadonlyMap<string, UpdateResult> {
  return useSyncExternalStore(subscribe, () => results)
}

/** The update in the row: in flight, just ended, or waiting to be started. */
export function withResult(
  key: string,
  busy: ReadonlySet<string>,
  ended: ReadonlyMap<string, UpdateResult>,
  pending: AgentUpdate | undefined,
): AgentUpdate | undefined {
  if (busy.has(key))
    return { state: 'updating', ...(pending?.version && { version: pending.version }) }
  const result = ended.get(key)

  if (result?.state === 'done') return result
  if (result?.state === 'failed' && pending?.start) return { ...pending, ...result }

  return pending
}
