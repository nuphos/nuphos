import { useState } from 'react'

import { parseAtlasError } from '../../api/errors'
import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

import { providerDraft, draftValue } from './customProviderDraft'
import { CustomProviderFields } from './CustomProviderFields'

import type { CustomProviderAgent, CustomProviderInput, CustomProviderSaved } from '../../api'

/**
 * Edits a custom provider: the URL rule shows under the field, Test connection sends the one
 * request Save would, and a refusal stays in place rather than in a toast.
 */
export function CustomProviderForm({
  provider,
  instanceId,
  saved,
  onSave,
  onCancel,
}: {
  provider: CustomProviderAgent
  instanceId?: string
  saved: CustomProviderSaved | undefined
  onSave: (value: CustomProviderInput) => Promise<void>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(() => providerDraft(saved))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unreachable, setUnreachable] = useState(false)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await onSave(draftValue(draft))
    } catch (cause) {
      setError(parseAtlasError(cause).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="space-y-3 px-5 py-4"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="text-[13px] font-medium text-main">{t('Custom provider')}</div>
      <CustomProviderFields
        provider={provider}
        draft={draft}
        instanceId={instanceId}
        error={error}
        onChange={setDraft}
        onCheck={(check) => setUnreachable(check?.reached === false)}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" type="button" disabled={saving} onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button size="sm" type="submit" disabled={saving}>
          {unreachable ? t('Save anyway') : t('Save')}
        </Button>
      </div>
    </form>
  )
}
