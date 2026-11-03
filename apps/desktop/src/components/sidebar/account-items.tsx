import { UserPlus } from 'lucide-react'

import { accountName, backendLabel, requestAddAccount } from '../../app/accounts'
import { chooseAccount } from '../../app/chooseAccount'
import { t } from '../../i18n'
import { Avatar } from '../Avatar'
import { MenuItem } from '../ui/menu'
import { toast } from '../ui/toast'

import type { AccountSummary } from '../../types'

async function choose(account: AccountSummary) {
  try {
    await chooseAccount(account, 'menu')
  } catch (e) {
    toast.apiError(t('Could not switch accounts'), e)
  }
}

/** The other signed-in accounts, to switch to, and a way to add one more. */
export function SidebarAccountItems({ waiting }: { waiting: AccountSummary[] }) {
  return (
    <>
      {waiting.map((account) => {
        const name = accountName(account)
        const backend = backendLabel(account.api)

        return (
          <MenuItem
            key={account.key}
            icon={
              <Avatar
                src={account.userInfo?.avatarURL}
                name={name}
                size={16}
                className="rounded-full !shadow-none"
              />
            }
            hint={backend ?? undefined}
            onClick={() => void choose(account)}
          >
            <span className="truncate">{name}</span>
          </MenuItem>
        )
      })}
      <MenuItem icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => requestAddAccount()}>
        {t('Add account')}
      </MenuItem>
    </>
  )
}
