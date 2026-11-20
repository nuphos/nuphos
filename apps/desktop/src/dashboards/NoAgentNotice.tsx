import { useState } from 'react'

import { Button } from '../components/ui/button'
import { t } from '../i18n'
import { AddAgentDialog } from '../views/settings/AddAgentDialog'
import { useAgentDevices } from '../views/settings/useAgentDevices'

import { noAgentNotice } from './panelDisplay'

/**
 * #4168: no agent could run a panel. Someone who may rent a computer from Nuphos is told so
 * and given the way to one; everyone else reads `message`, which says to ask a team admin.
 */
export function NoAgentNotice({ teamId, message }: { teamId: string; message: string }) {
  const [open, setOpen] = useState(false)
  const devices = useAgentDevices(() => 0, teamId, { teamId }).list
  const notice = noAgentNotice(message, devices?.canCreateBox === true)

  if (!notice.offerComputer) return notice.text

  return (
    <>
      <span>{notice.text}</span>
      <div>
        <Button size="sm" type="button" onClick={() => setOpen(true)}>
          {t('Rent a computer from Nuphos')}
        </Button>
      </div>
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
