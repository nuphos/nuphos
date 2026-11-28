import { useEffect, useSyncExternalStore } from 'react'

import { api } from '../../../api'

import type { LocalAgentProvider } from '../../../api'

/**
 * Where local runtimes are off (a development build signed in to Nuphos Cloud),
 * a read-only look for their tools still says which are on this computer. It
 * starts and registers nothing, so the installed app keeps its connection.
 */
let scanned: LocalAgentProvider[] | null = null
let pending: Promise<void> | null = null
const listeners = new Set<() => void>()

export function rescanRuntimes(): Promise<void> {
  pending ??= api.localRuntimeFindInstalled().then(
    (found) => {
      scanned = found
      pending = null
      for (const listener of listeners) listener()
    },
    () => {
      pending = null
    },
  )

  return pending
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

/** The tools found on this computer, once `enabled`; null until the look has answered. */
export function useScannedRuntimes(enabled: boolean): readonly LocalAgentProvider[] | null {
  const value = useSyncExternalStore(subscribe, () => scanned)

  useEffect(() => {
    if (enabled && !scanned) void rescanRuntimes()
  }, [enabled])

  return enabled ? value : null
}
