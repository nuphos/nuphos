import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { adminName } from '../../components/agent/panel/agentSignInModel'
import { Avatar } from '../../components/Avatar'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { AppSelect } from '../../components/ui/select'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { t } from '../../i18n'
import { memberDisplayName, useTeamMembers } from '../../lib/bindingAccess'

import {
  allowedLevels,
  effectiveShare,
  SHARE_LEVEL_DESCRIPTION,
  SHARE_LEVEL_LABEL,
  sharingOffText,
} from './localAgentSharingPresentation'
import { SharedComputerNotice } from './SharedComputerNotice'

import type { LocalAgentShareState, LocalShareLevel } from '../../api/device-types'

/** Who in this team may run their own agents on the viewer's own computer, wherever the viewer is. */
export function LocalAgentShareDialog({
  teamId,
  device,
  onClose,
  onSaved,
}: {
  teamId: string
  device: { deviceId: string; label: string }
  onClose: () => void
  onSaved: () => void
}) {
  const [state, setState] = useState<LocalAgentShareState | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const live = { current: true }

    api
      .localShareGet(device.deviceId, teamId)
      .then((next) => live.current && setState(next))
      .catch((error: unknown) => {
        if (!live.current) return
        toast.apiError(t('Couldn’t load sharing for {device}.', { device: device.label }), error)
        setFailed(true)
      })

    return () => {
      live.current = false
    }
  }, [device.deviceId, device.label, teamId])

  useEffect(() => {
    if (failed) onClose()
  }, [failed, onClose])

  return (
    state && (
      <ShareForm
        teamId={teamId}
        deviceId={device.deviceId}
        deviceLabel={device.label}
        state={state}
        onClose={onClose}
        onSaved={onSaved}
      />
    )
  )
}

function ShareForm({
  teamId,
  deviceId,
  deviceLabel,
  state,
  onClose,
  onSaved,
}: {
  teamId: string
  deviceId: string
  deviceLabel: string
  state: LocalAgentShareState
  onClose: () => void
  onSaved: () => void
}) {
  const currentUserId = useCurrentUser()?.id
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
      await api.localShareSet(deviceId, teamId, { level, everyone, userIds: [...chosen] })
      onSaved()
      onClose()
    } catch (error) {
      toast.apiError(t('Could not change who can use this computer'), error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Share {device}', { device: deviceLabel })}
      description={t('Choose the teammates who may use this computer and its runtimes.')}
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
        <div className="space-y-1.5">
          <AppSelect
            ariaLabel={t('How far to share this computer')}
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
                ? sharingOffText(adminName(members))
                : t(
                    'Your team’s administrators allow sharing only with your approval of each agent.',
                  )}
            </p>
          )}
        </div>

        {level !== 'off' && (
          <>
            <SharedComputerNotice />
            <div className="rounded-xl border border-zGray-800">
              <label className="flex items-center justify-between gap-3 px-3 py-2.5 text-[12.5px] text-main">
                {t('Everyone in this team, including people who join later')}
                <Switch
                  checked={everyone}
                  label={t('Share with everyone in this team')}
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
                            aria-label={t('Share with {name}', { name })}
                          />
                        </label>
                      </li>
                    )
                  })}
                  {members.length === 0 && (
                    <li className="px-2 py-1.5 text-[12px] text-tertiary">
                      {t('No one else is in this team yet.')}
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
