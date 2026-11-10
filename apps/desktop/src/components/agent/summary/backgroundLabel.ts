import { t } from '../../../i18n/index.ts'

/** The runtime's background tasks, then commands running in this chat's dock terminals. */
export function backgroundLabel(taskCount: number, terminalCount: number): string {
  const tasks =
    taskCount === 1
      ? t('1 background task running')
      : t('{count} background tasks running', { count: taskCount })
  const terminals =
    terminalCount === 1
      ? t('1 command running in a terminal')
      : t('{count} commands running in terminals', { count: terminalCount })

  if (!terminalCount) return tasks
  if (!taskCount) return terminals

  return `${tasks} · ${terminals}`
}
