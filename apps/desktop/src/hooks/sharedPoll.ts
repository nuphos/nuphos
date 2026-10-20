/**
 * One poll per key, however many components watch it. Every open agent panel
 * reads the same team's agents and usage; polling each from its own hook sent
 * one request per panel per tick, and a slow network piled them up because a
 * tick never waited for the last one. Here a key loads at most once at a
 * time, a refresh asked for meanwhile runs once after it, ticks are skipped
 * while the window is hidden, and the timer stops with its last watcher.
 */
export type PollSnapshot<T> = { value?: T; failed: boolean; settled: boolean }

type Entry = {
  load: () => Promise<unknown>
  snapshot: PollSnapshot<unknown>
  listeners: Set<() => void>
  timer?: ReturnType<typeof setInterval>
  inFlight: boolean
  again: boolean
}

const entries = new Map<string, Entry>()
const UNSETTLED: PollSnapshot<never> = { failed: false, settled: false }

export function refreshPoll(key: string): void {
  const entry = entries.get(key)

  // A key nobody watches is not loaded; its next watcher loads it.
  if (!entry?.listeners.size) return
  if (entry.inFlight) {
    entry.again = true

    return
  }
  entry.inFlight = true
  void entry
    .load()
    .then(
      (value) => {
        entry.snapshot = { value, failed: false, settled: true }
      },
      () => {
        entry.snapshot = { ...entry.snapshot, failed: true, settled: true }
      },
    )
    .finally(() => {
      entry.inFlight = false
      for (const listener of entry.listeners) listener()
      if (entry.again) {
        entry.again = false
        refreshPoll(key)
      }
    })
}

/** Watch `key`; the first watcher starts the poll, the last one stops it. */
export function subscribePoll(
  key: string,
  load: () => Promise<unknown>,
  everyMs: number,
  listener: () => void,
): () => void {
  let entry = entries.get(key)

  if (!entry) {
    entry = { load, snapshot: UNSETTLED, listeners: new Set(), inFlight: false, again: false }
    entries.set(key, entry)
  }
  const watched = entry

  watched.listeners.add(listener)
  if (watched.listeners.size === 1) {
    watched.load = load
    watched.timer = setInterval(() => {
      if (!(typeof document !== 'undefined' && document.hidden)) refreshPoll(key)
    }, everyMs)
    refreshPoll(key)
  }

  return () => {
    watched.listeners.delete(listener)
    if (watched.listeners.size === 0) clearInterval(watched.timer)
  }
}

export function pollSnapshot<T>(key: string | undefined): PollSnapshot<T> {
  return ((key ? entries.get(key)?.snapshot : undefined) ?? UNSETTLED) as PollSnapshot<T>
}
