import { useEffect, useRef, useState } from 'react'

import { api } from '../api'

import { toast } from './ui/toast'

import type { UpdaterState } from '../types'

// ---- dev-only console trigger -------------------------------------------
// A module-level fan-out so the devtools helper below can push a synthetic
// updater state straight into the mounted useReadyUpdate(). `null` clears
// the override and reverts to the real updater channel. In production the
// listener set stays empty (the registration block is stripped), so this is a
// no-op.
type DevListener = (state: UpdaterState | null) => void
const devListeners = new Set<DevListener>()

function emitDevState(state: UpdaterState | null) {
  for (const listener of devListeners) listener(state)
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  // Trigger the update chip straight from the devtools console:
  //   updateNotify('downloaded', '1.2.3')  // show the chip
  //   updateNotify()  // or updateNotify(null) — clear the override
  // Other kinds are accepted for completeness but render nothing.
  const updateNotify = (kind?: UpdaterState['kind'] | null, arg?: string | number) => {
    if (kind == null) {
      emitDevState(null)

      return
    }
    switch (kind) {
      case 'available':
        emitDevState({ kind, version: String(arg ?? '0.0.0') })
        break
      case 'downloading':
        emitDevState({ kind, percent: Number(arg ?? 0) })
        break
      case 'downloaded':
        emitDevState({ kind, version: String(arg ?? '0.0.0') })
        break
      case 'error':
        emitDevState({ kind, message: String(arg ?? 'dev error') })
        break
      case 'idle':
      case 'checking':
      case 'not-available':
        emitDevState({ kind })
        break
    }
  }

  ;(window as unknown as { updateNotify: typeof updateNotify }).updateNotify = updateNotify
}

/**
 * The version of an update that finished downloading in the background, or
 * null. Earlier updater phases are deliberately invisible.
 */
export function useReadyUpdate(): { version: string; install: () => void } | null {
  const [liveState, setLiveState] = useState<UpdaterState>({ kind: 'idle' })
  const [devState, setDevState] = useState<UpdaterState | null>(null)
  const liveEventTokenRef = useRef(0)

  useEffect(() => {
    const off = api.onUpdaterStatus((next) => {
      liveEventTokenRef.current += 1
      setLiveState(next)
    })
    const snapshotToken = liveEventTokenRef.current

    api
      .updaterGetState()
      .then((snapshot) => {
        if (snapshotToken === liveEventTokenRef.current) setLiveState(snapshot)
      })
      .catch(() => undefined)

    return off
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const listener: DevListener = (state) => setDevState(state)

    devListeners.add(listener)

    return () => {
      devListeners.delete(listener)
    }
  }, [])

  const state = devState ?? liveState

  if (state.kind !== 'downloaded') return null

  return {
    version: state.version,
    install: () => {
      void api.updaterInstall().catch(() => {
        toast.error('Update failed', 'Could not install the update. Please try again.')
      })
    },
  }
}
