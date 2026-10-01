import { useCallback, useEffect, useState } from 'react'

import { snap } from './helpers'

import type { Snapshot } from './helpers'
import type { Diagram } from '../schema'
import type { Dispatch, RefObject, SetStateAction } from 'react'

export function useHistory(
  diagramRef: RefObject<Diagram>,
  setDiagram: Dispatch<SetStateAction<Diagram>>,
) {
  const [past, setPast] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])

  const record = useCallback(() => {
    setPast((p) => [...p, snap(diagramRef.current)].slice(-50))
    setFuture([])
  }, [diagramRef])

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p
      const prev = p[p.length - 1]

      setFuture((f) => [snap(diagramRef.current), ...f])
      setDiagram((d) => ({ ...d, ...prev }))

      return p.slice(0, -1)
    })
  }, [diagramRef, setDiagram])

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f
      const next = f[0]

      setPast((p) => [...p, snap(diagramRef.current)])
      setDiagram((d) => ({ ...d, ...next }))

      return f.slice(1)
    })
  }, [diagramRef, setDiagram])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Let text fields (name/label/url inputs, kind select) keep their native
      // undo/redo instead of hijacking it for the canvas.
      const target = e.target as HTMLElement | null

      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  return { past, future, setPast, setFuture, record, undo, redo }
}
