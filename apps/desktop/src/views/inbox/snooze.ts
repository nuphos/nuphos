import { t } from '../../i18n/index.ts'

/**
 * When an Inbox question can be snoozed until, in local time: an hour from now,
 * tomorrow at 9:00 and next Monday at 9:00. On a Sunday those last two are one.
 */
export function snoozeTimes(now: Date): { label: string; until: Date }[] {
  const at9 = (days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 9)
  const monday = at9((8 - now.getDay()) % 7 || 7)
  const tomorrow = at9(1)

  return [
    { label: t('1 hour'), until: new Date(now.getTime() + 3_600_000) },
    { label: t('Tomorrow, 9:00'), until: tomorrow },
    ...(monday.getTime() === tomorrow.getTime()
      ? []
      : [{ label: t('Next Monday, 9:00'), until: monday }]),
  ]
}

/** When a snoozed question comes back: its time today, else its weekday and time. */
export function returnTime(iso: string, now = new Date()): string {
  const at = new Date(iso)
  const today = at.toDateString() === now.toDateString()

  return at.toLocaleString(undefined, {
    ...(today ? {} : { weekday: 'short' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}
