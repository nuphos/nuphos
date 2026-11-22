import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api.ts'
import { t } from '../../i18n/index.ts'
import { refreshInputRequests } from '../../lib/inputRequestRefresh.ts'
import { queryClient } from '../../lib/query/client.ts'
import { queryKeys } from '../../lib/query/keys.ts'
import { announceSavedSelection } from '../../lib/savedCredentialSelection.ts'
import { EMPTY_CREDENTIAL_OPTIONS } from '../agent/panel/constants.ts'
import { storedConversationCredentialAccess } from '../agent/panel/conversationCredentialAccess.ts'
import {
  normalizeCredentialAccess,
  normalizeCredentialOptions,
} from '../agent/panel/credentialAccess.ts'
import { keepTaskSelection } from '../agent/panel/taskTranscript.ts'
import { toast } from '../ui/toast.ts'

import { listedConversation } from './channelShared.ts'

import type { AgentCredentialOptions, AgentCredentialSelection } from '../../api.ts'
import type { CredentialSelectorControl } from '../agent/panel/credentialSections'

type Held<T> = { botId: string; value: T }

/**
 * The credential picker of a Bot's chat: the Bot's own conversation selection,
 * since the Bot's turns run there. Absent until a Bot its viewer owns is known.
 * `unset` while the Bot has never been given a selection, so it runs with none.
 */
export function useBotCredentials(
  teamId: string,
  botId: string | undefined,
): (CredentialSelectorControl & { unset: boolean }) | undefined {
  // Both start from what is already known, so the picker is there from the first frame:
  // the team's options as any chat last loaded them, the selection as the sidebar listed it.
  const [options, setOptions] = useState<AgentCredentialOptions>(
    () =>
      queryClient.getQueryData<AgentCredentialOptions>(queryKeys.credentialOptions(teamId)) ??
      EMPTY_CREDENTIAL_OPTIONS,
  )
  // The stored selection and an unsaved change, each kept with the Bot it is for.
  // null is the Bot's own answer that it has none; the sidebar's copy never says so.
  const [stored, setStored] = useState<
    Held<Partial<AgentCredentialSelection> | null | undefined> | undefined
  >(() => {
    const listed = listedConversation(teamId, botId)

    return botId && listed ? { botId, value: listed.credentialAccess } : undefined
  })
  const keepOptions = useCallback(
    (loaded: AgentCredentialOptions) => {
      const next = normalizeCredentialOptions(loaded)

      queryClient.setQueryData(queryKeys.credentialOptions(teamId), next)
      setOptions(next)
    },
    [teamId],
  )
  const [draft, setDraft] = useState<Held<AgentCredentialSelection>>()
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  // Only the latest change's answer is kept when toggles overlap.
  const latest = useRef(0)

  const loadOptions = useCallback(async () => {
    try {
      keepOptions(await api.agentGetCredentialOptions(teamId))
    } catch (err) {
      console.warn('[bot-chat] failed to load credential options', err)
    }
  }, [teamId, keepOptions])

  useEffect(() => {
    if (!botId) return
    let alive = true

    Promise.all([
      api.agentGetCredentialOptions(teamId),
      api.agentGetConversation(botId, teamId, { tail: 1, runtimeState: 'omit' }),
    ])
      .then(([loaded, detail]) => {
        if (!alive) return
        keepOptions(loaded)
        setStored({ botId, value: detail.credentialAccess ?? null })
      })
      .catch((err: unknown) => console.warn('[bot-chat] failed to load credentials', err))

    return () => {
      alive = false
    }
  }, [teamId, botId, keepOptions])

  if (!botId || stored?.botId !== botId) return undefined

  return {
    options,
    value:
      draft?.botId === botId
        ? draft.value
        : storedConversationCredentialAccess(stored.value, options),
    unset: stored.value === null,
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
          const saved = normalizeCredentialAccess(result.credentialAccess)

          keepOptions(result.options)
          setStored({ botId, value: saved })
          setDraft(undefined)
          // The conversation may be a Task, open or read ahead: both show what was saved here.
          keepTaskSelection(queryClient, teamId, botId, saved)
          announceSavedSelection({ sessionId: botId, credentialAccess: saved })
          // Selecting a credential a question asked for answers it on the server.
          refreshInputRequests()
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
