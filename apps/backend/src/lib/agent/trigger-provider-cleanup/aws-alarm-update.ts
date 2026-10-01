import { cleanupConflict } from './shared'

import type { AwsProviderWiring } from '../trigger-provider-wiring'
import type {
  CompositeAlarm,
  MetricAlarm,
  PutCompositeAlarmCommandInput,
  PutMetricAlarmCommandInput,
} from '@aws-sdk/client-cloudwatch'

export function isAwsNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name

  return name === 'NotFoundException' || name === 'ResourceNotFoundException'
}

const AWS_READBACK_DELAYS_MS = [0, 250, 750, 1_500, 3_000] as const

/**
 * AWS control-plane reads can briefly return stale state after a successful
 * mutation. Retry only the verification read, with a small bounded budget,
 * so cleanup remains deterministic without replaying the mutation itself.
 */
export async function settleAwsReadback<T>(
  read: () => Promise<T>,
  isSettled: (value: T) => boolean,
  options: {
    delaysMs?: readonly number[]
    sleep?: (milliseconds: number) => Promise<void>
  } = {},
): Promise<T> {
  const delaysMs = options.delaysMs ?? AWS_READBACK_DELAYS_MS
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))

  if (delaysMs.length === 0) {
    throw new Error('AWS readback verification requires at least one attempt')
  }

  let latest!: T

  for (const delayMs of delaysMs) {
    if (delayMs > 0) await sleep(delayMs)
    latest = await read()
    if (isSettled(latest)) return latest
  }

  return latest
}

function withoutTopic(actions: string[] | undefined, topicArn: string): string[] {
  return (actions ?? []).filter((action) => action !== topicArn)
}

export function buildMetricAlarmUpdateWithoutTopic(
  alarm: MetricAlarm,
  receipt: Pick<AwsProviderWiring, 'snsTopicArn' | 'attachedActions'>,
): PutMetricAlarmCommandInput {
  if (!alarm.AlarmName || !alarm.EvaluationPeriods || !alarm.ComparisonOperator) {
    cleanupConflict('The CloudWatch metric alarm is missing fields required for safe restoration')
  }

  return {
    AlarmName: alarm.AlarmName,
    AlarmDescription: alarm.AlarmDescription,
    ActionsEnabled: alarm.ActionsEnabled,
    OKActions: receipt.attachedActions.includes('ok')
      ? withoutTopic(alarm.OKActions, receipt.snsTopicArn)
      : alarm.OKActions,
    AlarmActions: receipt.attachedActions.includes('alarm')
      ? withoutTopic(alarm.AlarmActions, receipt.snsTopicArn)
      : alarm.AlarmActions,
    InsufficientDataActions: alarm.InsufficientDataActions,
    MetricName: alarm.MetricName,
    Namespace: alarm.Namespace,
    Statistic: alarm.Statistic,
    ExtendedStatistic: alarm.ExtendedStatistic,
    Dimensions: alarm.Dimensions,
    Period: alarm.Period,
    Unit: alarm.Unit,
    EvaluationPeriods: alarm.EvaluationPeriods,
    DatapointsToAlarm: alarm.DatapointsToAlarm,
    Threshold: alarm.Threshold,
    ComparisonOperator: alarm.ComparisonOperator,
    TreatMissingData: alarm.TreatMissingData,
    EvaluateLowSampleCountPercentile: alarm.EvaluateLowSampleCountPercentile,
    Metrics: alarm.Metrics,
    ThresholdMetricId: alarm.ThresholdMetricId,
  }
}

export function buildCompositeAlarmUpdateWithoutTopic(
  alarm: CompositeAlarm,
  receipt: Pick<AwsProviderWiring, 'snsTopicArn' | 'attachedActions'>,
): PutCompositeAlarmCommandInput {
  if (!alarm.AlarmName || !alarm.AlarmRule) {
    cleanupConflict(
      'The CloudWatch composite alarm is missing fields required for safe restoration',
    )
  }

  return {
    AlarmName: alarm.AlarmName,
    AlarmDescription: alarm.AlarmDescription,
    ActionsEnabled: alarm.ActionsEnabled,
    OKActions: receipt.attachedActions.includes('ok')
      ? withoutTopic(alarm.OKActions, receipt.snsTopicArn)
      : alarm.OKActions,
    AlarmActions: receipt.attachedActions.includes('alarm')
      ? withoutTopic(alarm.AlarmActions, receipt.snsTopicArn)
      : alarm.AlarmActions,
    InsufficientDataActions: alarm.InsufficientDataActions,
    AlarmRule: alarm.AlarmRule,
    ActionsSuppressor: alarm.ActionsSuppressor,
    ActionsSuppressorWaitPeriod: alarm.ActionsSuppressorWaitPeriod,
    ActionsSuppressorExtensionPeriod: alarm.ActionsSuppressorExtensionPeriod,
  }
}
