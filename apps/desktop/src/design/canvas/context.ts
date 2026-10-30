import { createContext, useContext } from 'react'

import type { DesignObject, FramePreset } from '../schema'

/** What a node on the canvas can do to the design it is part of. */
export type DesignCanvasActions = {
  /** The object being text-edited, and the frame whose page has the pointer. */
  editingId: string | null
  interactiveId: string | null
  updateObject: (
    id: string,
    patch: (current: DesignObject) => DesignObject,
    options?: { record?: boolean },
  ) => void
  startEditing: (id: string | null) => void
  setInteractive: (id: string | null) => void
  setFramePreset: (id: string, preset: FramePreset) => void
  play: (frameId: string) => void
  download: (frameId: string) => void
}

export const DesignCanvasContext = createContext<DesignCanvasActions | null>(null)

export function useDesignCanvas(): DesignCanvasActions {
  const value = useContext(DesignCanvasContext)

  if (!value) throw new Error('useDesignCanvas needs a DesignCanvasContext')

  return value
}
