import { useState } from 'react'

import { useThisComputer } from '../../../hooks/useThisComputer'
import { t } from '../../../i18n'
import { isThisComputer } from '../../../lib/agentName'
import { canManage } from '../../../views/settings/agentPresentation'
import { boxState } from '../../../views/settings/boxPresentation'
import { boxRestartLabel } from '../../../views/settings/boxRestartPresentation'
import { boxRestarts } from '../../../views/settings/boxRestartStore'
import { outdatedNotice } from '../../../views/settings/computerOutdated'
import { useComputerUpdate } from '../../../views/settings/useComputerUpdate'
import { ConfirmDialog } from '../../ConfirmDialog'
import { toast } from '../../ui/toast'

import type { AgentDevice } from '../../../api'

/** The computer as its card's Update reads it; a Box restarting for an update offers none. */
function updateHost(device: AgentDevice | undefined, here: boolean, runtimeId: string | undefined) {
  const cloud = device?.box !== undefined
  // The backend notes a Box's update for every viewer until its host is back.
  const running =
    device !== undefined && boxState(device) === 'running' && !device.box?.updateStartedAt

  return {
    cloud,
    thisComputer: here,
    running,
    hostAgent: cloud && running && canManage(device) ? runtimeId : undefined,
  }
}

/**
 * What the out-of-date banner offers for the agent's computer: the computer card's own Update
 * and its confirmation, opened where the user is; otherwise the card's words for who updates it.
 */
export function useOutdatedFix(
  teamId: string,
  device: AgentDevice | undefined,
  /** The selected agent: any agent on a Box reads its host's update. */
  runtimeId: string | undefined,
  /** Reads the computer again, which then says its update has started. */
  onStarted: () => void,
) {
  const here = isThisComputer(
    useThisComputer(),
    device && { userId: device.ownerUserId, deviceId: device.deviceId },
  )
  const update = useComputerUpdate(teamId, device, updateHost(device, here, runtimeId))
  const [confirming, setConfirming] = useState(false)
  const version = device && update.version

  return {
    update: version === undefined ? undefined : () => setConfirming(true),
    hint: device?.box?.updateStartedAt
      ? boxRestartLabel('update')
      : device && outdatedNotice(device, here)?.hint,
    dialog: device && version !== undefined && (
      <ConfirmDialog
        open={confirming}
        {...update.confirm(version, device.label)}
        onConfirm={async () => {
          try {
            await update.request(device.deviceId, teamId)
            boxRestarts.start(device.deviceId, teamId, 'update', device.lastSeenAt)
            onStarted()
          } catch (error) {
            toast.apiError(t('Could not update computer'), error)
          }
        }}
        onClose={() => setConfirming(false)}
      />
    ),
  }
}
