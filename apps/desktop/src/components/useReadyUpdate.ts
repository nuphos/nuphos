import { useEffect, useRef, useState } from 'react'

import { api } from '../api'

import type { UpdaterState } from '../types'

/** The app updater's state, kept current by main. */
export function useUpdaterState(): UpdaterState {
  const [state, setState] = useState<UpdaterState>({ kind: 'idle' })
  const liveEventsRef = useRef(0)

  useEffect(() => {
    const off = api.onUpdaterStatus((next) => {
      liveEventsRef.current += 1
      setState(next)
    })
    const eventsBeforeSnapshot = liveEventsRef.current

    api
      .updaterGetState()
      .then((snapshot) => {
        // A live event that arrived first is newer than the snapshot.
        if (liveEventsRef.current === eventsBeforeSnapshot) setState(snapshot)
      })
      .catch(() => null)

    return off
  }, [])

  return state
}

/** The downloaded update waiting for a restart, or null. */
export function useReadyUpdate(): { version: string; install: () => void } | null {
  const state = useUpdaterState()

  if (state.kind !== 'ready') return null

  return { version: state.version, install: () => void api.updaterInstall() }
}
