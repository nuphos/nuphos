import { t } from '../../../i18n/index.ts'
import { isGoogle } from '../../../types'
import { nameOf } from '../../../views/settings/personalCredentials'

import type { PersonalCredentialProvider } from '../../../types'

/**
 * The selector row for a member's own accounts of one provider. Ticking the provider covers every
 * account, so the row shows the first and counts the rest, and the tooltip lists them all.
 */
export function ownAccountLabel(
  provider: PersonalCredentialProvider,
  accounts: { login: string }[],
) {
  const prefix = isGoogle(provider) ? `${nameOf(provider)} · ` : ''
  const you = (login: string) => `${prefix}${t('You ({login}) · Personal', { login })}`
  const [first = '', ...rest] = accounts.map((account) => account.login)

  return {
    label: you(rest.length ? `${first} ${t('+{count} more', { count: rest.length })}` : first),
    title: you([first, ...rest].join(', ')),
  }
}
