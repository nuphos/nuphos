import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { LOCAL_AGENT_CARD } from './LocalAgentCard'

import type { LoginItemState } from '../../api/device-types'

/** Opens Nuphos at login, so this computer's local runtime comes back after a restart. */
export function OpenAtLoginSettings() {
  const [state, setState] = useState<LoginItemState | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    api
      .appGetLoginItem()
      .then((next) => {
        if (!cancelled) setState(next)
      })
      // Unreadable reads as unavailable: the card stays hidden.
      .catch(() => {
        if (!cancelled) setState(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (!state?.supported) return null

  const save = async (openAtLogin: boolean) => {
    setSaving(true)
    try {
      setState(await api.appSetLoginItem(openAtLogin))
    } catch (err) {
      toast.apiError(t('Could not change Open Nuphos at login'), err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <label className={`${LOCAL_AGENT_CARD} flex items-start justify-between gap-3 px-4 py-3.5`}>
      <div>
        <div className="text-[13px] font-medium text-main">{t('Open Nuphos at login')}</div>
        <p className="mt-1 text-[12px] text-tertiary">
          {t(
            'Open Nuphos when you sign in to this computer, so its local runtime is back online after a restart.',
          )}
        </p>
      </div>
      <Switch
        checked={state.openAtLogin}
        disabled={saving}
        onChange={(openAtLogin) => void save(openAtLogin)}
      />
    </label>
  )
}
