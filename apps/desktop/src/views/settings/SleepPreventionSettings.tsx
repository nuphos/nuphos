import { Switch } from '@base-ui/react/switch'
import { useState } from 'react'

import { api } from '../../api'
import { AppSelect } from '../../components/ui/select'
import { toast } from '../../components/ui/toast'

import { LOCAL_AGENT_CARD } from './LocalAgentCard'

import type { SleepPreferences, SleepState } from '../../api/device-types'

const STATUS: Record<SleepState['reason'], string> = {
  active: 'Keeping this Mac awake',
  off: 'Following macOS sleep settings',
  battery: 'Paused while running on battery',
  'signed-out': 'Paused while signed out of Nuphos',
  idle: 'Waiting for a local task',
  unsupported: 'Available on macOS only',
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
      toast.apiError('Could not save sleep settings', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${LOCAL_AGENT_CARD} space-y-3 px-4 py-3.5`}>
      <div>
        <div className="text-[13px] font-medium text-main">Prevent Mac auto-sleep</div>
        <p className="mt-1 text-[12px] text-tertiary">
          Keep this computer available for local tasks. The display can turn off and the screen can
          lock. Closing the lid or choosing Sleep can still put your Mac to sleep.
        </p>
      </div>
      <AppSelect
        ariaLabel="Prevent Mac auto-sleep"
        value={current.mode}
        disabled={saving}
        onValueChange={(mode) => void save({ ...current, mode: mode as SleepPreferences['mode'] })}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'tasks', label: 'While local tasks are running' },
          { value: 'host', label: 'While signed in to Nuphos' },
        ]}
      />
      <label className="flex items-center justify-between gap-3 text-[12px] text-secondary">
        Only while connected to power
        <Switch.Root
          checked={current.onlyOnAC}
          disabled={saving}
          onCheckedChange={(onlyOnAC) => void save({ ...current, onlyOnAC })}
          className="relative h-5 w-9 shrink-0 rounded-full bg-zGray-700 data-[checked]:bg-zViolet-500 disabled:opacity-50"
        >
          <Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white data-[checked]:translate-x-[18px]" />
        </Switch.Root>
      </label>
      <p role="status" className="text-[12px] text-secondary">
        {STATUS[current.reason]}
      </p>
      <p className="text-[12px] text-tertiary">
        Saved on this Mac only. Nuphos must stay open. Keeping your Mac awake uses more energy. Task
        mode includes pending agent turns (including approval waits), remote commands, Computer Use
        calls and open remote terminals.
      </p>
    </div>
  )
}
