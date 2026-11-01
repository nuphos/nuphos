import { useState } from 'react'

import { api } from '../../api'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { LOCAL_AGENT_CARD } from './LocalAgentCard'

/** Off by default and changed only here, at the Mac: a phone may then open its screen with no Mac password. */
export function PhoneControlSettings({
  allowed,
  onSaved,
}: {
  allowed: boolean
  onSaved: (next: boolean) => void
}) {
  const [saving, setSaving] = useState(false)

  const save = async (next: boolean) => {
    setSaving(true)
    try {
      onSaved(await api.localRuntimeSetPhoneControl(next))
    } catch (err) {
      toast.apiError(t('Could not change phone control'), err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${LOCAL_AGENT_CARD} flex items-start justify-between gap-4 px-4 py-3.5`}>
      <div>
        <div className="text-[13px] font-medium text-main">
          {t('Let my phone see and control this Mac')}
        </div>
        <p className="mt-1 text-[12px] text-tertiary">
          {t(
            'Nuphos on your phone can show this screen and control it, without your Mac password. macOS asks once to allow Screen Recording and Accessibility. This Mac shows a notice while your phone has control.',
          )}
        </p>
      </div>
      <Switch
        checked={allowed}
        disabled={saving}
        onChange={(next) => void save(next)}
        label={t('Let my phone see and control this Mac')}
      />
    </div>
  )
}
