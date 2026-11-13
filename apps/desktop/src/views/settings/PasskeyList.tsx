import { useState } from 'react'

import { api } from '../../api'
import { MfaCodeDialog } from '../../components/MfaCodeDialog'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { formatDate } from '../members/memberRows'

import type { MfaStatus } from '../../types'

type Passkey = NonNullable<MfaStatus['passkeys']>[number]

/**
 * Passkeys, another way to answer once two-factor authentication is on. Adding
 * one runs in the browser, where the passkey belongs to nuphos.ai.
 */
export function PasskeyList({
  passkeys,
  className,
  onChange,
}: {
  passkeys: Passkey[]
  className: string
  onChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<Passkey | null>(null)

  async function add() {
    setBusy(true)
    try {
      await api.atlasAddPasskey()
      toast.success(t('Passkey added'))
      onChange()
    } catch (err) {
      toast.apiError(t('Could not add the passkey'), err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${className} mt-2`}>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-main">{t('Passkeys')}</p>
          <p className="mt-0.5 text-[12.5px] text-tertiary">
            {t('Use Touch ID, Windows Hello or a security key instead of a code.')}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void add()}
        >
          {busy ? t('Waiting for the browser…') : t('Add a passkey')}
        </Button>
      </div>
      {passkeys.length > 0 && (
        <ul className="mt-3 divide-y divide-line-control/70 border-t border-line-control/70">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-4 pt-2.5 [&:not(:last-child)]:pb-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-main">{p.name}</p>
                <p className="text-[12px] text-tertiary">
                  {t('Added {date}', { date: formatDate(p.createdAt) })}
                </p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={() => setRemoving(p)}>
                {t('Remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <MfaCodeDialog
        open={removing !== null}
        title={t('Remove passkey')}
        description={t(
          'This passkey will no longer work for this account. Enter a code to confirm.',
        )}
        submitLabel={t('Remove')}
        onSubmit={async (code) => {
          if (removing) await api.atlasRemovePasskey(removing.id, code)
          setRemoving(null)
          onChange()
        }}
        onClose={() => setRemoving(null)}
      />
    </div>
  )
}
