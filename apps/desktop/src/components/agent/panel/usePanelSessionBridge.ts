import { useEffect, useRef } from 'react'

import { resolveSessionSync } from '../../../lib/agentSessionSync'
import { onChatTitleChanged } from '../../../lib/chatTitleEvents'

import { HOME_TAB_ID } from './model'
import { retainBackgroundTabs } from './sessionContinuity'

import type { PanelCtx } from './ctx'

type Acc = Pick<
  PanelCtx,
  | 'teamId'
  | 'activeTab'
  | 'onSessionChange'
  | 'openConversation'
  | 'openGenerationRef'
  | 'openingConversation'
  | 'pendingImport'
  | 'pendingOpenRef'
  | 'sessionIdProp'
  | 'sessionReadOnly'
  | 'setActiveId'
  | 'setOpeningConversation'
  | 'setTabAuditReadOnly'
  | 'setTabs'
  | 'tabsRef'
  | 'uploadingTabsRef'
>

export function usePanelSessionBridge(acc: Acc) {
  const {
    teamId,
    activeTab,
    onSessionChange,
    openConversation,
    openGenerationRef,
    openingConversation,
    pendingImport,
    pendingOpenRef,
    sessionIdProp,
    sessionReadOnly,
    setActiveId,
    setOpeningConversation,
    setTabAuditReadOnly,
    setTabs,
    tabsRef,
    uploadingTabsRef,
  } = acc

  useEffect(
    () =>
      onChatTitleChanged((change) => {
        if (change.teamId !== teamId) return
        setTabs((previous) =>
          previous.map((tab) =>
            tab.sessionId === change.sessionId ? { ...tab, title: change.title } : tab,
          ),
        )
      }),
    [teamId, setTabs],
  )

  // Single reconciliation between externally-controlled sessionId and the
  // internal active session. Uses a "last synced" ref to decide which side
  // changed since the last reconcile, avoiding the inbound/outbound loop
  // where two effects would clobber each other.
  const onSessionChangeRef = useRef(onSessionChange)

  useEffect(() => {
    onSessionChangeRef.current = onSessionChange
  }, [onSessionChange])

  const lastSyncedSessionIdRef = useRef<string | null | undefined>(undefined)
  // Last (sessionId) the audit read-only context targeted, or null when not
  // in an audit context. An audit open must supersede ANY in-flight
  // open/fork — even when it lands on an existing (possibly already
  // read-only) tab, where no other code path bumps the open generation.
  const lastAuditTargetRef = useRef<string | null>(null)

  useEffect(() => {
    if (sessionIdProp === undefined) return
    const auditTarget = sessionReadOnly && sessionIdProp ? sessionIdProp : null

    if (auditTarget !== lastAuditTargetRef.current) {
      lastAuditTargetRef.current = auditTarget
      if (auditTarget) openGenerationRef.current += 1
    }
    const action = resolveSessionSync({
      prop: sessionIdProp,
      internal: activeTab?.sessionId ?? null,
      lastSynced: lastSyncedSessionIdRef.current,
      // The ref, not the state it mirrors: an open started earlier in this very
      // tick must already count as in flight.
      opening: pendingOpenRef.current ?? openingConversation?.sessionId ?? null,
      pendingImport: pendingImport?.sessionId ?? null,
      hasLoadedTabForProp: tabsRef.current.some((t) => t.sessionId === sessionIdProp),
    })

    switch (action.kind) {
      case 'ignore':
      case 'defer-to-import':
        // A pending snapshot import for this session owns the state transition
        // and preserves streaming/streamId — don't race the import effect and
        // replace the live tab with a non-streaming copy from the backend
        // (openConversation hardcodes streaming:false, streamId:null).
        lastSyncedSessionIdRef.current = sessionIdProp

        return
      case 'adopt':
        lastSyncedSessionIdRef.current = sessionIdProp
        // An audit open of the session that is ALREADY showing changes no
        // session id, only the read-only flag — it must still strip
        // composer/approve. Symmetrically, an interactive entry
        // (seeded prompt, plan chat) clearing the flag restores writability
        // if — and only if — the read-only was audit-forced.
        if (sessionIdProp) setTabAuditReadOnly(sessionIdProp, sessionReadOnly)

        return
      // Our own fetch for this prop hasn't landed yet. Publishing here would
      // report "the user left this chat" and bounce the workspace tab to Agent
      // Home — into its history — mid-open. Wait; the load re-runs this.
      case 'awaiting-open':
        return
      case 'publish':
        lastSyncedSessionIdRef.current = action.sessionId
        onSessionChangeRef.current?.(action.sessionId)

        return
      case 'clear':
        lastSyncedSessionIdRef.current = sessionIdProp
        // Supersede any open still in flight: without this its response lands
        // on the home the user just went back to and installs the conversation
        // they dismissed.
        openGenerationRef.current += 1
        pendingOpenRef.current = null
        setTabs((prev) => retainBackgroundTabs(prev, uploadingTabsRef.current))
        setActiveId(HOME_TAB_ID)
        setOpeningConversation(null)

        return
      case 'activate': {
        lastSyncedSessionIdRef.current = sessionIdProp
        const existing = tabsRef.current.find((t) => t.sessionId === action.sessionId)

        if (!existing) return
        // Same as openConversation's own shortcut: activating a loaded tab
        // supersedes any open still in flight, and drops its spinner.
        openGenerationRef.current += 1
        pendingOpenRef.current = null
        setOpeningConversation(null)
        // An audit open must not inherit a previously-interactive tab (and an
        // interactive open must not inherit an audit-forced lock).
        setTabAuditReadOnly(action.sessionId, sessionReadOnly)
        setActiveId(existing.id)

        return
      }
      case 'open':
        lastSyncedSessionIdRef.current = sessionIdProp
        // Marks the open in flight synchronously — see `pendingOpenRef`.
        void openConversation(action.sessionId, undefined, { forceReadOnly: sessionReadOnly })

        return
    }
  }, [
    sessionIdProp,
    sessionReadOnly,
    activeTab?.sessionId,
    openConversation,
    openingConversation,
    setTabAuditReadOnly,
    pendingImport,
  ])

  return {}
}
