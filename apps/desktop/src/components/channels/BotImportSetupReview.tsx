import { t } from '../../i18n'
import type { ReactNode } from 'react'
import type { BotImportSetup } from '../../api/bot-import-types'

export function SetupReview({
  setup,
  selected,
  onSelect,
  children,
}: {
  setup: BotImportSetup
  selected: boolean
  onSelect: (value: boolean) => void
  children: ReactNode
}) {
  return (
    <section className="space-y-2 rounded-lg border border-line-control p-3">
      <label className="flex items-center gap-2 font-medium">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
        />
        {setup.name}
      </label>
      {children}
      <details>
        <summary className="cursor-pointer text-secondary">
          {t('Instructions and memories')}
        </summary>
        <p className="whitespace-pre-wrap py-2">{setup.instructions}</p>
        {setup.memories.map((memory, index) => (
          <p key={index} className="text-secondary">
            • {memory}
          </p>
        ))}
      </details>
      {setup.schedules.map((routine) => (
        <p key={routine.key} className="text-secondary">
          {routine.name} ·{' '}
          {routine.schedule.kind === 'cron'
            ? routine.schedule.expression
            : `${routine.schedule.seconds}s — ${t('Requires manual setup')}`}{' '}
          · {routine.timeZone} · {routine.requestedEnabled ? t('Requested active') : t('Disabled')}
        </p>
      ))}
      {setup.manualTasks.map((task, index) => (
        <p key={index} className="text-status-warning">
          {t('Manual setup')}: {task.name} — {task.reason}
        </p>
      ))}
    </section>
  )
}
