import { useCallback, useMemo, useReducer } from 'react'

import { useLocalRuntimeState } from '../../../hooks/useLocalRuntimeState'
import { useRuntimeInstances } from '../../../hooks/useRuntimeInstances'
import { useRuntimeQuotas } from '../../../hooks/useRuntimeQuotas'
import { useThisComputer } from '../../../hooks/useThisComputer'
import { defaultAgent, usable } from '../../../lib/agentName'
import { pendingLocalAgents } from '../../../lib/localAgentReady'

import { chooseAgent, parseNewChatChoice } from './newChatChoice'

import type { NewChatChoice } from './newChatChoice'
import type { SessionConfigPick } from '../../../api/session-config-types'

const NO_PICK: SessionConfigPick = {}

export function useNewConversationRuntime(teamId?: string) {
  const key = `nuphos.agent.runtimeInstance.${teamId ?? 'personal'}`
  // The saved choice is the only state: every new chat, pane and restart reads it.
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const catalog = useRuntimeInstances(teamId)
  const runtimeQuotas = useRuntimeQuotas(teamId)
  const owner = useThisComputer()
  const localState = useLocalRuntimeState()
  const instances = teamId
    ? [...catalog.instances, ...pendingLocalAgents(localState, catalog.instances)]
    : catalog.instances
  let raw: string | null = null

  try {
    raw = localStorage.getItem(key)
  } catch {
    /* Storage is optional. */
  }
  const choice = useMemo(() => parseNewChatChoice(raw), [raw])
  const best = defaultAgent(instances, owner, (instance) => {
    const windows = runtimeQuotas.get(instance.id)?.windows ?? []

    return windows.length ? Math.max(...windows.map((window) => window.usedPercent)) : undefined
  })
  // The saved agent stands while it is usable; otherwise the best agent, never none.
  const chosen = choice && instances.find((instance) => instance.id === choice.runtimeId)
  const selected = chosen && usable(chosen) ? chosen : best

  const save = useCallback(
    (next: NewChatChoice) => {
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* Storage is optional. */
      }
      rerender()
    },
    [key],
  )

  function selectConversationRuntime(runtimeId: string) {
    save(chooseAgent(choice, runtimeId))
  }

  const selectedRuntimeId = selected?.id
  const pickNewConversationSessionConfig = useCallback(
    (pick: SessionConfigPick) => {
      if (selectedRuntimeId) save({ runtimeId: selectedRuntimeId, pick })
    },
    [save, selectedRuntimeId],
  )

  return {
    newConversationRuntime: selected ?? null,
    newConversationSessionConfig: (chosen === selected && choice?.pick) || NO_PICK,
    pickNewConversationSessionConfig,
    runtimeInstances: instances,
    runtimeInstancesLoading: catalog.loading && instances.length === 0,
    runtimeInstancesError: catalog.error,
    selectConversationRuntime,
    runtimeQuotas,
  }
}
