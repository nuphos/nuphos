import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../../../api'
import { track } from '../../../lib/analytics'
import { readDefaultPermissionMode, writeDefaultPermissionMode } from '../../../lib/permissionMode'
import { toast } from '../../ui/toast'

import type { PanelCtx } from './ctx'
import type { PermissionMode } from '../../../lib/permissionMode'

type Acc = Pick<
  PanelCtx,
  | 'activeId'
  | 'setHistory'
  | 'setHistoryLoading'
  | 'setTabs'
  | 'tabs'
  | 'tabsRef'
  | 'teamId'
  | 'visible'
>

export function usePanelPermissions(acc: Acc) {
  const { activeId, setHistory, setHistoryLoading, setTabs, tabs, tabsRef, teamId, visible } = acc

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId])
  // The toolCallId of the LAST unresolved require_auth in the active tab — only
  // that one shows approve/deny buttons; earlier blocked calls are stale.
  const activePendingAuthToolCallId = useMemo(() => {
    if (!activeTab) return null
    let found: string | null = null

    for (const m of activeTab.messages) {
      for (const p of m.parts) {
        if (p.type === 'tool' && p.state === 'approval-requested') {
          found = p.toolCallId
        }
      }
    }

    return found
  }, [activeTab])
  // Full Access (per-conversation): mirrors the backend flag that
  // disarms the authorization gate, keyed by sessionId so tab switches keep
  // each conversation's state. Hidden entirely when Auto Mode is off globally.
  const [bypassBySession, setBypassBySession] = useState<Record<string, boolean>>({})
  const [autoModeAvailable, setAutoModeAvailable] = useState(false)
  const [defaultPermissionMode, setDefaultPermissionMode] = useState<PermissionMode>(() =>
    readDefaultPermissionMode(localStorage),
  )

  // Whether the authorization gate exists at all. The per-session endpoint
  // reports it too, but only for a session that exists — the home composer has
  // none, so ask the session-less rules endpoint.
  useEffect(() => {
    if (!visible) return
    let alive = true

    void api
      .agentListAutoModeRules()
      .then(({ enabled }) => {
        if (alive) setAutoModeAvailable(enabled)
      })
      .catch(() => {
        // Unreachable → the picker stays hidden, which is the safe default.
      })

    return () => {
      alive = false
    }
  }, [visible])
  const activeSessionId = activeTab?.foreign ? null : (activeTab?.sessionId ?? null)
  // Keep the locally selected mode while the first turn is being prepared.
  // Transcript sync may already have created a row, but /chat has not yet
  // initialized its authorization state. Reconcile after the turn settles.
  const activeTabHasMessages = (activeTab?.messages.length ?? 0) > 0
  const activeTabStreaming = activeTab?.streaming ?? false
  const deferModeFetch =
    activeSessionId !== null &&
    Object.hasOwn(bypassBySession, activeSessionId) &&
    (activeTabStreaming ||
      (activeTab?.messages.some((message) =>
        message.parts.some(
          (part) => part.type === 'transfer-upload' && part.status === 'uploading',
        ),
      ) ??
        false))

  useEffect(() => {
    if (!activeSessionId || deferModeFetch) return
    let alive = true

    void api
      .agentGetAutoModeBypass(activeSessionId)
      .then(({ enabled, bypass }) => {
        if (!alive) return
        setAutoModeAvailable(enabled)
        setBypassBySession((prev) =>
          prev[activeSessionId] === bypass ? prev : { ...prev, [activeSessionId]: bypass },
        )
      })
      .catch(() => {
        // Unreachable or not-yet-created → the toggle simply doesn't render.
      })

    return () => {
      alive = false
    }
  }, [activeSessionId, activeTabHasMessages, activeTabStreaming, deferModeFetch])
  const applyDefaultPermissionMode = useCallback((mode: PermissionMode) => {
    setDefaultPermissionMode(mode)
    writeDefaultPermissionMode(localStorage, mode)
  }, [])
  const selectDefaultPermissionMode = useCallback(
    (bypass: boolean) => {
      applyDefaultPermissionMode(bypass ? 'bypass' : 'auto')
    },
    [applyDefaultPermissionMode],
  )
  const applyBypass = useCallback(
    (sessionId: string, next: boolean) => {
      // Optimistic: the button flips immediately; revert on failure. The
      // remembered mode for new conversations only follows a pick the server
      // accepted — a failed toggle must not change what future chats start in.
      setBypassBySession((prev) => ({ ...prev, [sessionId]: next }))
      api.agentSetAutoModeBypass(sessionId, next).then(
        () => {
          applyDefaultPermissionMode(next ? 'bypass' : 'auto')
          // Only after the server accepted it: a reverted toggle is not a
          // decision, and recording the optimistic flip would overstate how
          // often confirmation is actually handed over.
          track('agent_permission_mode_changed', {
            mode: next ? 'bypass' : 'auto',
            session_id: sessionId,
          })
        },
        (err: unknown) => {
          setBypassBySession((prev) => ({ ...prev, [sessionId]: !next }))
          toast.apiError('Could not update Full Access', err, {
            fallback: 'The change was not saved — please try again.',
          })
        },
      )
    },
    [applyDefaultPermissionMode],
  )
  const selectBypassMode = useCallback(
    (bypass: boolean) => {
      const tab = tabsRef.current.find((t) => t.id === activeId)
      const sessionId = tab?.sessionId

      if (!sessionId || tab.readOnly || tab.foreign) return
      if (bypass === (bypassBySession[sessionId] ?? false)) return
      applyBypass(sessionId, bypass)
    },
    [activeId, bypassBySession, applyBypass, tabsRef],
  )
  // The only consumer left is the starter-suggestions gate — those are for
  // someone who has not started a conversation here yet — so this asks the
  // narrowest question that answers it rather than paging a list nobody
  // renders. The full history lives on the Chats page now.
  const refreshHistory = useCallback(async () => {
    // No team, no listing — history is a per-team question and the backend
    // rejects it without one.
    if (!teamId) {
      setHistory([])

      return
    }
    setHistoryLoading(true)
    try {
      const page = await api.agentListConversations(teamId, { limit: 1, scope: 'mine' })

      setHistory(page.conversations)
      const runtimeBySession = new Map(
        page.conversations.map((conversation) => [
          conversation.sessionId,
          {
            attached: conversation.claudeCodeRuntimeAttached === true,
            provider: conversation.agentRuntime,
            runtimeId: conversation.runtimeId,
            runtimeLabel: conversation.runtimeLabel,
          },
        ]),
      )

      setTabs((current) =>
        current.map((tab) => {
          const attached = runtimeBySession.get(tab.sessionId)

          return attached === undefined ||
            (tab.claudeCodeRuntimeAttached === attached.attached &&
              tab.agentRuntime === attached.provider &&
              tab.runtimeId === attached.runtimeId &&
              tab.runtimeLabel === attached.runtimeLabel)
            ? tab
            : {
                ...tab,
                claudeCodeRuntimeAttached: attached.attached,
                agentRuntime: attached.provider,
                runtimeId: attached.runtimeId,
                runtimeLabel: attached.runtimeLabel,
              }
        }),
      )
    } catch (err) {
      toast.apiError('Failed to load recent conversations', err)
    } finally {
      setHistoryLoading(false)
    }
  }, [setHistory, setHistoryLoading, setTabs, teamId])

  return {
    activeTab,
    activePendingAuthToolCallId,
    bypassBySession,
    setBypassBySession,
    autoModeAvailable,
    setAutoModeAvailable,
    defaultPermissionMode,
    setDefaultPermissionMode,
    applyDefaultPermissionMode,
    selectDefaultPermissionMode,
    applyBypass,
    selectBypassMode,
    refreshHistory,
  }
}
