function hourlyDescription(minute: string, hour: string): string | undefined {
  if (hour === '*') {
    if (minute === '*') return 'Every minute'
    if (/^\*\/\d+$/.test(minute)) return `Every ${minute.slice(2)} minutes`
  }
  if (!/^\d+$/.test(minute)) return
  const at = `minute ${minute.padStart(2, '0')}`

  if (hour === '*') return `Every hour at ${at}`
  if (/^\*\/\d+$/.test(hour)) return `Every ${hour.slice(2)} hours at ${at} (UTC)`
  if (/^\d+-\d+$/.test(hour)) return `Every hour, ${hour.replace('-', ':00 – ')}:00 UTC, at ${at}`
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The weekday field in words: every day, weekdays, or the days listed (0 and 7 are Sunday). */
function daysDescription(weekday: string): string | undefined {
  if (weekday === '*') return 'Every day'
  if (weekday === '1-5') return 'Weekdays'
  if (!/^[0-7](,[0-7])*$/.test(weekday)) return
  const days = new Set(weekday.split(',').map((day) => Number(day) % 7)) // 7 is Sunday too
  const names = [...days].map((day) => DAY_NAMES[day] ?? '')
  const last = names.pop() ?? ''
  const list = names.length > 0 ? [names.join(', '), last].join(' and ') : last

  return `Every ${list}`
}

function describeCron(expression: string): string {
  const [minute = '', hour = '', day = '', month = '', weekday = ''] = expression.split(/\s+/)
  const fallback = `Schedule: ${expression} (UTC)`

  if (day !== '*' || month !== '*') return fallback
  if (weekday === '*') {
    const hourly = hourlyDescription(minute, hour)

    if (hourly) return hourly
  }
  const days = daysDescription(weekday)

  if (days && /^\d+$/.test(hour) && /^\d+$/.test(minute))
    return `${days} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} UTC`

  return fallback
}

export function triggerScheduleDescription(trigger: {
  triggerType: string
  cronExpression?: string
  timeZone?: string
}): string {
  if (trigger.triggerType !== 'cron') return 'When a webhook arrives'

  const description = describeCron(trigger.cronExpression ?? '')
  const zone = trigger.timeZone ?? 'UTC'

  if (zone === 'UTC') return description

  return description.includes('UTC')
    ? description.replaceAll('UTC', zone)
    : `${description} (${zone})`
}
