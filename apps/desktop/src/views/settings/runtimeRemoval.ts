import { api } from '../../api'

import { localRemovalId } from './agentPresentation'

import type { RuntimeInstance } from '../../types/runtime'

/**
 * Removes a runtime the way its kind needs. A computer's agent goes through that computer
 * (the menu offers it only with a removal id); while the computer is offline it leaves the
 * workspace at once and the computer deletes it when it is back.
 */
export function removeRuntime(instance: RuntimeInstance, teamId: string): Promise<unknown> {
  const removalId = localRemovalId(instance)

  return instance.local && removalId
    ? api.boxRemoveAgent(
        instance.local.deviceId,
        teamId,
        removalId,
        instance.local.online === false,
      )
    : api.atlasRemoveRuntimeInstance(teamId, instance.id)
}
