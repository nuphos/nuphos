import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Avatar } from '../../components/Avatar'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { AppSelect } from '../../components/ui/select'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { t } from '../../i18n'
import { memberDisplayName, useTeamMembers } from '../../lib/bindingAccess'

import { isOwner } from './boxPresentation'
import {
  accessChanged,
  ACCESS_ROLE_LABEL,
  initialRoles,
  roleOptions,
  shareRequest,
  shownRole,
} from './computerAccess'
import { SharedComputerNotice } from './SharedComputerNotice'

import type { AccessRole } from './computerAccess'
import type { AgentDevice, LocalAgentShareState } from '../../api/device-types'

/** Who in this team may use, or also manage, a person's computer: the owner names managers. */
export function LocalAgentShareDialog({
  teamId,
  device,
  onClose,
  onSaved,
}: {
  teamId: string
  device: Pick<AgentDevice, 'deviceId' | 'label' | 'access' | 'ownerUserId'>
  onClose: () => void
  onSaved: () => void
}) {
  // Each load replaces the form, so a reload after a refused save starts from what is stored now.
  const [state, setState] = useState<{ value: LocalAgentShareState; load: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const live = { current: true }

    api
      .localShareGet(device.deviceId, teamId)
      .then(
        (next) =>
          live.current &&
          setState((previous) => ({ value: next, load: (previous?.load ?? 0) + 1 })),
      )
      .catch((error: unknown) => {
        if (!live.current) return
        toast.apiError(t('Couldn’t load sharing for {device}.', { device: device.label }), error)
        setFailed(true)
      })

    return () => {
      live.current = false
    }
  }, [device.deviceId, device.label, teamId, revision])

  useEffect(() => {
    if (failed) onClose()
  }, [failed, onClose])

  return (
    state && (
      <ShareForm
        key={state.load}
        teamId={teamId}
        deviceId={device.deviceId}
        deviceLabel={device.label}
        owner={isOwner(device)}
        ownerUserId={device.ownerUserId}
        state={state.value}
        onClose={onClose}
        onSaved={onSaved}
        onStale={() => setRevision((value) => value + 1)}
      />
    )
  )
}

function ShareForm({
  teamId,
  deviceId,
  deviceLabel,
  owner,
  ownerUserId,
  state,
  onClose,
  onSaved,
  onStale,
}: {
  teamId: string
  deviceId: string
  deviceLabel: string
  /** Whether the viewer owns it: only the owner names managers. */
  owner: boolean
  ownerUserId?: string
  state: LocalAgentShareState
  onClose: () => void
  onSaved: () => void
  /** Loads access again after someone changed it while this form was open. */
  onStale: () => void
}) {
  const currentUserId = useCurrentUser()?.id
  // The owner is never in their own list.
  const members = useTeamMembers(teamId).filter(
    (member) => member.id !== currentUserId && member.id !== ownerUserId,
  )
  const [everyone, setEveryone] = useState(state.share.everyone)
  const [roles, setRoles] = useState(() => initialRoles(state.share, state.managerIds))
  const [saving, setSaving] = useState(false)
  const options = roleOptions(everyone, owner)
  const setRole = (id: string, role: AccessRole) =>
    setRoles((previous) => new Map(previous).set(id, role))
  const save = async () => {
    setSaving(true)
    try {
      await api.localShareSet(deviceId, teamId, shareRequest(roles, everyone, owner))
      onSaved()
      onClose()
    } catch (error) {
      if (accessChanged(error)) {
        toast.error(
          t('Access changed while you were editing'),
          t('Manage access now shows the latest. Make your change again.'),
        )
        onStale()
      } else toast.apiError(t('Could not change who can use this computer'), error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Share {device}', { device: deviceLabel })}
      description={t(
        'Choose who may use this computer. Managers can also add agents, rename it and let others use it.',
      )}
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
          <ul className="max-h-60 space-y-0.5 overflow-y-auto border-t border-zGray-800 p-1.5">
            {members.map((member) => {
              const name = memberDisplayName(member)
              const role = shownRole(roles.get(member.id), everyone)

              return (
                <li
                  key={member.id}
                  className={clsx(
                    'flex items-center gap-2.5 rounded-lg px-2 py-1.5',
                    role !== 'none' && 'bg-zViolet-accent/10',
                  )}
                >
                  <Avatar src={member.avatarURL} name={name} size={24} className="rounded-full" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-main">{name}</span>
                  {options.includes(role) ? (
                    <AppSelect
                      ariaLabel={t('Access for {name}', { name })}
                      size="sm"
                      className="w-32 shrink-0"
                      value={role}
                      disabled={saving}
                      onValueChange={(next) => setRole(member.id, next as AccessRole)}
                      options={options.map((value) => ({
                        value,
                        label: ACCESS_ROLE_LABEL[value],
                      }))}
                    />
                  ) : (
                    <span className="shrink-0 px-2 text-[12px] text-tertiary">
                      {ACCESS_ROLE_LABEL[role]}
                    </span>
                  )}
                </li>
              )
            })}
            {members.length === 0 && (
              <li className="px-2 py-1.5 text-[12px] text-tertiary">
                {t('No one else is in this team yet.')}
              </li>
            )}
          </ul>
        </div>
        {!owner && (
          <p className="text-[12px] text-tertiary">
            {t('Only the owner can choose who manages it.')}
          </p>
        )}
      </div>
    </Modal>
  )
}
