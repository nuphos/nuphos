import { useCallback, useState } from 'react'

import { useLocalRuntimeState } from '../../../hooks/useLocalRuntimeState'
import { useRuntimeInstances } from '../../../hooks/useRuntimeInstances'
import { useRuntimeQuotas } from '../../../hooks/useRuntimeQuotas'
import { useThisComputer } from '../../../hooks/useThisComputer'
import { defaultAgent } from '../../../lib/agentName'
import { pendingLocalAgents } from '../../../lib/localAgentReady'

import type { SessionConfigPick } from '../../../api/session-config-types'

const NO_PICK: SessionConfigPick = {}

export function useNewConversationRuntime(teamId?: string) {
  const key = `nuphos.agent.runtimeInstance.${teamId ?? 'personal'}`
  const [choices, setChoices] = useState<Record<string, string>>({})
  // Model settings picked for the next new conversation, per agent.
  const [picks, setPicks] = useState<Record<string, SessionConfigPick>>({})
  const catalog = useRuntimeInstances(teamId)
  const runtimeQuotas = useRuntimeQuotas(teamId, catalog.instances)
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
  const best = defaultAgent(instances, owner, (instance) => {
    const windows = runtimeQuotas.get(instance.id)?.windows ?? []

    return windows.length ? Math.max(...windows.map((window) => window.usedPercent)) : undefined
  })
  // A choice made for this draft stands while it is usable; otherwise the best agent, never none.
  const chosen = selectedId ? instances.find((instance) => instance.id === selectedId) : undefined
  const selected = chosen?.status === 'active' && chosen.local?.signedIn !== false ? chosen : best

  function selectConversationRuntime(runtimeId: string) {
    setChoices((previous) => ({ ...previous, [key]: runtimeId }))
    try {
      localStorage.setItem(key, runtimeId)
    } catch {
      /* Keep the in-memory choice. */
    }
  }

  const selectedRuntimeId = selected?.id
  const pickNewConversationSessionConfig = useCallback(
    (pick: SessionConfigPick) => {
      if (selectedRuntimeId) setPicks((previous) => ({ ...previous, [selectedRuntimeId]: pick }))
    },
    [selectedRuntimeId],
  )

  return {
    newConversationRuntime: selected ?? null,
    newConversationSessionConfig: (selected && picks[selected.id]) ?? NO_PICK,
    pickNewConversationSessionConfig,
    runtimeInstances: instances,
    runtimeInstancesLoading: catalog.loading && instances.length === 0,
    runtimeInstancesError: catalog.error,
    selectConversationRuntime,
    runtimeQuotas,
  }
}
