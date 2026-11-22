import { t } from '../../../i18n/index.ts'
import { isGoogle } from '../../../types'
import { nameOf } from '../../../views/settings/personalCredentials'

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
  const logins = accounts.map((account) => account.login)
  const more = logins.length - 1

  return (
    <>
      <span
        className="min-w-0 flex-1 truncate text-[12.5px] text-main"
        title={you(logins.join(', '))}
      >
        {you(logins[0] ?? '')}
      </span>
      {more > 0 && (
        <span className="flex-none text-[12px] text-tertiary">
          {t('+{count} more', { count: more })}
        </span>
      )}
    </>
  )
}
