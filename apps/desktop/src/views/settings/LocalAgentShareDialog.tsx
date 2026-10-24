import clsx from 'clsx'
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { Avatar } from '../../components/Avatar'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { AppSelect } from '../../components/ui/select'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { memberDisplayName, useTeamMembers } from '../../lib/bindingAccess'

import {
  allowedLevels,
  effectiveShare,
  SHARE_LEVEL_DESCRIPTION,
  SHARE_LEVEL_LABEL,
  SHARE_RISK,
} from './localAgentSharingPresentation'

import type { LocalAgentShareState, LocalShareLevel } from '../../api/device-types'

/** Who in this team may run their own agents on this computer, and whether the owner approves each. */
export function LocalAgentShareDialog({
  teamId,
  deviceId,
  deviceLabel,
  currentUserId,
  state,
  onClose,
  onSaved,
}: {
  teamId: string
  deviceId: string
  deviceLabel: string
  currentUserId: string
  state: LocalAgentShareState
  onClose: () => void
  onSaved: (next: LocalAgentShareState) => void
}) {
  const members = useTeamMembers(teamId).filter((member) => member.id !== currentUserId)
  // A level the ceiling has since lowered opens at the ceiling, which is what applies.
  const [level, setLevel] = useState<LocalShareLevel>(
    () => effectiveShare(state.share, state.ceiling).level,
  )
  const [everyone, setEveryone] = useState(state.share.everyone)
  const [chosen, setChosen] = useState(() => new Set(state.share.userIds))
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
      onSaved(await api.localShareSet(deviceId, teamId, { level, everyone, userIds: [...chosen] }))
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
      title={`Share ${deviceLabel}`}
      description="Teammates you pick can place their own agents on this computer’s local runtime. They cannot open its terminal or files, sign in its runtimes, or use local exec."
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
      <div className="space-y-4 p-5">
        <div className="space-y-1.5">
          <AppSelect
            ariaLabel="How far to share this computer"
            value={level}
            disabled={saving}
            onValueChange={(next) => setLevel(next as LocalShareLevel)}
            options={allowedLevels(state.ceiling).map((value) => ({
              value,
              label: SHARE_LEVEL_LABEL[value],
            }))}
          />
          <p className="text-[12px] text-tertiary">{SHARE_LEVEL_DESCRIPTION[level]}</p>
          {state.ceiling !== 'full' && (
            <p className="text-[12px] text-tertiary">
              {state.ceiling === 'off'
                ? 'Your team’s administrators have turned off sharing your own computer.'
                : 'Your team’s administrators allow sharing only with your approval of each agent.'}
            </p>
          )}
        </div>

        {level !== 'off' && (
          <>
            <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-[12px] leading-snug text-warning">
              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {SHARE_RISK}
            </div>
            <div className="rounded-xl border border-zGray-800">
              <label className="flex items-center justify-between gap-3 px-3 py-2.5 text-[12.5px] text-main">
                Everyone in this team, including people who join later
                <Switch
                  checked={everyone}
                  label="Share with everyone in this team"
                  onChange={setEveryone}
                />
              </label>
              {!everyone && (
                <ul className="max-h-60 space-y-0.5 overflow-y-auto border-t border-zGray-800 p-1.5">
                  {members.map((member) => {
                    const name = memberDisplayName(member)
                    const checked = chosen.has(member.id)

                    return (
                      <li key={member.id}>
                        <label
                          className={clsx(
                            'flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5',
                            checked ? 'bg-zViolet-accent/10' : 'hover:bg-zGray-800/50',
                          )}
                        >
                          <Avatar
                            src={member.avatarURL}
                            name={name}
                            size={24}
                            className="rounded-full"
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-main">
                            {name}
                          </span>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggle(member.id)}
                            aria-label={`Share with ${name}`}
                          />
                        </label>
                      </li>
                    )
                  })}
                  {members.length === 0 && (
                    <li className="px-2 py-1.5 text-[12px] text-tertiary">
                      No one else is in this team yet.
                    </li>
                  )}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
