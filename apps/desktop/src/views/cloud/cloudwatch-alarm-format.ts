import type { AwsCloudWatchAlarm } from '../../types'

const ALARM_COMPARISON_LABELS: Record<string, string> = {
  GreaterThanOrEqualToThreshold: '≥',
  GreaterThanThreshold: '>',
  LessThanThreshold: '<',
  LessThanOrEqualToThreshold: '≤',
  GreaterThanUpperThreshold: '> upper band',
  LessThanLowerThreshold: '< lower band',
  LessThanLowerOrGreaterThanUpperThreshold: 'outside band',
}

export function alarmConditionLabel(a: AwsCloudWatchAlarm): string {
  if (a.kind === 'composite') return 'Composite rule'
  if (!a.metricName) return '—'
  const op = a.comparisonOperator
    ? (ALARM_COMPARISON_LABELS[a.comparisonOperator] ?? a.comparisonOperator)
    : ''
  const threshold = a.threshold != null ? ` ${String(a.threshold)}` : ''
  const periods =
    a.evaluationPeriods != null && a.periodSec != null
      ? ` for ${String(a.evaluationPeriods)}×${String(a.periodSec)}s`
      : ''

  return `${a.statistic ?? ''} ${a.metricName} ${op}${threshold}${periods}`.trim()
}

export function cloudWatchAlarmUrl(alarm: AwsCloudWatchAlarm): string {
  return `https://${alarm.region}.console.aws.amazon.com/cloudwatch/home?region=${encodeURIComponent(alarm.region)}#alarmsV2:alarm/${encodeURIComponent(alarm.name)}`
}

export function alarmStateClass(state: string): string {
  if (state === 'ALARM') return 'text-error'
  if (state === 'OK') return 'text-[#73bf69]'

  return 'text-amber-400'
}
