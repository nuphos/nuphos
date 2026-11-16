import { useEffect, useState } from 'react'

import { api } from '../../api'
import { AllowListSelect } from '../../components/binding-access-allow-list'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { t } from '../../i18n'
import { useTeamMembers } from '../../lib/bindingAccess'

import { HIGH_PRIVILEGE_PROVIDERS } from './share'

import type { TeamShareDefault } from '../../lib/bindingShare'

/** Who may use the connection being added; untouched, it shows the team default. */
export function BindShareField({
  teamId,
  provider,
  value,
  onChange,
}: {
  teamId: string
  provider: string
  value: string[] | null
  onChange: (list: string[]) => void
}) {
  const members = useTeamMembers(teamId)
  const me = useCurrentUser()?.id
  const [teamShares, setTeamShares] = useState(false)

  useEffect(() => {
    let live = true

    api
      .atlasListTeams()
      .then((teams) => {
        const team: (TeamShareDefault & { id: string }) | undefined = teams.find(
          (x) => x.id === teamId,
        )

        if (live) setTeamShares(team?.bindingShareDefault === 'team')
      })
      .catch(() => {})

    return () => {
      live = false
    }
  }, [teamId])

  const shared = teamShares && !HIGH_PRIVILEGE_PROVIDERS.has(provider)
  const onlyMe = me ? [me] : []
  const fallback = shared ? ['*'] : onlyMe

  return (
    <div className="mt-4 border-y border-line-control/60">
      <AllowListSelect
        title={t('Who can use it')}
        subtitle={t('You can always use a connection you add. Change this later from its page.')}
        allowList={value ?? fallback}
        members={members}
        onChange={onChange}
      />
    </div>
  )
}
