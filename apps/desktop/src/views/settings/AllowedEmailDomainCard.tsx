import { faAt } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'

import type { AtlasTeam } from '../../types'

// Workspace discovery by email domain: when enabled, anyone who signs in with
// a verified email on the workspace's allowed domain is offered membership.
// The domain is always the acting admin's own email domain (enforced by the
// backend too) — it is never typed in free-form.
export function AllowedEmailDomainCard({
  team,
  userEmail,
  onTeamUpdated,
}: {
  team: AtlasTeam
  userEmail: string
  onTeamUpdated: (team: AtlasTeam) => void
}) {
  const isAdmin = team.role === 'ADMINISTRATOR'
  const storedDomains = team.allowedEmailDomains ?? []
  const enabled = storedDomains.length > 0
  const userDomain = userEmail.includes('@')
    ? userEmail.slice(userEmail.lastIndexOf('@') + 1).toLowerCase()
    : ''
  // When disabled, previewing the viewer's own domain only makes sense for an
  // admin (it's the domain that WOULD be enabled); for other members it would
  // imply the workspace is tied to their domain when it isn't.
  const displayDomains = enabled ? storedDomains : isAdmin && userDomain ? [userDomain] : []
  const [saving, setSaving] = useState(false)

  async function toggle(next: boolean) {
    if (saving || !isAdmin) return
    setSaving(true)
    try {
      const updated = await api.atlasSetTeamEmailDomainDiscovery(team.id, next)

      onTeamUpdated(updated)
    } catch (err) {
      toast.apiError('Could not update allowed email domains', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-10">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-main">Allowed email domains</h2>
        <p className="mt-1 text-[13px] text-tertiary">
          Let anyone who signs in with a verified email on your company domain discover and join
          this workspace. Public email providers (like gmail.com) can't be used.
        </p>
      </div>

      <div className="flex items-center gap-4 rounded-lg border border-zGray-800/70 bg-surface px-4 py-3.5">
        <FontAwesomeIcon icon={faAt} className="w-3.5 h-3.5 flex-shrink-0 text-tertiary" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[12.5px] text-main truncate">
            {displayDomains.map((domain) => `@${domain}`).join(', ') || '—'}
          </div>
          <div className="mt-0.5 text-[12px] text-tertiary">
            {enabled
              ? 'Teammates on this domain can join this workspace.'
              : isAdmin
                ? 'Your email domain, taken from your account.'
                : 'Disabled for this workspace.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? 'Disable domain discovery' : 'Enable domain discovery'}
          onClick={() => void toggle(!enabled)}
          disabled={!isAdmin || saving}
          className={clsx(
            'w-9 h-5 rounded-full transition-colors flex-shrink-0 flex items-center p-0.5',
            enabled ? 'bg-zViolet-500 justify-end' : 'bg-zGray-700 justify-start',
            (!isAdmin || saving) && 'opacity-50 cursor-not-allowed',
          )}
          title={
            !isAdmin
              ? 'Only workspace administrators can change this'
              : enabled
                ? 'Disable'
                : 'Enable'
          }
        >
          <span className="block w-4 h-4 rounded-full bg-white" />
        </button>
      </div>
    </div>
  )
}
