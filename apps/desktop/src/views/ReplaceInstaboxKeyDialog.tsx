import { useState } from 'react'

import { api } from '../api'
import { Modal } from '../components/Modal'
import { Button } from '../components/ui/button'
import { toast } from '../components/ui/toast'
import { t } from '../i18n'

import { INPUT } from './bind-account/forms-instabox'
import { Field } from './bind-account/shared'

/** A new API key for a team's instabox account; its computers stay on the same connection. */
export function ReplaceInstaboxKeyDialog({
  teamId,
  account,
  onClose,
  onSaved,
}: {
  teamId: string
  account: { id: string; name: string }
  onClose: () => void
  onSaved: () => void
}) {
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await api.replaceInstaboxKey(teamId, account.id, apiKey.trim())
      toast.success(t('API key replaced'))
      onSaved()
      onClose()
    } catch (cause) {
      toast.apiError(t('Could not replace the API key'), cause)
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Replace {name} API key', { name: account.name })}
      width={480}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="px-5 py-4 text-[13px]">
          <Field
            label={t('New API key')}
            hint={t(
              "Use a key from the same instabox account. The team's computers on it keep running and switch to the new key.",
            )}
          >
            <input
              type="password"
              autoFocus
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="ibk_…"
              className={INPUT}
            />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line-control px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12.5px] disabled:opacity-50"
          >
            {t('Cancel')}
          </button>
          <Button size="sm" type="submit" disabled={busy || !apiKey.trim()}>
            {busy ? t('Checking…') : t('Replace key')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
