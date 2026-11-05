import { useCallback, useEffect } from 'react'

import { api } from '../../../api'
import { parseAtlasError } from '../../../api/errors'
import { t } from '../../../i18n/index.ts'
import { runtimeAllows } from '../../../lib/runtimeExecution'
import { toast } from '../../ui/toast'

import { retractTarget, withoutRetracted } from './composerRecall'
import { withoutQueued } from './queuedAutoSend'

import type { PanelCtx } from './ctx'
import type { Tab } from './model'

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
  const setPhase = useCallback(
    (tabId: string, phase: 'stopping' | null) =>
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId && (phase === 'stopping' || t.phase === 'stopping') ? { ...t, phase } : t,
        ),
      ),
    [setTabs],
  )

  /** Stop the running turn; it says "Stopping…" at once, not when the runtime catches up. */
  const stopTab = useCallback(
    (tab: Tab) => {
      setPhase(tab.id, 'stopping')
      void api.agentCancelRuntime(tab.sessionId, teamIdRef.current).catch((error: unknown) => {
        setPhase(tab.id, null)
        toast.apiError(t('Could not send the stop request to the agent'), error)
      })
    },
    [setPhase, teamIdRef],
  )

  const stopActive = useCallback(() => {
    const tab = tabsRef.current.find((candidate) => candidate.id === activeId)

    if (!tab || !runtimeAllows(tab.runtimeState, 'cancel')) return
    stopTab(tab)
  }, [activeId, stopTab, tabsRef])

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
            late ? t('Too late to take this message back') : t('Could not take it back'),
            error,
          )

          return null
        },
      )
    }
    if (!runtimeAllows(tab.runtimeState, 'cancel')) return null
    const { draft } = target
    // The server stops the turn and waits for it to end before it drops the
    // message, which takes seconds. Hide it and hand the text back now; the
    // message returns only if the server refuses.
    const settle = (taken: boolean) =>
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tab.id || t.retracting !== draft.id) return t

          return taken
            ? { ...withoutRetracted(t, draft.id), retracting: null }
            : { ...t, retracting: null }
        }),
      )

    setTabs((prev) =>
      prev.map((t) => (t.id === tab.id ? { ...t, retracting: draft.id, phase: 'stopping' } : t)),
    )
    const undone = api.agentRetractMessage(tab.sessionId, draft.id, teamIdRef.current).then(
      () => {
        settle(true)

        return false
      },
      (error: unknown) => {
        settle(false)
        if (parseAtlasError(error).code === 'message_answered') {
          // Output arrived first: Esc still stops the turn, as it does once the agent answers.
          stopTab(tab)
          toast.info(t('The agent had already started, so your message stays and the turn stops'))
        } else {
          setPhase(tab.id, null)
          toast.apiError(t('Could not take back the message'), error)
        }

        return true
      },
    )

    return Promise.resolve({ text: draft.text, filePaths: draft.filePaths, undone })
  }, [activeId, setPhase, setTabs, stopTab, tabsRef, teamIdRef])

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
