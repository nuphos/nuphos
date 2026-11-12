import { useMemo } from 'react'

import { withAccountLabels } from '../lib/accountLabel.ts'

import { useLocalRuntimeState } from './useLocalRuntimeState.ts'

import type { RuntimeInstance } from '../types/runtime.ts'

/**
 * The catalog's agents as this computer shows them: its own ones labelled by account where it
 * holds more than one for a provider, and every other agent exactly as the catalog has it.
 */
export function useAccountLabelledInstances(instances: RuntimeInstance[]): RuntimeInstance[] {
  const state = useLocalRuntimeState()

  return useMemo(() => withAccountLabels(instances, state), [instances, state])
}
