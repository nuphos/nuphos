import { useState } from 'react'

import { accessFor, accessMode } from './boxAccessPresentation'

import type { AccessMode } from './boxAccessPresentation'
import type { BoxAccess } from '../../api/device-types'

/** Who may use a Box, as the caller is choosing it: a mode, and the members picked for it. */
export function useBoxAccessChoice(initial?: BoxAccess) {
  const [mode, setMode] = useState<AccessMode>(() => accessMode(initial))
  const [chosen, setChosen] = useState(() => new Set(initial?.userIds ?? []))
  const toggle = (id: string) => {
    setChosen((previous) => {
      const next = new Set(previous)

      if (!next.delete(id)) next.add(id)

      return next
    })
  }

  return {
    mode,
    setMode,
    chosen,
    toggle,
    payload: () => accessFor(mode, chosen),
  }
}
