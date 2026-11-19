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

function describeCron(expression: string): string {
  const [minute = '', hour = '', day = '', month = '', weekday = ''] = expression.split(/\s+/)
  const fallback = `Schedule: ${expression} (UTC)`

  if (day !== '*' || month !== '*') return fallback
  if (weekday === '*') {
    const hourly = hourlyDescription(minute, hour)

    if (hourly) return hourly
  }
  if ((weekday === '*' || weekday === '1-5') && /^\d+$/.test(hour) && /^\d+$/.test(minute)) {
    const days = weekday === '1-5' ? 'Weekdays' : 'Every day'

    return `${days} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')} UTC`
  }

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
