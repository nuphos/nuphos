import { AtSign as AtSignIcon } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { UiIcon } from '../../components/ui/ui-icon'
import { t } from '../../i18n'

import { AdminOnlyHint } from './shared'

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
  // The backend owns the public-provider list and says whether the admin's own domain is on it.
  const publicDomain = isAdmin && !enabled && team.viewerEmailDomainPublic === true
  const [saving, setSaving] = useState(false)

  async function toggle(next: boolean) {
    if (saving || !isAdmin) return
    setSaving(true)
    try {
      const updated = await api.atlasSetTeamEmailDomainDiscovery(team.id, next)

      onTeamUpdated(updated)
    } catch (err) {
      toast.apiError(t('Could not update allowed email domains'), err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-10">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-main">{t('Allowed email domains')}</h2>
        <p className="mt-1 text-[13px] text-tertiary">
          {t(
            "Let anyone who signs in with a verified email on your company domain discover and join this team. Public email providers (like gmail.com) can't be used.",
          )}
        </p>
      </div>

      <div className="flex items-center gap-4 rounded-lg border border-line-control/70 bg-surface px-4 py-3.5">
        <UiIcon size={14} icon={AtSignIcon} className="w-3.5 h-3.5 flex-shrink-0 text-tertiary" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[12.5px] text-main truncate">
            {displayDomains.map((domain) => `@${domain}`).join(', ') || '—'}
          </div>
          <div className="mt-0.5 text-[12px] text-tertiary">
            {rowHint({ enabled, isAdmin, publicDomain, domain: userDomain })}
          </div>
        </div>
        <Switch
          checked={enabled}
          disabled={!isAdmin || saving || publicDomain}
          label={enabled ? t('Disable domain discovery') : t('Enable domain discovery')}
          onChange={(next) => void toggle(next)}
        />
      </div>
      {!isAdmin && <AdminOnlyHint teamId={team.id} />}
    </div>
  )
}

function rowHint(state: {
  enabled: boolean
  isAdmin: boolean
  publicDomain: boolean
  domain: string
}) {
  if (state.enabled) return t('Teammates on this domain can join this team.')
  if (state.publicDomain)
    return t(
      "{domain} is a public email provider, so it can't be used. Sign in with a company email to turn this on.",
      { domain: state.domain },
    )

  return state.isAdmin
    ? t('Your email domain, taken from your account.')
    : t('Disabled for this team.')
}
