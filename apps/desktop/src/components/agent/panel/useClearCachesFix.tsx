import { useState } from 'react'

import { canManage } from '../../../views/settings/agentPresentation'
import { boxState } from '../../../views/settings/boxPresentation'
import { ClearCachesConfirm } from '../../../views/settings/ComputerNotices'

import type { AgentDevice } from '../../../api'

/**
 * What the disk banner offers for the agent's computer: the Box card's own Clear caches and its
 * confirmation, opened where the user is. Only a running Box the viewer manages has one.
 */
export function useClearCachesFix(teamId: string, device: AgentDevice | undefined) {
  const [confirming, setConfirming] = useState(false)
  const clearable = device?.box !== undefined && canManage(device) && boxState(device) === 'running'

  return {
    clear: clearable ? () => setConfirming(true) : undefined,
    dialog: device && clearable && (
      <ClearCachesConfirm
        teamId={teamId}
        device={device}
        open={confirming}
        onClose={() => setConfirming(false)}
      />
    ),
  }
}
