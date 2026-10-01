import { useCallback, useEffect, useRef } from 'react'

import { api } from '../../../api'
import { toast } from '../../ui/toast'

import { finalizeIncompleteTools } from './clientTools'
import { EMPTY_CREDENTIAL_ACCESS } from './constants'
import {
  normalizeCredentialAccess,
  credentialOptionsCount,
  defaultCredentialAccess,
  credentialSelectionSignature,
} from './credentialAccess'
import { runLoadEarlierMessages } from './loadEarlierMessages'
import { runOpenConversation } from './openConversation'
import { fromPersistedMessages } from './persistence'
import { INTERRUPTED_TOOL_MESSAGE, uid } from './stall'

import type { PanelCtx } from './ctx'
import type { Tab } from './model'

type Acc = Pick<
  PanelCtx,
  | 'credentialAccessRef'
  | 'credentialOptions'
  | 'history'
  | 'kubeContextRef'
  | 'lastCredentialSyncedRef'
  | 'lastSyncedRef'
  | 'onForkConsumed'
  | 'pendingForkSessionId'
  | 'pendingOpenRef'
  | 'setActiveId'
  | 'setOpeningConversation'
  | 'setTabs'
  | 'tabsRef'
  | 'teamId'
  | 'urlRef'
  | 'uploadingTabsRef'
>

export function useConversationOpen(acc: Acc) {
  const {
    credentialAccessRef,
    credentialOptions,
    history,
    kubeContextRef,
    lastCredentialSyncedRef,
    lastSyncedRef,
    onForkConsumed,
    pendingForkSessionId,
    pendingOpenRef,
    setActiveId,
    setOpeningConversation,
    setTabs,
    tabsRef,
    teamId,
    urlRef,
    uploadingTabsRef,
  } = acc

  // Monotonic open token: every conversation open/fork invalidates any slower
  // in-flight one, so a stale response can never clobber the newer tab (e.g.
  // a plan-continue fork landing a writable tab over a read-only audit view).
  const openGenerationRef = useRef(0)

  /** Release the in-flight marker, unless a newer open already claimed it. */
  const clearPendingOpen = useCallback((sessionId: string) => {
    if (pendingOpenRef.current === sessionId) pendingOpenRef.current = null
  }, [])

  // Audit read-only transitions for a tab that already exists.
  // Forcing marks the tab so an interactive reopen can restore writability;
  // backend-imposed read-only (foreign/Slack) is never marked and never
  // restored.
  const setTabAuditReadOnly = useCallback((sessionId: string, next: boolean) => {
    const target = tabsRef.current.find((t) => t.sessionId === sessionId)

    if (!target) return
    if (next && !target.readOnly) {
      // The in-place flip is itself an "open": a slower in-flight open must
      // not land a writable tab over it.
      openGenerationRef.current += 1
      setTabs((prev) =>
        prev.map((t) =>
          t.id === target.id ? { ...t, readOnly: true, auditForcedReadOnly: true } : t,
        ),
      )
    } else if (!next && target.auditForcedReadOnly) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === target.id ? { ...t, readOnly: false, auditForcedReadOnly: undefined } : t,
        ),
      )
    }
  }, [])
  const openConversation = useCallback(
    (sessionId: string, titleHint?: string, opts?: { forceReadOnly?: boolean }) =>
      runOpenConversation(
        {
          tabsRef,
          openGenerationRef,
          clearPendingOpen,
          setOpeningConversation,
          setTabAuditReadOnly,
          setActiveId,
          pendingOpenRef,
          history,
          teamId,
          credentialOptions,
          lastSyncedRef,
          credentialAccessRef,
          lastCredentialSyncedRef,
          setTabs,
          urlRef,
          kubeContextRef,
          uploadingTabsRef,
        },
        sessionId,
        titleHint,
        opts,
      ),
    [
      tabsRef,
      clearPendingOpen,
      setOpeningConversation,
      setTabAuditReadOnly,
      setActiveId,
      pendingOpenRef,
      history,
      teamId,
      credentialOptions,
      lastSyncedRef,
      credentialAccessRef,
      lastCredentialSyncedRef,
      setTabs,
      urlRef,
      kubeContextRef,
    ],
  )

  const loadEarlierMessages = useCallback(
    (tabId: string) => runLoadEarlierMessages({ setTabs, tabsRef, teamId }, tabId),
    [teamId],
  )

  // Fork a (possibly someone else's) conversation into a NEW session the current
  // user owns: copy the transcript for full context, but mint a fresh sessionId
  // and mark it writable. The original is never touched; the new turn (e.g. the
  // plan's Approve) persists under the current user. Used to continue a plan
  // from the Plans page — works for any team member, since team conversations
  // are team-readable but only the owner can write to the original.
  const forkConversation = useCallback(
    async (sourceSessionId: string) => {
      const generation = ++openGenerationRef.current

      setOpeningConversation({ sessionId: sourceSessionId, title: 'Continuing plan…' })
      try {
        const detail = await api.agentGetConversation(sourceSessionId, teamId)

        if (openGenerationRef.current !== generation) {
          setOpeningConversation((cur) => (cur?.sessionId === sourceSessionId ? null : cur))

          return
        }
        const messages = finalizeIncompleteTools(
          fromPersistedMessages(detail.messages),
          INTERRUPTED_TOOL_MESSAGE,
        )
        const tab: Tab = {
          id: uid(),
          // New session — the fork belongs entirely to the current user.
          sessionId: uid(),
          title: detail.title,
          messages,
          streaming: false,
          connected: true,
          phase: null,
          streamId: null,
          streamStartedAt: null,
          error: null,
          autoResumeAttempts: 0,
          // Don't copy the source's credential selection — those ids may belong to
          // the original owner and 403 on this user's agentStart. Default to the
          // current user's own available credentials.
          credentialAccess: normalizeCredentialAccess(
            credentialOptionsCount(credentialOptions) > 0
              ? defaultCredentialAccess(credentialOptions)
              : EMPTY_CREDENTIAL_ACCESS,
          ),
          // A fork is the caller's own writable session, regardless of who created
          // the source conversation.
          readOnly: false,
          slackThread: null,
        }

        credentialAccessRef.current.set(tab.sessionId, tab.credentialAccess)
        lastCredentialSyncedRef.current.set(
          tab.sessionId,
          credentialSelectionSignature(tab.credentialAccess),
        )
        setTabs([tab])
        setActiveId(tab.id)
        setOpeningConversation(null)
      } catch (err) {
        if (openGenerationRef.current !== generation) {
          setOpeningConversation((cur) => (cur?.sessionId === sourceSessionId ? null : cur))

          return
        }
        setOpeningConversation(null)
        toast.apiError('Could not continue plan', err)
      }
    },
    [credentialOptions, teamId],
  )

  // One-shot: fork the requested conversation when the parent asks. The ref
  // guards Strict Mode's double-invoke and any re-render before the parent
  // clears the prop, so we never mint two forks for the same request.
  const consumedForkRef = useRef<string | null>(null)

  useEffect(() => {
    // Reset once the parent clears the prop, so forking the SAME source again
    // (a different plan, a retry, or a re-click) isn't permanently suppressed.
    if (!pendingForkSessionId) {
      consumedForkRef.current = null

      return
    }
    if (consumedForkRef.current === pendingForkSessionId) return
    consumedForkRef.current = pendingForkSessionId
    void forkConversation(pendingForkSessionId)
    onForkConsumed?.()
  }, [pendingForkSessionId, forkConversation, onForkConsumed])

  return {
    openGenerationRef,
    clearPendingOpen,
    setTabAuditReadOnly,
    openConversation,
    loadEarlierMessages,
    forkConversation,
  }
}
