import { useEffect, useRef } from 'react'

import { CREDENTIAL_FOCUS_REFRESH_DEBOUNCE_MS } from './constants'
import { allCredentialAccess, credentialOptionsLoaded } from './credentialAccess'
import { debounced } from './credentialFreshness'

import type { PanelCtx } from './ctx'

type Args = Pick<
  PanelCtx,
  'activeTab' | 'credentialOptions' | 'refreshCredentialOptions' | 'setTabs'
>

// Keeps the picker's options current while a conversation is open (a credential
// bound elsewhere shows up on focus or the next send) and records which options
// existed when the selection was saved, so later ones can be flagged as new.
export function useCredentialOptionsFreshness({
  activeTab,
  credentialOptions,
  refreshCredentialOptions,
  setTabs,
}: Args) {
  useEffect(() => {
    const refresh = debounced(
      () => void refreshCredentialOptions({ quiet: true }),
      CREDENTIAL_FOCUS_REFRESH_DEBOUNCE_MS,
    )

    window.addEventListener('focus', refresh.trigger)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh.trigger()
    }, 10_000)

    document.addEventListener('visibilitychange', refresh.trigger)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh.trigger)
      window.removeEventListener('focus', refresh.trigger)
      refresh.cancel()
    }
  }, [refreshCredentialOptions])

  const activeStreaming = Boolean(activeTab?.streaming)
  const wasStreamingRef = useRef(activeStreaming)

  useEffect(() => {
    const started = activeStreaming && !wasStreamingRef.current

    wasStreamingRef.current = activeStreaming
    if (started) void refreshCredentialOptions({ quiet: true })
  }, [activeStreaming, refreshCredentialOptions])

  const activeTabId = activeTab?.id
  const needsSeenBaseline = Boolean(activeTab) && !activeTab?.credentialOptionsSeen

  useEffect(() => {
    if (!activeTabId || !needsSeenBaseline || !credentialOptionsLoaded(credentialOptions)) return
    const seen = allCredentialAccess(credentialOptions)

    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId && !tab.credentialOptionsSeen
          ? { ...tab, credentialOptionsSeen: seen }
          : tab,
      ),
    )
  }, [activeTabId, needsSeenBaseline, credentialOptions, setTabs])
}
