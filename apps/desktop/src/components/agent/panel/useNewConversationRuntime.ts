import { useState } from 'react'

import { useLocalRuntimeState } from '../../../hooks/useLocalRuntimeState'
import { useRuntimeInstances } from '../../../hooks/useRuntimeInstances'
import { useRuntimeQuotas } from '../../../hooks/useRuntimeQuotas'
import { useThisComputer } from '../../../hooks/useThisComputer'
import { defaultAgent } from '../../../lib/agentName'
import { pendingLocalAgents } from '../../../lib/localAgentReady'

export function useNewConversationRuntime(teamId?: string) {
  const key = `nuphos.agent.runtimeInstance.${teamId ?? 'personal'}`
  const [choices, setChoices] = useState<Record<string, string>>({})
  const catalog = useRuntimeInstances(teamId)
  const runtimeQuotas = useRuntimeQuotas(teamId)
  const owner = useThisComputer()
  const localState = useLocalRuntimeState()
  const instances = teamId
    ? [...catalog.instances, ...pendingLocalAgents(localState, catalog.instances)]
    : catalog.instances
  let saved: string | null = null

  try {
    saved = localStorage.getItem(key)
  } catch {
    /* Storage is optional. */
  }
  const selectedId = choices[key] ?? saved
  // An unavailable saved choice requires a new selection; do not silently
  // send a draft to another account just because its runtime disappeared.
  const selected = selectedId
    ? instances.find((instance) => instance.id === selectedId)
    : defaultAgent(instances, owner)

  function selectConversationRuntime(runtimeId: string) {
    setChoices((previous) => ({ ...previous, [key]: runtimeId }))
    try {
      localStorage.setItem(key, runtimeId)
    } catch {
      /* Keep the in-memory choice. */
    }
  }

  return {
    newConversationRuntime: selected ?? null,
    runtimeInstances: instances,
    runtimeInstancesLoading: catalog.loading && instances.length === 0,
    runtimeInstancesError: catalog.error,
    selectConversationRuntime,
    runtimeQuotas,
  }
}
