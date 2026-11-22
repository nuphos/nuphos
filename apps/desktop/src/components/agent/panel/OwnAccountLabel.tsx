import { t } from '../../../i18n/index.ts'
import { isGoogle } from '../../../types'
import { nameOf } from '../../../views/settings/personalCredentials'

import { ownAccountRow } from './ownAccountRow'

import type { PersonalCredentialProvider } from '../../../types'

/**
 * A member's own accounts of one provider, as one selector row. Ticking the provider covers every
 * account, so the row names the first and counts the rest; the count never truncates away, and the
 * tooltip lists every login.
 */
export function OwnAccountLabel({
  provider,
  accounts,
}: {
  provider: PersonalCredentialProvider
  accounts: { login: string }[]
}) {
  const prefix = isGoogle(provider) ? `${nameOf(provider)} · ` : ''
  const you = (login: string) => `${prefix}${t('You ({login}) · Personal', { login })}`
  const row = ownAccountRow(
    accounts.map((account) => account.login),
    you,
    (count) => t('+{count} more', { count }),
  )

  return (
    <>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-main" title={row.title}>
        {row.text}
      </span>
      {row.more && <span className="flex-none text-[12px] text-tertiary">{row.more}</span>}
    </>
  )
}
