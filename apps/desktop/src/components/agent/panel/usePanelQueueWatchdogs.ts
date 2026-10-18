import { useCallback, useEffect } from 'react'

import { api } from '../../../api'
import { parseAtlasError } from '../../../api/errors'
import { runtimeAllows } from '../../../lib/runtimeExecution'
import { toast } from '../../ui/toast'

import { retractTarget, withoutRetracted } from './composerRecall'
import { withoutQueued } from './queuedAutoSend'

import type { PanelCtx } from './ctx'

type Acc = Pick<
  PanelCtx,
  'activeId' | 'activeTab' | 'panelRootRef' | 'setTabs' | 'tabsRef' | 'teamIdRef'
>

export function usePanelQueueWatchdogs({
  activeId,
  activeTab,
  panelRootRef,
  setTabs,
  tabsRef,
  teamIdRef,
}: Acc) {
  const stopActive = useCallback(() => {
    const tab = tabsRef.current.find((candidate) => candidate.id === activeId)

    if (!tab || !runtimeAllows(tab.runtimeState, 'cancel')) return
    void api.agentCancelRuntime(tab.sessionId, teamIdRef.current).catch((error: unknown) => {
      toast.apiError('Could not send the stop request to the agent', error)
    })
  }, [activeId, tabsRef, teamIdRef])

  /**
   * Esc in an empty composer: take back the newest queued message, else the
   * just-sent one whose turn has no output yet (stopping that turn). Null when
   * there is nothing to take back, so Esc keeps stopping the turn.
   */
  const retractLatest = useCallback(() => {
    const tab = tabsRef.current.find((candidate) => candidate.id === activeId)
    const target = tab ? retractTarget(tab) : null

    if (!tab || !target) return null
    if (target.kind === 'queued') {
      const { item } = target

      // Off the server queue first, or it would still run; 404 means its turn started.
      return api.agentUnqueueMessage(tab.sessionId, item.id, teamIdRef.current).then(
        ({ text }) => {
          setTabs((prev) => prev.map((t) => (t.id === tab.id ? withoutQueued(t, item.id) : t)))

          return { text: item.text || text, filePaths: item.filePaths }
        },
        (error: unknown) => {
          const late = parseAtlasError(error).code === 'not_found'

          toast.apiError(
            late ? 'Too late to take this message back' : 'Could not take it back',
            error,
          )

          return null
        },
      )
    }
    if (!runtimeAllows(tab.runtimeState, 'cancel')) return null
    const { draft } = target

    return api.agentRetractMessage(tab.sessionId, draft.id, teamIdRef.current).then(
      () => {
        setTabs((prev) => prev.map((t) => (t.id === tab.id ? withoutRetracted(t, draft.id) : t)))

        return draft
      },
      (error: unknown) => {
        toast.apiError('Could not take back the message', error)

        return null
      },
    )
  }, [activeId, setTabs, tabsRef, teamIdRef])

  useEffect(() => {
    if (!runtimeAllows(activeTab?.runtimeState, 'cancel')) return
    function onEsc(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      if (!panelRootRef.current?.contains(document.activeElement)) return
      event.preventDefault()
      stopActive()
    }
    window.addEventListener('keydown', onEsc)

    return () => window.removeEventListener('keydown', onEsc)
  }, [activeTab?.runtimeState, panelRootRef, stopActive])

  return { stopActive, retractLatest }
}
