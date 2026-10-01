import { useCallback, useEffect, useState } from 'react'

import { api } from '../api'
import { EMPTY_CREDENTIAL_OPTIONS } from '../components/agent/panel/constants'
import {
  normalizeCredentialOptions,
  reconcileStoredCredentialAccess,
} from '../components/agent/panel/credentialAccess'

import type { DashboardPanel } from './schema'
import type { AgentCredentialOptions, AgentCredentialSelection } from '../api'
import type { CredentialSelectorControl } from '../components/agent/panel/credentialSections'

/**
 * The panel's credential selection, edited with the conversation selector. A
 * panel with no stored selection shows what a new conversation would start
 * with; only a selection the user touched is sent on save.
 */
export function usePanelCredentials(teamId: string, panel: DashboardPanel | null | undefined) {
  const [options, setOptions] = useState<AgentCredentialOptions>(EMPTY_CREDENTIAL_OPTIONS)
  const [refreshing, setRefreshing] = useState(false)
  const [draft, setDraft] = useState<AgentCredentialSelection | null>(null)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      setOptions(normalizeCredentialOptions(await api.agentGetCredentialOptions(teamId)))
    } catch (err) {
      console.warn('[dashboards] failed to load credential options', err)
    } finally {
      setRefreshing(false)
    }
  }, [teamId])

  useEffect(() => {
    let alive = true

    api
      .agentGetCredentialOptions(teamId)
      .then((loaded) => {
        if (alive) setOptions(normalizeCredentialOptions(loaded))
      })
      .catch((err: unknown) => {
        console.warn('[dashboards] failed to load credential options', err)
      })

    return () => {
      alive = false
    }
  }, [teamId])

  const value = draft ?? reconcileStoredCredentialAccess(panel?.credentialAccess ?? null, options)
  const control: CredentialSelectorControl = {
    options,
    value,
    saving: refreshing,
    onOpen: () => void load(),
    onChange: setDraft,
  }

  return {
    control,
    usesDefault: draft === null && !panel?.credentialAccess,
    changedSelection: draft ?? undefined,
  }
}
