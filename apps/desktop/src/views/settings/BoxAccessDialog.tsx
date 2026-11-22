import { useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { AccessHistory } from './AccessHistory'
import { accessSaveSteps } from './boxAccessPresentation'
import { BoxAccessFields } from './BoxAccessFields'
import { isOwner } from './boxPresentation'
import { BoxTerminalAccess } from './BoxTerminalAccess'
import { SharedComputerNotice } from './SharedComputerNotice'
import { useBoxAccessChoice } from './useBoxAccessChoice'

import type { AgentDevice } from '../../api'

/** Change who in the team may use a Box: no one else, everyone, or specific people. */
export function BoxAccessDialog({
  teamId,
  device,
  onClose,
  onSaved,
}: {
  teamId: string
  device: AgentDevice
  onClose: () => void
  onSaved: () => void
}) {
  const choice = useBoxAccessChoice(device.box?.access ?? { everyone: false, userIds: [] })
  const owner = isOwner(device)
  const savedTerminal = device.box?.useTerminal === true
  const [useTerminal, setUseTerminal] = useState(savedTerminal)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    let failed = ''

    try {
      for (const step of accessSaveSteps(
        owner && useTerminal !== savedTerminal ? useTerminal : undefined,
      )) {
        if (step === 'access') {
          failed = t('Could not change who can use this computer')
          await api.boxSetAccess(device.deviceId, teamId, choice.payload())
        } else {
          failed = t('Could not change who can open a terminal')
          await api.boxSetTerminalAccess(device.deviceId, teamId, useTerminal)
        }
      }
      onSaved()
      onClose()
    } catch (error) {
      toast.apiError(failed, error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Who can use {name}', { name: device.label })}
      description={t('People who lose access have their open tasks on this computer closed.')}
      width={560}
      footer={
        <div className="flex justify-end gap-2 px-5 py-3">
          <Button size="sm" variant="secondary" disabled={saving} onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? t('Saving…') : t('Save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <BoxAccessFields teamId={teamId} ownerUserId={device.ownerUserId} choice={choice} />
        {owner && (
          <BoxTerminalAccess checked={useTerminal} disabled={saving} onChange={setUseTerminal} />
        )}
        <SharedComputerNotice />
        <AccessHistory deviceId={device.deviceId} teamId={teamId} />
      </div>
    </Modal>
  )
}
