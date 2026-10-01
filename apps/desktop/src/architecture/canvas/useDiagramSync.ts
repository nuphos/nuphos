import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { setActiveDiagramId } from '../activeDiagram'

import type { Snapshot } from './helpers'
import type { Diagram } from '../schema'
import type { Dispatch, RefObject, SetStateAction } from 'react'

type Args = {
  teamId: string
  initial: Diagram
  diagram: Diagram
  setDiagram: Dispatch<SetStateAction<Diagram>>
  diagramRef: RefObject<Diagram>
  onRenameRef: RefObject<((name: string) => void) | undefined>
  dragSnap: RefObject<Snapshot | null>
}

export function useDiagramSync({
  teamId,
  initial,
  diagram,
  setDiagram,
  diagramRef,
  onRenameRef,
  dragSnap,
}: Args) {
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const firstRender = useRef(true)
  // For reconciling external edits (e.g. the agent drawing into this diagram):
  // `baselineUpdatedAt` is the updatedAt we're in sync with; `skipNextSave`
  // suppresses the autosave that a poll-driven reload would otherwise trigger;
  // `savingRef` lets the poll avoid clobbering an in-flight local edit.
  const baselineUpdatedAt = useRef(initial.updatedAt)
  const skipNextSave = useRef(false)
  const savingRef = useRef(false)

  // --- autosave (debounced) ------------------------------------------------
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false

      return
    }
    // A reload caused by an external edit (poll) shouldn't echo back a save.
    if (skipNextSave.current) {
      skipNextSave.current = false

      return
    }
    setSaveState('saving')
    savingRef.current = true
    const t = setTimeout(() => {
      api
        .archSaveDiagram(teamId, diagram.id, {
          name: diagram.name,
          nodes: diagram.nodes,
          views: diagram.views,
        })
        .then((saved) => {
          baselineUpdatedAt.current = saved.updatedAt
          setSaveState('saved')
        })
        .catch((e: unknown) => {
          setSaveState('idle')
          toast.apiError('Failed to save diagram', e)
        })
        .finally(() => {
          savingRef.current = false
        })
    }, 700)

    return () => clearTimeout(t)
  }, [diagram, teamId])

  // Report the loaded diagram's name up so the breadcrumb is correct even when
  // we arrived via a deep link (which carries only the id, with a placeholder
  // name) rather than by clicking a row in the list.
  useEffect(() => {
    onRenameRef.current?.(initial.name)
  }, [initial.id, initial.name, onRenameRef])

  // --- track open diagram + reflect external edits (agent drawing) ----------
  useEffect(() => {
    setActiveDiagramId(initial.id)
    const iv = setInterval(() => {
      // Don't fight an in-flight local save or an active drag.
      if (savingRef.current || dragSnap.current) return
      api
        .archGetDiagram(teamId, initial.id)
        .then((remote) => {
          if (!remote || remote.updatedAt === baselineUpdatedAt.current) return
          const previousName = diagramRef.current.name

          baselineUpdatedAt.current = remote.updatedAt
          skipNextSave.current = true
          setDiagram(remote)
          // An agent rename arrives via the poll, not local input — keep the
          // breadcrumb/list label (owned by the parent) in sync.
          if (remote.name !== previousName) onRenameRef.current?.(remote.name)
        })
        .catch(() => {})
    }, 1500)

    return () => {
      clearInterval(iv)
      setActiveDiagramId(null)
    }
  }, [teamId, initial.id, diagramRef, dragSnap, onRenameRef, setDiagram])

  return saveState
}
