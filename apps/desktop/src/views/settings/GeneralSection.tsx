import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useState } from 'react'

import { api } from '../../api'
import { Avatar } from '../../components/Avatar'
import { toast } from '../../components/ui/toast'

import { AllowedEmailDomainCard } from './AllowedEmailDomainCard'
import { DangerZone } from './DangerZone'
import { Field, SectionHeader } from './shared'
import { inputClasses } from './styles'

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
      toast.error('Could not copy team ID', 'Clipboard was blocked.')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Copy team ID"
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
  const [icon, setIcon] = useState(team?.avatarUrl ?? '')
  const [submitting, setSubmitting] = useState(false)

  const dirty = team
    ? name.trim() !== (team.name ?? '') || icon.trim() !== (team.avatarUrl ?? '')
    : false

  async function submit(e: FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()

    if (!team || !trimmedName || submitting) return
    setSubmitting(true)
    try {
      const updated = await api.atlasUpdateTeam(team.id, {
        name: trimmedName,
        avatarUrl: icon.trim(),
      })

      onTeamUpdated(updated)
      toast.success('Workspace updated')
    } catch (err) {
      toast.apiError('Could not update workspace', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <SectionHeader title="General" description="Manage your workspace's name and icon." />
      {team ? (
        <>
          <form onSubmit={(e) => void submit(e)} className="space-y-5">
            <div className="flex items-center gap-4">
              <Avatar
                key={`${team.id}:${icon}`}
                src={icon}
                name={name || team.name || 'Workspace'}
                size={56}
                className="rounded-lg !shadow-none"
              />
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-main truncate">
                  {name || team.name || 'Workspace'}
                </div>
                <CopyableTeamId id={team.id} />
              </div>
            </div>

            <Field label="Name">
              <input
                type="text"
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClasses}
              />
            </Field>

            <Field label="Icon URL" hint="A square image works best.">
              <input
                type="url"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="https://example.com/icon.png"
                className={inputClasses}
              />
            </Field>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={!name.trim() || !dirty || submitting}
                className={clsx(
                  'h-9 px-4 rounded-md text-[13px] font-medium text-white transition-colors',
                  name.trim() && dirty && !submitting
                    ? 'bg-zViolet-500 hover:bg-zViolet-400'
                    : 'bg-zGray-700 text-tertiary cursor-default',
                )}
              >
                {submitting ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>

          <AllowedEmailDomainCard team={team} userEmail={userEmail} onTeamUpdated={onTeamUpdated} />

          <DangerZone team={team} onTeamRemoved={onTeamRemoved} />
        </>
      ) : (
        <div className="text-[13px] text-tertiary">No workspace selected.</div>
      )}
    </div>
  )
}
