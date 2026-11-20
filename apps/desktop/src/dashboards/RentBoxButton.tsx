import { useState } from 'react'

import { Button } from '../components/ui/button'
import { t } from '../i18n'
import { AddAgentDialog } from '../views/settings/AddAgentDialog'
import { useAgentDevices } from '../views/settings/useAgentDevices'

/** #4168: no agent could run a panel. For someone who may rent a Box, the way to one. */
export function RentBoxButton({ teamId }: { teamId: string }) {
  const [open, setOpen] = useState(false)
  const devices = useAgentDevices(() => 0, teamId, { teamId }).list

  if (devices?.canCreateBox !== true) return null

  return (
    <>
      <Button size="sm" type="button" onClick={() => setOpen(true)}>
        {t('Rent a computer from Nuphos')}
      </Button>
      {open && (
        <AddAgentDialog
          teamId={teamId}
          onClose={() => setOpen(false)}
          onBoxCreated={() => setOpen(false)}
        />
      )}
    </>
  )
}
