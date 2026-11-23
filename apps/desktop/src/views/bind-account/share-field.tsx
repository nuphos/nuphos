import { useEffect } from 'react'

import { AllowListSelect } from '../../components/binding-access-allow-list'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { t } from '../../i18n'
import { useTeamMembers } from '../../lib/bindingAccess'

/** New connections start private; sharing must be explicitly selected. */
export function BindShareField({
  teamId,
  value,
  onChange,
  onDefaultChange,
}: {
  teamId: string
  provider: string
  value: string[] | null
  onChange: (list: string[]) => void
  /** What the picker shows while untouched; the dialog sends it as the choice. */
  onDefaultChange?: (list: string[]) => void
}) {
  const members = useTeamMembers(teamId)
  const me = useCurrentUser()?.id
  const onlyMe = me ? [me] : []
  const fallback = onlyMe
  const fallbackKey = fallback.join(',')

  // An untouched picker always submits the connecting member alone.
  useEffect(
    () => onDefaultChange?.(fallbackKey ? fallbackKey.split(',') : []),
    [fallbackKey, onDefaultChange],
  )

  return (
    <div className="mt-4 border-y border-line-control/60">
      <AllowListSelect
        title={t('Who can use it')}
        subtitle={t(
          'New connections are private. Once shared, only administrators can manage them.',
        )}
        allowList={value ?? fallback}
        members={members}
        onChange={onChange}
      />
    </div>
  )
}
