import { useEffect, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED, useRuntimeInstances } from '../../hooks/useRuntimeInstances'

import { BOX_CREATING_POLL_MS, boxAgents, boxSetupPhase } from './boxPresentation'
import { useAgentDevices } from './useAgentDevices'

/**
 * Makes a Box and waits for its agents to join the team. `deviceId` is the Box this flow made,
 * owned by the caller so it survives going back a step.
 */
export function useBoxSetup(
  teamId: string,
  deviceId: string | null,
  onCreated: (deviceId: string) => void,
) {
  const [creating, setCreating] = useState(false)
  const { instances } = useRuntimeInstances(teamId)
  const agents = deviceId ? boxAgents(deviceId, instances) : []
  const { list } = useAgentDevices(
    (next) =>
      boxSetupPhase(deviceId, next.devices, agents) === 'starting' ? BOX_CREATING_POLL_MS : 0,
    deviceId ?? '',
    { teamId },
  )
  const devices = deviceId ? (list?.devices ?? null) : null
  const phase = boxSetupPhase(deviceId, devices, agents)
  const joined = devices?.some((device) => device.deviceId === deviceId && device.online)

  // The team's list refreshes every 10 s on its own; ask now once the Box's agent connects.
  useEffect(() => {
    if (joined) window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
  }, [joined])

  async function create(label?: string) {
    if (creating) return
    setCreating(true)
    try {
      onCreated((await api.boxCreate(label, teamId)).deviceId)
    } catch (error) {
      toast.apiError('Could not create Box', error)
    } finally {
      setCreating(false)
    }
  }

  return { phase, agents, creating, create }
}
