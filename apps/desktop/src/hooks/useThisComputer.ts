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
