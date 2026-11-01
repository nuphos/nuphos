import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useState } from 'react'

import { api } from '../../api'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { AllowedEmailDomainCard } from './AllowedEmailDomainCard'
import { AvatarPicker } from './AvatarPicker'
import { DangerZone } from './DangerZone'
import { GoogleOAuthClientCard } from './GoogleOAuthClientCard'
import { LocalAgentSharingCeilingCard } from './LocalAgentSharingCeilingCard'
import { Field, SectionHeader } from './shared'
import { inputClasses } from './styles'
import { useAdminName } from './useAdminName'

import type { AtlasTeam } from '../../types'
import type { FormEvent } from 'react'

// Click-to-copy team id — needed verbatim for things like the AWS role trust
// policy's `sub` condition, so make it copyable instead of select-and-drag.
function CopyableTeamId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Local clipboard failure — never an atlas error, so hand-author it.
      toast.error(t('Could not copy team ID'), t('Clipboard was blocked.'))
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={t('Copy team ID')}
      className="group flex items-center gap-1.5 min-w-0 max-w-full text-[12.5px] text-tertiary hover:text-secondary transition-colors"
    >
      <span className="truncate font-mono">{id}</span>
      <FontAwesomeIcon
        icon={copied ? faCheck : faCopy}
        className={clsx(
          'w-3 h-3 flex-shrink-0',
          copied ? 'text-zViolet-accent' : 'opacity-0 group-hover:opacity-100 transition-opacity',
        )}
      />
    </button>
  )
}

export function GeneralSection({
  team,
  userEmail,
  onTeamUpdated,
  onTeamRemoved,
}: {
  team: AtlasTeam | undefined
  userEmail: string
  onTeamUpdated: (team: AtlasTeam) => void
  onTeamRemoved: (teamId: string) => void
}) {
  const [name, setName] = useState(team?.name ?? '')
  const [submitting, setSubmitting] = useState(false)

  const dirty = team ? name.trim() !== (team.name ?? '') : false
  // The backend lets administrators and editors rename the workspace or change its icon.
  const canEdit = team?.role !== 'VIEWER'
  const admin = useAdminName(team?.id, !canEdit)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()

    if (!team || !trimmedName || submitting) return
    setSubmitting(true)
    try {
      const updated = await api.atlasUpdateTeam(team.id, { name: trimmedName })

      onTeamUpdated(updated)
      toast.success(t('Workspace updated'))
    } catch (err) {
      toast.apiError(t('Could not update workspace'), err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <SectionHeader
        title={t('General')}
        description={t("Manage your workspace's name and icon.")}
      />
      {team ? (
        <>
          <form onSubmit={(e) => void submit(e)} className="space-y-5">
            {canEdit ? (
              <AvatarPicker
                key={team.id}
                src={team.avatarUrl}
                name={name || team.name || t('Workspace')}
                kind="icon"
                onUpload={async (image) =>
                  onTeamUpdated(await api.atlasSetTeamAvatar(team.id, image))
                }
                onRemove={async () => onTeamUpdated(await api.atlasSetTeamAvatar(team.id, null))}
              />
            ) : (
              <Avatar
                src={team.avatarUrl}
                name={team.name || t('Workspace')}
                size={64}
                className="rounded-lg !shadow-none"
              />
            )}

            <Field label={t('Name')}>
              {/* A viewer cannot rename the workspace: its name is text, not a field. */}
              {canEdit ? (
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClasses}
                />
              ) : (
                <p className="flex h-10 items-center text-[13px] text-main">{team.name}</p>
              )}
            </Field>

            <div>
              <span className="block text-[12.5px] font-medium text-secondary mb-1.5">
                {t('Team ID')}
              </span>
              <CopyableTeamId id={team.id} />
            </div>

            {canEdit ? (
              <div className="flex justify-end pt-1">
                <Button size="sm" type="submit" disabled={!name.trim() || !dirty || submitting}>
                  {submitting ? t('Saving…') : t('Save changes')}
                </Button>
              </div>
            ) : (
              <p className="text-[12px] text-tertiary">
                {admin
                  ? t('Ask {name} or an editor to change the name or icon.', { name: admin })
                  : t('Only administrators and editors can change the name or icon.')}
              </p>
            )}
          </form>

          <AllowedEmailDomainCard team={team} userEmail={userEmail} onTeamUpdated={onTeamUpdated} />
          <LocalAgentSharingCeilingCard team={team} onTeamUpdated={onTeamUpdated} />
          <GoogleOAuthClientCard team={team} />

          <DangerZone team={team} onTeamRemoved={onTeamRemoved} />
        </>
      ) : (
        <div className="text-[13px] text-tertiary">{t('No workspace selected.')}</div>
      )}
    </div>
  )
}
