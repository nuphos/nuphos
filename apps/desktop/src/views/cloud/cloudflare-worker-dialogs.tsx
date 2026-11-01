import { useState } from 'react'

import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

export function CronTriggersDialog({
  initial,
  onClose,
  onSave,
}: {
  initial: string[]
  onClose: () => void
  onSave: (crons: string[]) => Promise<void>
}) {
  const [text, setText] = useState(initial.join('\n'))
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const crons = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)

      await onSave(crons)
    } catch (e) {
      toast.apiError(t('Failed to update cron triggers'), e, {
        fallback: t('Check your connection and try again.'),
      })
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Edit cron triggers')}
      description={t('One cron expression per line')}
      width={460}
    >
      <div className="px-5 py-4 space-y-2 text-[13px]">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={'*/5 * * * *\n0 0 * * *'}
          className="w-full px-2.5 py-2 rounded-md bg-surface border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
        />
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12.5px] disabled:opacity-50"
        >
          {t('Cancel')}
        </button>
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? t('Saving…') : t('Save')}
        </Button>
      </div>
    </Modal>
  )
}
