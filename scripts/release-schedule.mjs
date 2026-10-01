export function dateInTimeZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${values.year}-${values.month}-${values.day}`
}

function clockInTimeZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return Number(values.hour) * 60 + Number(values.minute)
}

function previousDate(date) {
  const shifted = new Date(`${date}T00:00:00Z`)

  shifted.setUTCDate(shifted.getUTCDate() - 1)

  return shifted.toISOString().slice(0, 10)
}

// A plain comma-separated cron field as numbers, or null otherwise. Out of
// range must take the same null fallback: an unreachable slot (hour 24 sits at
// minute 1440) would date every run to the previous day.
export function parseCronValues(field, max) {
  if (!/^\d+(?:,\d+)*$/.test(field)) return null
  const values = field.split(',').map(Number)

  return values.every((value) => value <= max) ? values : null
}

// The release day a scheduled run belongs to: the most recent scheduled time
// at or before now. GitHub's schedules are best-effort, and dating a run that
// crossed midnight by its execution time would steal the next day's slot.
export function scheduledReleaseDay(cronExpression, now, timeZone) {
  const fields = cronExpression.trim().split(/\s+/)

  if (fields.length !== 5) return dateInTimeZone(now, timeZone)
  const minutes = parseCronValues(fields[0], 59)
  const hours = parseCronValues(fields[1], 23)

  if (!minutes || !hours) return dateInTimeZone(now, timeZone)

  const scheduledMinutes = hours
    .flatMap((hour) => minutes.map((minute) => hour * 60 + minute))
    .sort((left, right) => left - right)
  const today = dateInTimeZone(now, timeZone)
  const nowMinutes = clockInTimeZone(now, timeZone)
  const elapsed = scheduledMinutes.filter((value) => value <= nowMinutes)

  // Nothing scheduled yet today means this run belongs to yesterday's last
  // slot and merely crossed midnight on its way out of the queue.
  return elapsed.length > 0 ? today : previousDate(today)
}
