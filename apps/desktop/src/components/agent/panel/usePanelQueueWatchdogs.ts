import { useCallback, useEffect } from 'react'

import { api } from '../../../api'
import { runtimeAllows } from '../../../lib/runtimeExecution'
import { toast } from '../../ui/toast'

import type { PanelCtx } from './ctx'

type Acc = Pick<PanelCtx, 'activeId' | 'activeTab' | 'panelRootRef' | 'tabsRef' | 'teamIdRef'>

export function usePanelQueueWatchdogs({
  activeId,
  activeTab,
  panelRootRef,
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

  return { stopActive }
}
