import { useCallback, useMemo } from 'react'

import { api } from '../../../api'

import {
  defaultCredentialAccess,
  normalizeCredentialAccess,
  credentialOptionsLoaded,
  pruneCredentialAccessToOptions,
} from './credentialAccess'
import { includeBoundOnpremCredential } from './credentialRequest'
import { transcriptSignature } from './persistence'
import { toPersistedMessages } from './toUiMessages'

import type { PanelCtx } from './ctx'
import type { Tab } from './model'
import type { AgentCredentialSelection } from '../../../api'

type Acc = Pick<
  PanelCtx,
  | 'activeTab'
  | 'credentialOptions'
  | 'credentialOptionsRef'
  | 'credentialSyncInFlightRef'
  | 'credentialSyncTimersRef'
  | 'draftCredentialAccess'
  | 'draftCredentialTouched'
  | 'kubeContext'
  | 'lastSyncedRef'
  | 'kubeContextRef'
  | 'refreshHistory'
  | 'setCredentialsSaving'
  | 'teamId'
>

export function usePanelTranscripts(acc: Acc) {
  const {
    activeTab,
    credentialOptions,
    credentialOptionsRef,
    credentialSyncInFlightRef,
    credentialSyncTimersRef,
    draftCredentialAccess,
    draftCredentialTouched,
    kubeContext,
    lastSyncedRef,
    kubeContextRef,
    refreshHistory,
    setCredentialsSaving,
    teamId,
  } = acc

  const syncTranscriptNow = useCallback(
    (tab: Tab) => {
      if (tab.readOnly || tab.foreign) return
      // Slack-bound conversations are server-authoritative: the backend
      // rebuilds each turn's transcript from the store, and a tab that missed
      // a Slack-side exchange would delete those messages if it synced its own
      // view here (the PUT has delete-absent semantics).
      if (tab.slackThread) return
      if (tab.messages.length === 0) return
      // Runtime-owned turns are persisted by the backend after their terminal
      // frame. A live renderer snapshot is necessarily partial and used to
      // race that write, allowing either side's stale full-transcript PUT to
      // delete a just-finished neighboring turn.
      if (tab.streaming && tab.messages.at(-1)?.turnOrigin === 'autonomous') return
      const signature = transcriptSignature(tab)

      if (lastSyncedRef.current.get(tab.sessionId) === signature) return
      lastSyncedRef.current.set(tab.sessionId, signature)
      void api
        .agentSyncConversationTranscript({
          sessionId: tab.sessionId,
          agentRuntime: tab.agentRuntime,
          runtimeId: tab.runtimeId,
          teamId,
          title: tab.title,
          messages: toPersistedMessages(tab.messages),
          baseIndex: tab.historyBaseIndex,
        })
        .then(() => {
          if (!tab.streaming) void refreshHistory()
        })
        .catch((err: unknown) => {
          console.warn('[agent] failed to sync transcript', err)
          lastSyncedRef.current.delete(tab.sessionId)
        })
    },
    [refreshHistory, teamId],
  )

  const defaultCredentialAccessValue = useMemo(
    () => defaultCredentialAccess(credentialOptions),
    [credentialOptions],
  )
  const newConversationCredentialAccess = includeBoundOnpremCredential(
    draftCredentialTouched ? draftCredentialAccess : defaultCredentialAccessValue,
    credentialOptions,
    kubeContext,
  )

  // Normalize so legacy tabs/snapshots persisted before a field existed (e.g.
  // `zeaburIds`) don't reach the selector with a missing array and crash on
  // `.length`. Then prune any selected ids that are no longer in the current
  // options, so a credential revoked/removed since it was picked stops showing
  // as selected once the options list refreshes. Skip pruning until options
  // have actually loaded (sentinel === EMPTY) to avoid transiently blanking a
  // restored selection while the list is still being fetched.
  const normalizedCredentialAccess = includeBoundOnpremCredential(
    normalizeCredentialAccess(activeTab?.credentialAccess ?? newConversationCredentialAccess),
    credentialOptions,
    kubeContext,
  )
  const effectiveCredentialAccess = credentialOptionsLoaded(credentialOptions)
    ? pruneCredentialAccessToOptions(normalizedCredentialAccess, credentialOptions)
    : normalizedCredentialAccess

  // What actually goes on the wire: the stored selection pruned to the current
  // options, so a deleted connector's id is not sent or persisted again.
  const sendableCredentialAccess = useCallback(
    (access: AgentCredentialSelection): AgentCredentialSelection => {
      const options = credentialOptionsRef.current

      if (!credentialOptionsLoaded(options)) return access

      return pruneCredentialAccessToOptions(
        includeBoundOnpremCredential(
          normalizeCredentialAccess(access),
          options,
          kubeContextRef.current,
        ),
        options,
      )
    },
    [credentialOptionsRef, kubeContextRef],
  )

  const refreshCredentialSaving = useCallback(() => {
    setCredentialsSaving(
      credentialSyncTimersRef.current.size > 0 || credentialSyncInFlightRef.current > 0,
    )
  }, [])

  return {
    syncTranscriptNow,
    newConversationCredentialAccess,
    effectiveCredentialAccess,
    sendableCredentialAccess,
    refreshCredentialSaving,
  }
}
