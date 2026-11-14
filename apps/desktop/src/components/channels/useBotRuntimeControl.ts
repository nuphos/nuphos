import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { useAccountLabelledInstances } from '../../hooks/useAccountLabelledInstances'
import { useRuntimeInstances } from '../../hooks/useRuntimeInstances'
import { useRuntimeQuotas } from '../../hooks/useRuntimeQuotas'
import { queryKeys } from '../../lib/query/keys'
import { runtimeTurnActive } from '../../lib/runtimeExecution'
import { useSessionRuntimeControl } from '../agent/panel/conversationRuntimeControl'

import type { AgentConversationDetail } from '../../api'
import type { RuntimeExecution } from '../../lib/runtimeExecution'
import type { UserInfo } from '../../types'

/** The Bot's actual task, never a new-chat default or the channel's runtime. */
export function useBotRuntimeControl(
  teamId: string,
  botId: string | undefined,
  owned: boolean,
  user: UserInfo,
  runtimeState: RuntimeExecution | undefined,
  refresh: () => void,
) {
  const client = useQueryClient()
  const catalog = useRuntimeInstances(botId ? teamId : undefined)
  const instances = useAccountLabelledInstances(catalog.instances)
  const quotas = useRuntimeQuotas(botId ? teamId : undefined)
  const [detail, setDetail] = useState<AgentConversationDetail | null>(null)
  const [movingTo, setMovingTo] = useState<string>()

  useEffect(() => {
    if (!botId || !owned) return
    let alive = true
    const load = () =>
      void api
        .agentGetConversation(botId, teamId, { tail: 1, messages: 'omit', runtimeState: 'omit' })
        .then((next) => {
          if (alive) setDetail(next)
        })
        .catch((error: unknown) => console.warn('[bot-chat] could not load runtime', error))

    load()
    window.addEventListener('nuphos:conversation-runtime-moved', load)

    return () => {
      alive = false
      window.removeEventListener('nuphos:conversation-runtime-moved', load)
    }
  }, [teamId, botId, owned])

  const current = owned && detail?.sessionId === botId ? detail : null
  const control = useSessionRuntimeControl({
    teamId,
    currentUser: user,
    isTeamAdmin: false,
    runtimeInstances: instances,
    runtimeInstancesLoading: catalog.loading,
    runtimeInstancesError: catalog.error,
    runtimeQuotas: quotas,
    onOpenAgentSettings: undefined,
    activeTab: current
      ? {
          id: current.sessionId,
          sessionId: current.sessionId,
          agentRuntime: current.agentRuntime,
          runtimeId: current.runtimeId,
          runtimeLabel: current.runtimeLabel,
          movingTo,
          readOnly: current.readOnly,
          foreign: false,
          streaming: runtimeTurnActive(runtimeState),
        }
      : null,
    update: (patch) => {
      setMovingTo(patch.movingTo)
      setDetail((previous) =>
        previous && previous.sessionId === botId ? { ...previous, ...patch } : previous,
      )
    },
    refreshHistory: async () => {
      refresh()
      await client.invalidateQueries({ queryKey: queryKeys.agentSessions(teamId) })
    },
  })

  return control ? { ...control, quiet: true } : undefined
}
