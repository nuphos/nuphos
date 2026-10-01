import { useCallback, useEffect, useRef } from 'react'

import { HOME_TAB_ID } from './model'

import type { PanelCtx } from './ctx'
import type { Tab } from './model'

type Acc = Pick<
  PanelCtx,
  | 'activeId'
  | 'credentialAccessRef'
  | 'credentialSyncInFlightRef'
  | 'credentialSyncTimersRef'
  | 'credentialSyncVersionsRef'
  | 'lastCredentialSyncedRef'
  | 'onDockToSidebar'
  | 'onExpandToPage'
  | 'setActiveId'
  | 'setCredentialsSaving'
  | 'setHistory'
  | 'setOpeningConversation'
  | 'setTabs'
  | 'syncTimersRef'
  | 'syncTranscriptNow'
  | 'tabsRef'
  | 'teamId'
>

export function usePanelNav(acc: Acc) {
  const {
    activeId,
    credentialAccessRef,
    credentialSyncInFlightRef,
    credentialSyncTimersRef,
    credentialSyncVersionsRef,
    lastCredentialSyncedRef,
    onDockToSidebar,
    onExpandToPage,
    setActiveId,
    setCredentialsSaving,
    setHistory,
    setOpeningConversation,
    setTabs,
    syncTimersRef,
    syncTranscriptNow,
    tabsRef,
    teamId,
  } = acc

  const dockCurrentSession = useCallback(() => {
    const current = tabsRef.current.find((t) => t.id === activeId) ?? null

    onDockToSidebar?.(current)
  }, [activeId, onDockToSidebar])

  const expandCurrentSession = useCallback(
    (opts?: { newTab?: boolean }) => {
      const current = tabsRef.current.find((t) => t.id === activeId) ?? null

      onExpandToPage?.(current, opts)
    },
    [activeId, onExpandToPage],
  )

  // Sidebar variant: start a fresh chat from the panel header. Just navigates
  // to Home — it does NOT abort the current turn (the stream is driven by
  // sessionId-keyed IPC events and keeps progressing in the background), and
  // the conversation stays openable from Recent, which re-fetches it and
  // reattaches to any still-active run.
  //
  // Clear `openingConversation` alongside `activeId` so an in-flight open
  // doesn't keep `showingConversationPage` true (the spinner / conversation
  // pane would otherwise stay visible until the open resolves).
  // The conversation an open is fetching right now, as a ref rather than the
  // `openingConversation` state it mirrors: the reconciliation effect below
  // needs to know an open is in flight *synchronously*. State lands a render
  // later, and in that gap the effect re-runs seeing no tab and no open —
  // indistinguishable from the user having closed the chat — and publishes
  // null, which navigates the workspace tab to Agent Home and records it.
  const pendingOpenRef = useRef<string | null>(null)

  const startNewChat = useCallback(() => {
    pendingOpenRef.current = null
    setOpeningConversation(null)
    setActiveId(HOME_TAB_ID)
  }, [])

  // Reset session state only when teamId actually changes. The naive form
  // (`useEffect(reset, [teamId])`) also fires on mount and races the
  // pendingImport effect — both setTabs calls batch and the reset wins,
  // leaving maximize/dock with a blank tab. A boolean "isFirstRun" ref is
  // broken under StrictMode (the ref persists across the double-invoke), so
  // instead we compare the actual value: equal → no-op, differs → reset.
  const prevTeamIdRef = useRef<string | undefined>(teamId)

  useEffect(() => {
    if (prevTeamIdRef.current === teamId) return
    prevTeamIdRef.current = teamId
    setTabs([])
    setActiveId(HOME_TAB_ID)
    setHistory([])
    pendingOpenRef.current = null
    setOpeningConversation(null)
    credentialAccessRef.current.clear()
    lastCredentialSyncedRef.current.clear()
    credentialSyncVersionsRef.current.clear()
    for (const timer of credentialSyncTimersRef.current.values()) clearTimeout(timer)
    credentialSyncTimersRef.current.clear()
    credentialSyncInFlightRef.current = 0
    setCredentialsSaving(false)
  }, [teamId])

  const queueTranscriptSync = useCallback(
    (tab: Tab, delayMs: number) => {
      const timers = syncTimersRef.current
      const existing = timers.get(tab.sessionId)

      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        timers.delete(tab.sessionId)
        syncTranscriptNow(tab)
      }, delayMs)

      timers.set(tab.sessionId, timer)
    },
    [syncTranscriptNow],
  )

  useEffect(() => {
    return () => {
      for (const timer of syncTimersRef.current.values()) clearTimeout(timer)
      syncTimersRef.current.clear()
      for (const timer of credentialSyncTimersRef.current.values()) clearTimeout(timer)
      credentialSyncTimersRef.current.clear()
    }
  }, [])

  return {
    dockCurrentSession,
    expandCurrentSession,
    pendingOpenRef,
    startNewChat,
    queueTranscriptSync,
  }
}
