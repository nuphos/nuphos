import { useCallback, useMemo, useRef, useState } from 'react'

import type { Design, DesignPage } from '../schema'
import type { Dispatch, RefObject, SetStateAction } from 'react'

const LIMIT = 100

/** Undo/redo over the pages; the name and the rest of the document are not history. */
export function useDesignHistory(
  designRef: RefObject<Design>,
  setDesign: Dispatch<SetStateAction<Design>>,
) {
  // The stacks live in refs so no state updater has to reach into another;
  // the two booleans are what the toolbar renders.
  const pastRef = useRef<DesignPage[][]>([])
  const futureRef = useRef<DesignPage[][]>([])
  const [depth, setDepth] = useState({ canUndo: false, canRedo: false })
  // A drag or draw records once at its start, not on every move.
  const pendingRef = useRef<DesignPage[] | null>(null)

  const sync = useCallback(() => {
    setDepth({ canUndo: pastRef.current.length > 0, canRedo: futureRef.current.length > 0 })
  }, [])

  const push = useCallback(
    (snapshot: DesignPage[]) => {
      pastRef.current = [...pastRef.current, snapshot].slice(-LIMIT)
      futureRef.current = []
      sync()
    },
    [sync],
  )

  const record = useCallback(() => push(designRef.current.pages), [designRef, push])

  const begin = useCallback(() => {
    pendingRef.current = designRef.current.pages
  }, [designRef])

  const commit = useCallback(() => {
    const snapshot = pendingRef.current

    pendingRef.current = null
    if (snapshot && snapshot !== designRef.current.pages) push(snapshot)
  }, [designRef, push])

  const undo = useCallback(() => {
    const prev = pastRef.current.at(-1)

    if (!prev) return
    pastRef.current = pastRef.current.slice(0, -1)
    futureRef.current = [designRef.current.pages, ...futureRef.current]
    setDesign((d) => ({ ...d, pages: prev }))
    sync()
  }, [designRef, setDesign, sync])

  const redo = useCallback(() => {
    const next = futureRef.current[0]

    if (!next) return
    futureRef.current = futureRef.current.slice(1)
    pastRef.current = [...pastRef.current, designRef.current.pages]
    setDesign((d) => ({ ...d, pages: next }))
    sync()
  }, [designRef, setDesign, sync])

  return useMemo(
    () => ({ ...depth, record, begin, commit, undo, redo }),
    [depth, record, begin, commit, undo, redo],
  )
}
