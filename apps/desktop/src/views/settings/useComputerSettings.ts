import { createElement, useState } from 'react'

import { ComputerSettingsDialog, ComputerSettingsMenuItem } from './ComputerSettingsDialog'

import type { AgentDevice } from '../../api'

/** The menu item and the dialog it opens, for a computer's row. */
export function useComputerSettings(device: AgentDevice, teamId: string, onChanged: () => void) {
  const [open, setOpen] = useState(false)
  // A new dialog each time it opens; the closed one stays until its close transition ends.
  const [opened, setOpened] = useState(0)

  return {
    menuItem: createElement(ComputerSettingsMenuItem, {
      device,
      onOpen: () => {
        setOpened((count) => count + 1)
        setOpen(true)
      },
    }),
    dialog: createElement(ComputerSettingsDialog, {
      key: opened,
      open,
      device,
      teamId,
      onClose: () => setOpen(false),
      onChanged,
    }),
  }
}
