import { describe, expect, it } from 'bun:test'

import {
  buildCompositeAlarmUpdateWithoutTopic,
  buildMetricAlarmUpdateWithoutTopic,
  settleSequentialProviderCleanup,
  settleAwsReadback,
  targetsManagedWebhook,
} from './trigger-provider-cleanup'

const topicArn = 'arn:aws:sns:us-east-1:123456789012:nuphos-watch'
const receipt = {
  snsTopicArn: topicArn,
  attachedActions: ['alarm', 'ok'] as ('alarm' | 'ok')[],
}

describe('AWS provider cleanup', () => {
  it('removes only the owned SNS topic from a metric alarm update', () => {
    const update = buildMetricAlarmUpdateWithoutTopic(
      {
        AlarmName: 'High CPU',
        AlarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:High CPU',
        AlarmActions: [topicArn, 'arn:aws:sns:us-east-1:123456789012:existing-alarm'],
        OKActions: [topicArn, 'arn:aws:sns:us-east-1:123456789012:existing-ok'],
        InsufficientDataActions: ['arn:aws:sns:us-east-1:123456789012:existing-no-data'],
        MetricName: 'CPUUtilization',
        Namespace: 'AWS/EC2',
        Period: 60,
        EvaluationPeriods: 5,
        Threshold: 85,
        ComparisonOperator: 'GreaterThanThreshold',
        TreatMissingData: 'missing',
      },
      receipt,
    )

    expect(update.AlarmActions).toEqual(['arn:aws:sns:us-east-1:123456789012:existing-alarm'])
    expect(update.OKActions).toEqual(['arn:aws:sns:us-east-1:123456789012:existing-ok'])
    expect(update.InsufficientDataActions).toEqual([
      'arn:aws:sns:us-east-1:123456789012:existing-no-data',
    ])
    expect(update.MetricName).toBe('CPUUtilization')
    expect(update.TreatMissingData).toBe('missing')
  })

  it('preserves a composite alarm rule while removing only owned actions', () => {
    const update = buildCompositeAlarmUpdateWithoutTopic(
      {
        AlarmName: 'Service unhealthy',
        AlarmRule: 'ALARM("High CPU") OR ALARM("High Errors")',
        AlarmActions: [topicArn],
        OKActions: [topicArn],
        ActionsSuppressor: 'Deployment in progress',
        ActionsSuppressorWaitPeriod: 60,
      },
      receipt,
    )

    expect(update.AlarmActions).toEqual([])
    expect(update.OKActions).toEqual([])
    expect(update.AlarmRule).toContain('High CPU')
    expect(update.ActionsSuppressor).toBe('Deployment in progress')
  })

  it('retries stale AWS readbacks without replaying the mutation', async () => {
    const states = [false, false, true]
    const sleeps: number[] = []
    let reads = 0
    const settled = await settleAwsReadback(
      async () => states[reads++] ?? true,
      (value) => value,
      {
        delaysMs: [0, 10, 20, 40],
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds)
        },
      },
    )

    expect(settled).toBe(true)
    expect(reads).toBe(3)
    expect(sleeps).toEqual([10, 20])
  })

  it('returns the last AWS readback after exhausting the bounded retry budget', async () => {
    let reads = 0
    const settled = await settleAwsReadback(
      async () => {
        reads += 1

        return false
      },
      (value) => value,
      { delaysMs: [0, 1], sleep: async () => {} },
    )

    expect(settled).toBe(false)
    expect(reads).toBe(2)
  })
})

describe('provider webhook ownership', () => {
  it('matches the exact trigger path while ignoring its secret query', () => {
    expect(
      targetsManagedWebhook(
        'https://api.nuphos.ai/webhooks/6a58af4f0566f72f69da7db5?secret=hidden',
        '6a58af4f0566f72f69da7db5',
      ),
    ).toBe(true)
    expect(
      targetsManagedWebhook(
        'https://api.nuphos.ai/webhooks/different?secret=hidden',
        '6a58af4f0566f72f69da7db5',
      ),
    ).toBe(false)
  })
})

describe('Watch Group provider cleanup', () => {
  it('continues later Grafana members after a mid-sequence conflict', async () => {
    const attempted: string[] = []
    const conflict = new Error('notification policy changed')

    await expect(
      settleSequentialProviderCleanup(['rule-a', 'rule-b', 'rule-c'], async (rule) => {
        attempted.push(rule)
        if (rule === 'rule-b') throw conflict
      }),
    ).rejects.toBe(conflict)
    expect(attempted).toEqual(['rule-a', 'rule-b', 'rule-c'])
  })
})
