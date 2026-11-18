import { api } from '../../api'
import { MenuItem } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import type { AgentDevice } from '../../api'

/**
 * A computer's switch for installing updates by itself when idle, the same one as Settings >
 * Updates on a Desktop; the computer keeps it. Shown once it reports one, to whoever manages it.
 */
export function AutoInstallMenuItem({
  device,
  teamId,
  onChanged,
}: {
  device: AgentDevice
  teamId: string
  onChanged: () => void
}) {
  if (device.autoInstall === undefined) return null

  return (
    <MenuItem
      selected={device.autoInstall}
      onClick={() =>
        void api
          .deviceSetAutoInstall(device.deviceId, teamId, !device.autoInstall)
          .then(onChanged, (err: unknown) => {
            toast.apiError(t('Could not change automatic updates'), err)
          })
      }
    >
      {t('Install updates automatically')}
    </MenuItem>
  )
}
