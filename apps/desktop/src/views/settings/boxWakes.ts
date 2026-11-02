// The computers being woken from this window, by device id: a sign-in waiting for its agent
// (#1109's `/status?wake=1` loop) or the runtime picker's Resume, which asks the same way.
import { useSyncExternalStore } from 'react'

let waking: ReadonlyMap<string, number> = new Map()
const listeners = new Set<() => void>()

function set(next: ReadonlyMap<string, number>) {
  waking = next
  for (const listener of listeners) listener()
}

export const boxWakes = {
  /** Marks `deviceId` waking until the returned `end` runs; several wakes may overlap. */
  begin: (deviceId: string): (() => void) => {
    set(new Map(waking).set(deviceId, (waking.get(deviceId) ?? 0) + 1))
    let ended = false

    return () => {
      if (ended) return
      ended = true
      const next = new Map(waking)
      const count = (next.get(deviceId) ?? 1) - 1

      if (count > 0) next.set(deviceId, count)
      else next.delete(deviceId)
      set(next)
    }
  },
  isWaking: (deviceId: string) => waking.has(deviceId),
  subscribe: (listener: () => void) => {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },
  current: () => waking,
}

/** Every computer being woken from this window right now. */
export function useBoxWakes(): ReadonlyMap<string, number> {
  return useSyncExternalStore(boxWakes.subscribe, boxWakes.current)
}
