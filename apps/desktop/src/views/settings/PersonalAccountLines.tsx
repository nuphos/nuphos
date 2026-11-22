import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

import type { PersonalCredential } from '../../types'

// The login is styled, so split one sentence around it.
const CONNECTED_AS = t('Connected as {login}').split('{login}')

/** The accounts connected for one provider, each with a Disconnect of its own. */
export function PersonalAccountLines({
  accounts,
  busy,
  canAddMore,
  onDisconnect,
  onConnectAnother,
}: {
  accounts: PersonalCredential[]
  busy: boolean
  canAddMore: boolean
  onDisconnect: (account: PersonalCredential) => void
  onConnectAnother: () => void
}) {
  return (
    <div className="t-collapse" data-open={accounts.length > 0}>
      <div className="t-collapse-inner">
        {accounts.map((account) => (
          <div key={account.id} className="mt-1.5 flex items-center gap-2">
            <p
              className="min-w-0 flex-1 truncate text-[12.5px] text-secondary"
              title={account.login}
            >
              {CONNECTED_AS[0]}
              <span className="font-medium text-main">{account.login}</span>
              {CONNECTED_AS[1]}
              {account.workspaceName && ` · ${account.workspaceName}`}
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              aria-label={t('Disconnect {name}', { name: account.login })}
              onClick={() => onDisconnect(account)}
            >
              {t('Disconnect')}
            </Button>
          </div>
        ))}
        {canAddMore && accounts.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            disabled={busy}
            onClick={onConnectAnother}
          >
            {t('Connect another account')}
          </Button>
        )}
      </div>
    </div>
  )
}
