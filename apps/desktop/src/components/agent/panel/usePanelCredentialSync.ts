import { useCallback, useEffect, useState } from 'react'

import { api } from '../../../api'
import { toast } from '../../ui/toast'

import {
  EMPTY_CREDENTIAL_ACCESS,
  EMPTY_CREDENTIAL_OPTIONS,
  CREDENTIAL_SYNC_DEBOUNCE_MS,
} from './constants'
import {
  allCredentialAccess,
  normalizeCredentialOptions,
  credentialSelectionSignature,
  normalizeCredentialAccess,
} from './credentialAccess'
import { useCredentialOptionsFreshness } from './useCredentialOptionsFreshness'

import type { PanelCtx } from './ctx'
import type { AgentCredentialSelection } from '../../../api'

type Acc = Pick<
  PanelCtx,
  | 'activeTab'
  | 'credentialAccessRef'
  | 'credentialOptions'
  | 'credentialOptionsRequestRef'
  | 'credentialSyncInFlightRef'
  | 'credentialSyncTimersRef'
  | 'credentialSyncVersionsRef'
  | 'lastCredentialSyncedRef'
  | 'refreshCredentialSaving'
  | 'setCredentialOptions'
  | 'setCredentialsRefreshing'
  | 'setDraftCredentialAccess'
  | 'setDraftCredentialTouched'
  | 'setTabs'
  | 'teamId'
>

export function usePanelCredentialSync(acc: Acc) {
  const {
    activeTab,
    credentialAccessRef,
    credentialOptions,
    credentialOptionsRequestRef,
    credentialSyncInFlightRef,
    credentialSyncTimersRef,
    credentialSyncVersionsRef,
    lastCredentialSyncedRef,
    refreshCredentialSaving,
    setCredentialOptions,
    setCredentialsRefreshing,
    setDraftCredentialAccess,
    setDraftCredentialTouched,
    setTabs,
    teamId,
  } = acc

  // `quiet` refreshes run in the background, so they skip the picker's spinner.
  const refreshCredentialOptions = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!teamId) return
      const requestId = credentialOptionsRequestRef.current + 1

      credentialOptionsRequestRef.current = requestId
      if (!opts?.quiet) setCredentialsRefreshing(true)
      try {
        const options = await api.agentGetCredentialOptions(teamId)

        if (credentialOptionsRequestRef.current !== requestId) return
        setCredentialOptions(normalizeCredentialOptions(options))
      } catch (err) {
        console.warn('[agent] failed to refresh credential options', err)
      } finally {
        if (credentialOptionsRequestRef.current === requestId) {
          setCredentialsRefreshing(false)
        }
      }
    },
    [teamId],
  )

  // A team switch starts from an empty, untouched draft — the previous team's
  // connectors mean nothing here.
  const [credentialTeamId, setCredentialTeamId] = useState(teamId)

  if (teamId !== credentialTeamId) {
    setCredentialTeamId(teamId)
    setDraftCredentialAccess(EMPTY_CREDENTIAL_ACCESS)
    setDraftCredentialTouched(false)
    if (!teamId) {
      setCredentialOptions(EMPTY_CREDENTIAL_OPTIONS)
      setCredentialsRefreshing(false)
    }
  }

  useEffect(() => {
    if (!teamId) {
      credentialOptionsRequestRef.current += 1

      return
    }
    let alive = true

    api
      .agentGetCredentialOptions(teamId)
      .then((options) => {
        if (!alive) return
        setCredentialOptions(normalizeCredentialOptions(options))
      })
      .catch((err: unknown) => {
        console.warn('[agent] failed to load credential options', err)
        if (alive) {
          toast.apiError('Failed to load credential options', err)
          setCredentialOptions(EMPTY_CREDENTIAL_OPTIONS)
        }
      })

    return () => {
      alive = false
    }
  }, [teamId])

  useCredentialOptionsFreshness({ activeTab, credentialOptions, refreshCredentialOptions, setTabs })

  const updateCredentialSelection = useCallback(
    (next: AgentCredentialSelection) => {
      if (!activeTab) {
        setDraftCredentialTouched(true)
        setDraftCredentialAccess(next)

        return
      }
      credentialAccessRef.current.set(activeTab.sessionId, next)
      setTabs((prev) =>
        prev.map((tab) => (tab.id === activeTab.id ? { ...tab, credentialAccess: next } : tab)),
      )
      const sessionId = activeTab.sessionId
      const signature = credentialSelectionSignature(next)
      const existingTimer = credentialSyncTimersRef.current.get(sessionId)

      if (existingTimer) {
        clearTimeout(existingTimer)
        credentialSyncTimersRef.current.delete(sessionId)
      }
      if (lastCredentialSyncedRef.current.get(sessionId) === signature) {
        refreshCredentialSaving()

        return
      }

      const version = (credentialSyncVersionsRef.current.get(sessionId) ?? 0) + 1

      credentialSyncVersionsRef.current.set(sessionId, version)
      const timer = setTimeout(() => {
        credentialSyncTimersRef.current.delete(sessionId)
        credentialSyncInFlightRef.current += 1
        refreshCredentialSaving()
        const latest = credentialAccessRef.current.get(sessionId) ?? next
        const latestSignature = credentialSelectionSignature(latest)

        if (lastCredentialSyncedRef.current.get(sessionId) === latestSignature) {
          credentialSyncInFlightRef.current = Math.max(0, credentialSyncInFlightRef.current - 1)
          refreshCredentialSaving()

          return
        }
        void api
          .agentUpdateConversationCredentials({
            sessionId,
            teamId,
            credentialAccess: latest,
          })
          .then((result) => {
            if (credentialSyncVersionsRef.current.get(sessionId) !== version) return
            const resultAccess = normalizeCredentialAccess(result.credentialAccess)
            const resultOptions = normalizeCredentialOptions(result.options)
            const seen = allCredentialAccess(resultOptions)

            setCredentialOptions(resultOptions)
            credentialAccessRef.current.set(sessionId, resultAccess)
            lastCredentialSyncedRef.current.set(
              sessionId,
              credentialSelectionSignature(resultAccess),
            )
            setTabs((prev) =>
              prev.map((tab) =>
                tab.sessionId === sessionId
                  ? { ...tab, credentialAccess: resultAccess, credentialOptionsSeen: seen }
                  : tab,
              ),
            )
          })
          .catch((err: unknown) => {
            console.warn('[agent] failed to update conversation credentials', err)
          })
          .finally(() => {
            credentialSyncInFlightRef.current = Math.max(0, credentialSyncInFlightRef.current - 1)
            refreshCredentialSaving()
          })
      }, CREDENTIAL_SYNC_DEBOUNCE_MS)

      credentialSyncTimersRef.current.set(sessionId, timer)
      refreshCredentialSaving()
    },
    [activeTab, refreshCredentialSaving, teamId],
  )

  return { refreshCredentialOptions, updateCredentialSelection }
}
