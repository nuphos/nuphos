import { useReducer } from 'react'

import { useLocalRuntimeState } from '../../../hooks/useLocalRuntimeState'
import { useRuntimeInstances } from '../../../hooks/useRuntimeInstances'
import { useRuntimeQuotas } from '../../../hooks/useRuntimeQuotas'
import { useThisComputer } from '../../../hooks/useThisComputer'
import { defaultAgent, usable } from '../../../lib/agentName'
import { pendingLocalAgents } from '../../../lib/localAgentReady'

import {
  chooseAgent,
  newChatChoiceKey,
  readNewChatChoice,
  saveNewChatChoice,
} from './newChatChoice'

import type { NewChatChoice } from './newChatChoice'
import type { SessionConfigPick } from '../../../api/session-config-types'

const NO_PICK: SessionConfigPick = {}

export function useNewConversationRuntime(teamId?: string) {
  // One saved choice for every new chat, pane and restart of this team.
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const catalog = useRuntimeInstances(teamId)
  const runtimeQuotas = useRuntimeQuotas(teamId)
  const owner = useThisComputer()
  const localState = useLocalRuntimeState()
  const instances = teamId
    ? [...catalog.instances, ...pendingLocalAgents(localState, catalog.instances)]
    : catalog.instances
  const choice = readNewChatChoice(newChatChoiceKey(teamId))
  const best = defaultAgent(instances, owner, (instance) => {
    const windows = runtimeQuotas.get(instance.id)?.windows ?? []

    return windows.length ? Math.max(...windows.map((window) => window.usedPercent)) : undefined
  })
  // The saved agent stands while it is usable; otherwise the best agent, never none.
  const chosen = choice && instances.find((instance) => instance.id === choice.runtimeId)
  const selected = chosen && usable(chosen) ? chosen : best

  function save(next: NewChatChoice) {
    saveNewChatChoice(newChatChoiceKey(teamId), next)
    rerender()
  }

  function selectConversationRuntime(runtimeId: string) {
    save(chooseAgent(choice, runtimeId))
  }

  const selectedRuntimeId = selected?.id

  function pickNewConversationSessionConfig(pick: SessionConfigPick) {
    if (selectedRuntimeId) save({ runtimeId: selectedRuntimeId, pick })
  }

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
