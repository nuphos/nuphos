import { useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import { BoxAccessFields } from './BoxAccessFields'
import { useBoxAccessChoice } from './useBoxAccessChoice'

import type { AgentDevice } from '../../api'

/** Change who in the team may use a Box: its admins only, everyone, or specific people. */
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
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try {
      await api.boxSetAccess(device.deviceId, teamId, choice.payload())
      onSaved()
      onClose()
    } catch (error) {
      toast.apiError('Could not change who can use this computer', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Who can use ${device.label}`}
      description="People who lose access have their open agents on this computer closed."
      width={560}
      footer={
        <div className="flex justify-end gap-2 px-5 py-3">
          <Button size="sm" variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="p-5">
        <BoxAccessFields teamId={teamId} choice={choice} />
      </div>
    </Modal>
  )
}
