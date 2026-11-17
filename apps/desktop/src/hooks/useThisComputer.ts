import { useMemo } from 'react'

import { thisComputerBadge } from '../views/settings/thisComputerPresentation'

import { useLocalRuntimeState } from './useLocalRuntimeState'

import type { ThisComputer } from '../lib/agentName'

/** This computer and its signed-in owner, so its own local agents can read as "Local". */
export function useThisComputer(): ThisComputer {
  const state = useLocalRuntimeState()
  const userId = state?.userId
  const deviceId = state?.deviceId

  return useMemo(() => (userId && deviceId ? { userId, deviceId } : null), [userId, deviceId])
}

/** The status the card of `thisComputer` shows from its own connection; undefined for others. */
export function useThisComputerBadge(thisComputer: boolean) {
  const badge = thisComputerBadge(useLocalRuntimeState()?.connection)

  return thisComputer ? badge : undefined
}
