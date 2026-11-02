import { t } from '../../i18n/index.ts'

import type { AwsCloudWatchAlarm } from '../../types'

const ALARM_COMPARISON_LABELS: Record<string, string> = {
  GreaterThanOrEqualToThreshold: '≥',
  GreaterThanThreshold: '>',
  LessThanThreshold: '<',
  LessThanOrEqualToThreshold: '≤',
  GreaterThanUpperThreshold: t('> upper band'),
  LessThanLowerThreshold: t('< lower band'),
  LessThanLowerOrGreaterThanUpperThreshold: t('outside band'),
}

export function alarmConditionLabel(a: AwsCloudWatchAlarm): string {
  if (a.kind === 'composite') return t('Composite rule')
  if (!a.metricName) return '—'
  const op = a.comparisonOperator
    ? (ALARM_COMPARISON_LABELS[a.comparisonOperator] ?? a.comparisonOperator)
    : ''
  const threshold = a.threshold != null ? ` ${String(a.threshold)}` : ''
  const condition = `${a.statistic ?? ''} ${a.metricName} ${op}${threshold}`.trim()

  return a.evaluationPeriods != null && a.periodSec != null
    ? t('{condition} for {periods}×{seconds}s', {
        condition,
        periods: a.evaluationPeriods,
        seconds: a.periodSec,
      })
    : condition
}

export function cloudWatchAlarmUrl(alarm: AwsCloudWatchAlarm): string {
  return `https://${alarm.region}.console.aws.amazon.com/cloudwatch/home?region=${encodeURIComponent(alarm.region)}#alarmsV2:alarm/${encodeURIComponent(alarm.name)}`
}

export function alarmStateClass(state: string): string {
  if (state === 'ALARM') return 'text-error'
  if (state === 'OK') return 'text-[#73bf69]'

  return 'text-amber-400'
}
