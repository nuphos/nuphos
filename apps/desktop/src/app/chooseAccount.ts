import { api } from '../api'
import { t } from '../i18n'

import { requestAddAccount, switchToAccount } from './accounts'

import type { AccountSummary } from '../types'

/**
 * Switches this app to `account`. Leaving a signed-in account reloads every
 * window from the main process; from the sign-in screen there is none to
 * leave, so this window reloads itself into the account.
 */
export async function chooseAccount(
  account: AccountSummary,
  from: 'menu' | 'signIn',
): Promise<'switched' | 'signInAgain'> {
  const reload = () => window.location.reload()
  const outcome = await switchToAccount(
    account,
    (name) => t('Sign in to {name} again.', { name }),
    {
      switchAccount: api.authSwitchAccount,
      requestAddAccount,
      currentApi: api.atlasGetApiUrl,
      moveTo: api.appSetApiEndpoint,
      reload,
    },
  )

  if (outcome === 'switched' && from === 'signIn') reload()

  return outcome
}
