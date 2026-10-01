import { useState } from 'react'

import { AddAgentDialog } from '../../../views/settings/AddAgentDialog'

/** The composer's "Add new agent": the dialog opens in place and selects what it added. */
export function useAddAgent(
  teamId: string | undefined,
  canAdd: boolean,
  select: (runtimeId: string) => void,
) {
  const [open, setOpen] = useState(false)

  return {
    dialog: open && teamId && (
      <AddAgentDialog teamId={teamId} onClose={() => setOpen(false)} onAdded={select} />
    ),
    control: canAdd && teamId ? { onAddAgent: () => setOpen(true) } : {},
  }
}
