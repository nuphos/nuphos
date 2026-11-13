import { useCallback, useEffect, useRef } from 'react'

import { api } from '../../../api.ts'
import { t } from '../../../i18n/index.ts'
import { toast } from '../../ui/toast.ts'

import { finalizeIncompleteTools } from './clientTools.ts'
import { EMPTY_CREDENTIAL_ACCESS } from './constants.ts'
import {
  normalizeCredentialAccess,
  credentialOptionsCount,
  defaultCredentialAccess,
  credentialSelectionSignature,
} from './credentialAccess.ts'
import { forkImport } from './dispatchTurn.ts'
import { afterForkStored } from './forkStored.ts'
import { runLoadEarlierMessages } from './loadEarlierMessages.ts'
import { runOpenConversation } from './openConversation.ts'
import { fromPersistedMessages } from './persistence.ts'
import { INTERRUPTED_TOOL_MESSAGE, uid } from './stall.ts'
import { announceTimelineChange } from './timelineEvents.ts'
import { toPersistedMessages } from './toUiMessages.ts'

import type { PanelCtx } from './ctx'
import type { Tab } from './model'

type Acc = Pick<
  PanelCtx,
  | 'credentialAccessRef'
  | 'credentialOptions'
  | 'dispatchTurn'
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
  | 'tabs'
  | 'tabsRef'
  | 'teamId'
  | 'urlRef'
  | 'uploadingTabsRef'
>

export function useConversationOpen(acc: Acc) {
  const {
    credentialAccessRef,
    credentialOptions,
    dispatchTurn,
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
    tabs,
    tabsRef,
    teamId,
    urlRef,
    uploadingTabsRef,
  } = acc

  // A newer open or fork invalidates slower responses.
  const openGenerationRef = useRef(0)

  /** Release the in-flight marker, unless a newer open already claimed it. */
  const clearPendingOpen = useCallback((sessionId: string) => {
    if (pendingOpenRef.current === sessionId) pendingOpenRef.current = null
  }, [])

  // Only an audit-forced read-only state may be restored to writable.
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

  // An edited message waits here until its fork is committed: dispatchTurn
  // reads the tab back from tabsRef, which only updates after the render.
  const editResendRef = useRef<{ tabId: string; text: string; sourceSessionId: string } | null>(
    null,
  )

  useEffect(() => {
    const pending = editResendRef.current
    const fork = pending && tabs.find((tab) => tab.id === pending.tabId)

    if (!pending || !fork) return
    editResendRef.current = null
    // Once the server has the fork, the original links to it: the edit ran there.
    void dispatchTurn(pending.tabId, pending.text, [])
      .then(() =>
        afterForkStored(forkImport(pending.tabId), () =>
          api.agentRecordEditFork(pending.sourceSessionId, fork.sessionId, teamId),
        ),
      )
      .catch((err: unknown) => {
        console.warn('[edit] could not link the original agent to its fork', err)
      })
  }, [tabs, dispatchTurn, teamId])

  // Store a new owned copy before opening it. Edits copy only the earlier
  // history, then send the replacement; ordinary forks link back from the source.
  const forkConversation = useCallback(
    async (sourceSessionId: string, edit?: { messageId: string; text: string }) => {
      const generation = ++openGenerationRef.current

      editResendRef.current = null
      setOpeningConversation({ sessionId: sourceSessionId, title: t('Forking agent…') })
      try {
        const detail = await api.agentGetConversation(sourceSessionId, teamId)

        if (openGenerationRef.current !== generation) {
          setOpeningConversation((cur) => (cur?.sessionId === sourceSessionId ? null : cur))

          return
        }
        const transcript = finalizeIncompleteTools(
          fromPersistedMessages(detail.messages),
          INTERRUPTED_TOOL_MESSAGE,
        )
        const cut = edit ? transcript.findIndex((m) => m.id === edit.messageId) : -1

        if (edit && cut < 0) {
          setOpeningConversation(null)
          toast.error(t('Could not edit message'), t('That message is no longer in this agent.'))

          return
        }
        const messages = edit ? transcript.slice(0, cut) : transcript
        const tab: Tab = {
          id: uid(),
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
          // Source credentials may belong to someone else; use the caller's defaults.
          credentialAccess: normalizeCredentialAccess(
            credentialOptionsCount(credentialOptions) > 0
              ? defaultCredentialAccess(credentialOptions)
              : EMPTY_CREDENTIAL_ACCESS,
          ),
          readOnly: false,
          // Keep the source runtime only when it belongs to the caller.
          ...(detail.isOwner === false
            ? {}
            : {
                agentRuntime: detail.agentRuntime,
                runtimeId: detail.runtimeId,
                runtimeLabel: detail.runtimeLabel,
              }),
          slackThread: null,
          unsaved: false,
        }

        await api.agentSyncConversationTranscript({
          sessionId: tab.sessionId,
          agentRuntime: tab.agentRuntime,
          runtimeId: tab.runtimeId,
          teamId,
          title: tab.title,
          messages: toPersistedMessages(messages),
          import: true,
        })
        if (!edit) {
          try {
            await api.agentRecordFork(sourceSessionId, tab.sessionId, teamId)
            announceTimelineChange(sourceSessionId)
          } catch (err) {
            toast.apiError(t('Could not link the fork to its source'), err)
          }
        }
        if (openGenerationRef.current !== generation) return

        credentialAccessRef.current.set(tab.sessionId, tab.credentialAccess)
        lastCredentialSyncedRef.current.set(
          tab.sessionId,
          credentialSelectionSignature(tab.credentialAccess),
        )
        if (edit) editResendRef.current = { tabId: tab.id, text: edit.text, sourceSessionId }
        setTabs([tab])
        setActiveId(tab.id)
        setOpeningConversation(null)
      } catch (err) {
        if (openGenerationRef.current !== generation) {
          setOpeningConversation((cur) => (cur?.sessionId === sourceSessionId ? null : cur))

          return
        }
        setOpeningConversation(null)
        toast.apiError(t('Could not fork agent'), err)
      }
    },
    [credentialOptions, teamId],
  )

  // Consume each parent request once, including under Strict Mode.
  const consumedForkRef = useRef<string | null>(null)

  useEffect(() => {
    // Clearing the request allows the same source to be forked again.
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
