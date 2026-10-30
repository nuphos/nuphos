import { useState } from 'react'

import { api } from '../../api'
import { AppSelect } from '../../components/ui/select'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { LOCAL_AGENT_CARD } from './LocalAgentCard'

import type { SleepPreferences, SleepState } from '../../api/device-types'

const STATUS: Record<SleepState['reason'], string> = {
  active: t('Keeping this Mac awake'),
  off: t('Following macOS sleep settings'),
  battery: t('Paused while running on battery'),
  'signed-out': t('Paused while signed out of Nuphos'),
  idle: t('Waiting for a local task'),
  unsupported: t('Available on macOS only'),
}

export function SleepPreventionSettings({
  state: current,
  onSaved,
}: {
  state: SleepState
  onSaved: (next: SleepState) => void
}) {
  const [saving, setSaving] = useState(false)

  const save = async (next: SleepPreferences) => {
    setSaving(true)
    try {
      onSaved(await api.localRuntimeSetSleepPreferences(next))
    } catch (err) {
      toast.apiError(t('Could not save sleep settings'), err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${LOCAL_AGENT_CARD} space-y-3 px-4 py-3.5`}>
      <div>
        <div className="text-[13px] font-medium text-main">{t('Prevent Mac auto-sleep')}</div>
        <p className="mt-1 text-[12px] text-tertiary">
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
          disabled={saving}
          onChange={(onlyOnAC) => void save({ ...current, onlyOnAC })}
        />
      </label>
      <p role="status" className="text-[12px] text-secondary">
        {STATUS[current.reason]}
      </p>
      <p className="text-[12px] text-tertiary">
        {t(
          'Saved on this Mac only. Nuphos must stay open. Keeping your Mac awake uses more energy. Task mode includes pending agent turns (including approval waits), remote commands, Computer Use calls and open remote terminals.',
        )}
      </p>
    </div>
  )
}
