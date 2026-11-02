import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { toast } from '../components/ui/toast'
import { t } from '../i18n/index.ts'

import { diffDesignOps, mergeDesign } from './designOps'

import type { Design } from './schema'
import type { Dispatch, RefObject, SetStateAction } from 'react'

type Args = {
  teamId: string
  initial: Design
  design: Design
  setDesign: Dispatch<SetStateAction<Design>>
  designRef: RefObject<Design>
  onRenameRef: RefObject<((name: string) => void) | undefined>
  /** The name shown around the canvas; corrected whenever it differs from the design's. */
  shownName?: string | null
  /** True while a drag or draw is live: a merge then would move things under the cursor. */
  busyRef: RefObject<boolean>
}

export type SaveState = 'idle' | 'saving' | 'saved'

const SAVE_DEBOUNCE_MS = 600
const POLL_MS = 2000

/**
 * Keeps a design in step with the server. Local edits flush as ops (only what
 * changed, so a teammate or the agent editing other objects at the same time
 * is not overwritten); remote edits arrive by polling and are merged under the
 * unsynced local ones.
 */
export function useDesignSync({
  teamId,
  initial,
  design,
  setDesign,
  designRef,
  onRenameRef,
  shownName,
  busyRef,
}: Args): SaveState {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // Bumped when a save lands, so edits made while it was in flight get their own
  // flush. A failed save waits for the next local edit instead of retrying forever.
  const [settled, setSettled] = useState(0)
  // The last document the server confirmed. Local edits are diffed against it.
  const baselineRef = useRef<Design>(initial)
  const savingRef = useRef(false)

  // --- flush local edits ---------------------------------------------------
  useEffect(() => {
    const ops = diffDesignOps(baselineRef.current, design)

    if (ops.length === 0) return
    setSaveState('saving')
    const timer = setTimeout(() => {
      if (savingRef.current) return
      const sent = designRef.current
      const pending = diffDesignOps(baselineRef.current, sent)

      if (pending.length === 0) return
      savingRef.current = true
      api
        .designsApplyOps(teamId, sent.id, pending)
        .then((saved) => {
          baselineRef.current = saved
          // The server's copy may carry a teammate's edits too; replay what
          // moved here since the send on top of it, and flush that next.
          setDesign((local) => (local === sent ? saved : mergeDesign(sent, local, saved)))
          setSaveState('saved')
          setSettled((n) => n + 1)
        })
        .catch((e: unknown) => {
          setSaveState('idle')
          toast.apiError(t('Failed to save design'), e)
        })
        .finally(() => {
          savingRef.current = false
        })
    }, SAVE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [design, settled, teamId, designRef, setDesign])

  // A link to an open design resets the breadcrumb to a placeholder without
  // remounting the canvas, so compare on every change rather than on mount.
  useEffect(() => {
    if (shownName !== design.name) onRenameRef.current?.(design.name)
  }, [shownName, design.name, onRenameRef])

  // --- pick up remote edits -------------------------------------------------
  useEffect(() => {
    const poll = setInterval(() => {
      if (savingRef.current || busyRef.current) return
      // The stamp is a few bytes; the document carries every screen's HTML.
      api
        .designsStamp(teamId, initial.id)
        .then((stamp) =>
          stamp.updatedAt === baselineRef.current.updatedAt
            ? null
            : api.designsGet(teamId, initial.id),
        )
        .then((remote) => {
          if (!remote || remote.updatedAt === baselineRef.current.updatedAt) return
          const local = designRef.current
          const merged = mergeDesign(baselineRef.current, local, remote)

          baselineRef.current = remote
          setDesign(merged)
          if (merged.name !== local.name) onRenameRef.current?.(merged.name)
        })
        .catch(() => {})
    }, POLL_MS)

    return () => clearInterval(poll)
  }, [teamId, initial.id, designRef, busyRef, onRenameRef, setDesign])

  return saveState
}
