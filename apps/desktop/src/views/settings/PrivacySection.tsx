import { useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { SectionHeader } from './shared'

export function PrivacySection() {
  const [send, setSend] = useState(() => api.sendDiagnostics())
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  const save = async (next: boolean) => {
    setSaving(true)
    try {
      setSend(await api.setSendDiagnostics(next))
    } catch (err) {
      toast.apiError(t('Could not save privacy settings'), err)
    } finally {
      setSaving(false)
    }
  }

  const saveDiagnostics = async () => {
    setExporting(true)
    try {
      const file = await api.localRuntimeSaveDiagnostics()

      // The name only: the full path carries the person's username into shared screenshots.
      toast.success(t('Diagnostics saved'), file.split(/[\\/]/).pop())
    } catch {
      toast.error(t('Could not save diagnostics'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <SectionHeader
        title={t('Privacy')}
        description={t('Choose what this computer shares with Nuphos.')}
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-main">
            {t('Send crash reports and usage data')}
          </div>
          <p className="mt-1 text-[12px] text-tertiary">
            {t(
              'Helps us find and fix problems. Crash reports include the app version, system details and a snapshot of what the app was doing when it crashed, which can contain fragments of on-screen content. Usage data covers how features are used. Turning this off stops usage data right away. Crash reports stop being sent after Nuphos restarts; any sent before then are deleted without being stored. Saved on this computer only.',
            )}
          </p>
        </div>
        <Switch
          label={t('Send crash reports and usage data')}
          checked={send}
          disabled={saving}
          onChange={(next) => void save(next)}
        />
      </div>
      <div className="mt-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-main">{t('Diagnostics file')}</div>
          <p className="mt-1 text-[12px] text-tertiary">
            {t(
              'Saves recent logs from Claude Code, Codex and other CLIs to a .zip in Downloads, with tokens, keys and email addresses removed. Nothing is uploaded. Attach it when you contact support.',
            )}
          </p>
        </div>
        <Button
          variant="secondary"
          className="shrink-0"
          disabled={exporting}
          onClick={() => void saveDiagnostics()}
        >
          {t('Save diagnostics')}
        </Button>
      </div>
    </div>
  )
}
