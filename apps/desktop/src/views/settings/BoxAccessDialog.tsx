import { useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { toast } from '../../components/ui/toast'
import { memberDisplayName, useTeamMembers } from '../../lib/bindingAccess'

import { accessPayload } from './boxPresentation'

import type { AgentDevice } from '../../api'

function Option({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-main">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      {label}
    </label>
  )
}

/** Choose who in the team may use a Box: everyone, or only the members picked here. */
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
  // Admins always use and manage a Box, so they are not offered.
  const members = useTeamMembers(teamId).filter((member) => member.role !== 'ADMINISTRATOR')
  const [everyone, setEveryone] = useState(device.box?.access?.everyone ?? false)
  const [chosen, setChosen] = useState(() => new Set(device.box?.access?.userIds ?? []))
  const [saving, setSaving] = useState(false)
  const toggle = (id: string) =>
    setChosen((previous) => {
      const next = new Set(previous)

      if (!next.delete(id)) next.add(id)

      return next
    })
  const save = async () => {
    setSaving(true)
    try {
      await api.boxSetAccess(device.deviceId, teamId, accessPayload(everyone, chosen))
      onSaved()
      onClose()
    } catch (error) {
      toast.apiError('Could not change who can use this Box', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Who can use ${device.label}`}
      description="Team admins can always use and manage this Box."
    >
      <div className="space-y-3 p-5">
        <Option
          label="Everyone in the team"
          checked={everyone}
          onToggle={() => setEveryone(true)}
        />
        <Option
          label="Only selected members"
          checked={!everyone}
          onToggle={() => setEveryone(false)}
        />
        {!everyone && (
          <ul className="max-h-60 space-y-1.5 overflow-y-auto pl-6">
            {members.map((member) => (
              <li key={member.id}>
                <Option
                  label={memberDisplayName(member)}
                  checked={chosen.has(member.id)}
                  onToggle={() => toggle(member.id)}
                />
              </li>
            ))}
            {members.length === 0 && (
              <li className="text-[12px] text-tertiary">Everyone else in the team is an admin.</li>
            )}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
