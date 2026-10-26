import { useState } from 'react'

import { api } from '../../api'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'

import { SectionHeader } from './shared'

export function PrivacySection() {
  const [send, setSend] = useState(() => api.sendDiagnostics())
  const [saving, setSaving] = useState(false)

  const save = async (next: boolean) => {
    setSaving(true)
    try {
      setSend(await api.setSendDiagnostics(next))
    } catch (err) {
      toast.apiError('Could not save privacy settings', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <SectionHeader title="Privacy" description="Choose what this computer shares with Nuphos." />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-main">Send crash reports and usage data</div>
          <p className="mt-1 text-[12px] text-tertiary">
            Helps us find and fix problems. Crash reports include the app version, system details
            and a snapshot of what the app was doing when it crashed, which can contain fragments of
            on-screen content. Usage data covers how features are used. Turning this off stops usage
            data right away. Crash reports stop being sent after Nuphos restarts; any sent before
            then are deleted without being stored. Saved on this computer only.
          </p>
        </div>
        <Switch
          label="Send crash reports and usage data"
          checked={send}
          disabled={saving}
          onChange={(next) => void save(next)}
        />
      </div>
    </div>
  )
}
