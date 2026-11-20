import { useMemo } from 'react'

import { useLocalRuntimeState } from './useLocalRuntimeState'

import type { ThisComputer } from '../lib/agentName'

/** This computer and its signed-in owner, so its own local agents can read as "Local". */
export function useThisComputer(): ThisComputer {
  const state = useLocalRuntimeState()
  const userId = state?.userId
  const deviceId = state?.deviceId

  return useMemo(() => (userId && deviceId ? { userId, deviceId } : null), [userId, deviceId])
}

/** This computer's own connection, which knows first why it is down; undefined for others. */
export function useThisComputerConnection(thisComputer: boolean) {
  const connection = useLocalRuntimeState()?.connection

  return thisComputer ? connection : undefined
}
