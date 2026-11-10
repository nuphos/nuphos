import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { EMPTY_CREDENTIAL_OPTIONS } from '../agent/panel/constants'
import {
  normalizeCredentialAccess,
  normalizeCredentialOptions,
  reconcileStoredCredentialAccess,
} from '../agent/panel/credentialAccess'
import { toast } from '../ui/toast'

import type { AgentCredentialOptions, AgentCredentialSelection } from '../../api'
import type { CredentialSelectorControl } from '../agent/panel/credentialSections'

type Held<T> = { botId: string; value: T }

/**
 * The credential picker of a Bot's chat: the Bot's own conversation selection,
 * since the Bot's turns run there. Absent until a Bot its viewer owns is known.
 */
export function useBotCredentials(
  teamId: string,
  botId: string | undefined,
): CredentialSelectorControl | undefined {
  const [options, setOptions] = useState<AgentCredentialOptions>(EMPTY_CREDENTIAL_OPTIONS)
  // The stored selection and an unsaved change, each kept with the Bot it is for.
  const [stored, setStored] = useState<Held<Partial<AgentCredentialSelection> | null>>()
  const [draft, setDraft] = useState<Held<AgentCredentialSelection>>()
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  // Only the latest change's answer is kept when toggles overlap.
  const latest = useRef(0)

  const loadOptions = useCallback(async () => {
    try {
      setOptions(normalizeCredentialOptions(await api.agentGetCredentialOptions(teamId)))
    } catch (err) {
      console.warn('[bot-chat] failed to load credential options', err)
    }
  }, [teamId])

  useEffect(() => {
    if (!botId) return
    let alive = true

    Promise.all([
      api.agentGetCredentialOptions(teamId),
      api.agentGetConversation(botId, teamId, { tail: 1, runtimeState: 'omit' }),
    ])
      .then(([loaded, detail]) => {
        if (!alive) return
        setOptions(normalizeCredentialOptions(loaded))
        setStored({ botId, value: detail.credentialAccess ?? null })
      })
      .catch((err: unknown) => console.warn('[bot-chat] failed to load credentials', err))

    return () => {
      alive = false
    }
  }, [teamId, botId])

  if (!botId || stored?.botId !== botId) return undefined

  return {
    options,
    value:
      draft?.botId === botId ? draft.value : reconcileStoredCredentialAccess(stored.value, options),
    saving: saving || refreshing,
    onOpen: () => {
      setRefreshing(true)
      void loadOptions().finally(() => setRefreshing(false))
    },
    onChange: (next) => {
      const request = ++latest.current

      setDraft({ botId, value: next })
      setSaving(true)
      api
        .agentUpdateConversationCredentials({ sessionId: botId, teamId, credentialAccess: next })
        .then((result) => {
          if (latest.current !== request) return
          setOptions(normalizeCredentialOptions(result.options))
          setStored({ botId, value: normalizeCredentialAccess(result.credentialAccess) })
          setDraft(undefined)
        })
        .catch((err: unknown) => {
          if (latest.current !== request) return
          setDraft(undefined)
          toast.apiError(t('Failed to update credentials'), err)
        })
        .finally(() => {
          if (latest.current === request) setSaving(false)
        })
    },
  }
}
