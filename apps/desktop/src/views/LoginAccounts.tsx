import { useState } from 'react'

import { api } from '../api'
import { accountName, backendLabel, requestAddAccount, switchToAccount } from '../app/accounts'
import { Avatar } from '../components/Avatar'
import { toast } from '../components/ui/toast'
import { t } from '../i18n'

import type { AccountSummary } from '../types'

/** The accounts still signed in on this computer, to continue as one without signing in. */
export function LoginAccounts({ accounts }: { accounts: AccountSummary[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  // Accounts signed out here because they have to sign in again.
  const [gone, setGone] = useState<string[]>([])
  const shown = accounts.filter((a) => !gone.includes(a.key))

  if (shown.length === 0) return null

  async function choose(account: AccountSummary) {
    setBusy(account.key)
    try {
      const outcome = await switchToAccount(
        account,
        (name) => t('Sign in to {name} again.', { name }),
        { switchAccount: api.authSwitchAccount, requestAddAccount },
      )

      if (outcome === 'signInAgain') setGone((keys) => [...keys, account.key])
    } catch (e) {
      toast.apiError(t('Could not switch accounts'), e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="w-full mb-6">
      <p className="text-[12px] text-tertiary mb-2">{t('Signed in on this computer')}</p>
      <ul className="flex flex-col gap-1.5">
        {shown.map((account) => {
          const name = accountName(account)
          const backend = backendLabel(account.api)

          return (
            <li key={account.key}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void choose(account)}
                className="titlebar-no-drag w-full flex items-center gap-2.5 px-3 py-2 rounded-md border border-zGray-800 bg-surface text-left hover:bg-[var(--sidebar-overlay-hover)] disabled:opacity-60"
              >
                <Avatar
                  src={account.userInfo?.avatarURL}
                  name={name}
                  size={24}
                  className="rounded-full !shadow-none flex-shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-main">{name}</span>
                  <span className="block truncate text-[12px] text-tertiary">
                    {backend
                      ? `${account.userInfo?.email ?? ''} · ${backend}`
                      : account.userInfo?.email}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
