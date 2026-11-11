import { useState } from 'react'

import { MenuItem } from '../../components/ui/menu'
import { t } from '../../i18n'

import { BoxResizeDialog } from './BoxResizeDialog'
import { canResize } from './boxResizePresentation'
import { useBoxRestart } from './boxRestartStore'

import type { AgentDevice } from '../../api'

/** The ⋯ menu's Resize item and the dialog it opens; no item while the Box cannot be resized. */
export function useBoxResize(device: AgentDevice, teamId: string, onResized: () => void) {
  const [open, setOpen] = useState(false)
  const own = useBoxRestart(device.deviceId)
  const restarting =
    own !== undefined ||
    device.box?.updateStartedAt !== undefined ||
    device.box?.resizeStartedAt !== undefined

  return {
    item: canResize(device, restarting) ? (
      <MenuItem onClick={() => setOpen(true)}>{t('Resize…')}</MenuItem>
    ) : null,
    dialog: open ? (
      <BoxResizeDialog
        teamId={teamId}
        device={device}
        onClose={() => setOpen(false)}
        onResized={onResized}
      />
    ) : null,
  }
}
