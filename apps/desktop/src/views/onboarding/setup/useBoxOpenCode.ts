import { useEffect } from 'react'

import { useRuntimeInstances } from '../../../hooks/useRuntimeInstances'
import { useAgentDevices } from '../../settings/useAgentDevices'

import { boxOpenCode } from './agentSetup'

/**
 * The team's Box and its OpenCode, looked for again until it is listed: a new team's free Box
 * joins a few minutes after the workspace is made.
 */
export function useBoxOpenCode(teamId?: string) {
  const catalog = useRuntimeInstances(teamId)
  const list = useAgentDevices(() => 0, teamId ?? '', {
    teamId,
    enabled: Boolean(teamId),
  }).list
  const box = list?.devices.find((device) => device.box)
  const runtime = boxOpenCode(catalog.instances, list?.devices)
  const { refresh } = catalog

  useEffect(() => {
    if (!box || runtime) return
    const timer = setInterval(refresh, 5_000)

    return () => clearInterval(timer)
  }, [box, runtime, refresh])

  return { list, box, runtime }
}
