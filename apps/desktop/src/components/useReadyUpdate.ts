import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { updateProgress } from '../views/settings/updateProgress'

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

/** The update a restart installs, or null. After the click, the restart checks for
 * a newer release and downloads it first; `percent` is set while it does. */
export function useReadyUpdate(): {
  version: string
  percent: number | null
  install: () => void
} | null {
  const state = useUpdaterState()
  const [clicked, setClicked] = useState<string | null>(null)
  // Main ignores a click unless an update is ready.
  const install = () => {
    if (state.kind === 'ready') setClicked(state.version)
    void api.updaterInstall()
  }

  if (state.kind === 'ready') return { version: state.version, percent: null, install }
  if (!clicked) return null
  if (state.kind === 'checking') return { version: clicked, percent: 0, install }
  if (state.kind === 'downloading') {
    return { version: state.version, percent: updateProgress(state)?.percent ?? 0, install }
  }

  return null
}
