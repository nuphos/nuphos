import type { AwsLogEvent, AwsLogGroup } from '../../types'

export function cloudWatchLogGroupUrl(group: AwsLogGroup): string {
  // The CloudWatch console double-encodes log group names, with `%` written
  // as `$25` (so `/` becomes `$252F`).
  const escaped = encodeURIComponent(group.name).replaceAll('%', () => '$25')

  return `https://${group.region}.console.aws.amazon.com/cloudwatch/home?region=${encodeURIComponent(group.region)}#logsV2:log-groups/log-group/${escaped}`
}

export function formatLogTimestamp(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)

  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export const LOG_RETENTION_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'never', label: 'Never expire' },
  { value: '1', label: '1 day' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
  { value: '731', label: '2 years' },
]

export function sortEventsByTs(events: AwsLogEvent[]): AwsLogEvent[] {
  return [...events].sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''))
}

export function lastEventMs(events: AwsLogEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const ts = events[i].timestamp

    if (ts) return Date.parse(ts)
  }

  return 0
}

export const LOG_RANGE_OPTIONS: readonly { label: string; minutes: number }[] = [
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: '3h', minutes: 180 },
  { label: '12h', minutes: 720 },
  { label: '1d', minutes: 1440 },
]

export const LIVE_TAIL_INTERVAL_MS = 3000
export const LIVE_TAIL_BUFFER = 5000
