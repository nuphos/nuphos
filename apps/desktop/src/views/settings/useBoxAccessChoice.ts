import { useRef, useState } from 'react'

import { accessFor, accessMode } from './boxAccessPresentation'

import type { AccessMode } from './boxAccessPresentation'
import type { BoxAccess } from '../../api/device-types'

/** Who may use a Box, as the caller is choosing it: a mode, and the members picked for it. */
export function useBoxAccessChoice(initial?: BoxAccess) {
  const [mode, setMode] = useState<AccessMode>(() => accessMode(initial))
  const [chosen, setChosen] = useState(() => new Set(initial?.userIds ?? []))
  // Once the caller has chosen, the members arriving no longer change the mode.
  const touched = useRef(false)
  const toggle = (id: string) => {
    touched.current = true
    setChosen((previous) => {
      const next = new Set(previous)

      if (!next.delete(id)) next.add(id)

      return next
    })
  }

  return {
    mode,
    setMode: (next: AccessMode) => {
      touched.current = true
      setMode(next)
    },
    chosen,
    toggle,
    /** Once the members are known: a list naming only admins means admins only. */
    settle: (nonAdminIds: Set<string>) => {
      if (initial && !touched.current) setMode(accessMode(initial, nonAdminIds))
    },
    payload: () => accessFor(mode, chosen),
  }
}
