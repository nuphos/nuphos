import { useState } from 'react'

import { api } from '../../api'
import { AppSelect } from '../../components/ui/select'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { useLocalRuntimeState } from '../../hooks/useLocalRuntimeState'
import { t } from '../../i18n'

import type { SleepPreferences, SleepState } from '../../api/device-types'

const STATUS: Record<SleepState['reason'], string> = {
  active: t('Keeping this Mac awake'),
  off: t('Following macOS sleep settings'),
  battery: t('Paused while running on battery'),
  'signed-out': t('Paused while signed out of Nuphos'),
  idle: t('Waiting for a local task'),
  unsupported: t('Available on macOS only'),
}

/** This Mac's own sleep setting; the saved state comes back with the local runtime's broadcast. */
export function SleepPreventionSettings() {
  const current = useLocalRuntimeState()?.sleepPrevention
  const [saving, setSaving] = useState(false)

  if (!current?.supported) return null

  const save = async (next: SleepPreferences) => {
    setSaving(true)
    try {
      await api.localRuntimeSetSleepPreferences(next)
    } catch (err) {
      toast.apiError(t('Could not save sleep settings'), err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-line-control/70 bg-surface px-4 py-3.5">
      <div>
        <div className="text-[13px] text-main">{t('Prevent Mac auto-sleep')}</div>
        <p className="mt-0.5 text-[12px] text-tertiary">
          {t(
            'Keep this computer available for local tasks. The display can turn off and the screen can lock. Closing the lid or choosing Sleep can still put your Mac to sleep.',
          )}
        </p>
      </div>
      <AppSelect
        ariaLabel={t('Prevent Mac auto-sleep')}
        value={current.mode}
        disabled={saving}
        onValueChange={(mode) => void save({ ...current, mode: mode as SleepPreferences['mode'] })}
        options={[
          { value: 'off', label: t('Off') },
          { value: 'tasks', label: t('While local tasks are running') },
          { value: 'host', label: t('While signed in to Nuphos') },
        ]}
      />
      <label className="flex items-center justify-between gap-3 text-[12px] text-secondary">
        {t('Only while connected to power')}
        <Switch
          checked={current.onlyOnAC}
          label={t('Only while connected to power')}
          disabled={saving}
          onChange={(onlyOnAC) => void save({ ...current, onlyOnAC })}
        />
      </label>
      <p role="status" className="text-[12px] text-secondary">
        {STATUS[current.reason]}
      </p>
      <p className="text-[12px] text-tertiary">
        {t(
          'Saved on this Mac only. Nuphos must stay open. Keeping your Mac awake uses more energy. Task mode includes pending turns (including approval waits), remote commands, Computer Use calls and open remote terminals.',
        )}
      </p>
    </div>
  )
}
